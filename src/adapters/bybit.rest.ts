import { RestClientV5 } from 'bybit-api';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ENV } from '../config/index.js';
import { roundToStep, roundUpToStep } from '../utils/math.js';

/** proxy opsional */
const agent =
  process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    ? new HttpsProxyAgent(process.env.HTTPS_PROXY || process.env.HTTP_PROXY!)
    : undefined;

const IS_LIVE = String(ENV.BOT_MODE).toLowerCase() === 'live';

export const bybit = new RestClientV5({
  key: ENV.BYBIT_API_KEY,
  secret: ENV.BYBIT_API_SECRET,
  ...(IS_LIVE ? {} : { demoTrading: true }),
  recv_window: 5000,
  // @ts-ignore
  agent,
});

const CATEGORY = 'linear' as const;

/* --------------------- util presisi --------------------- */
const stepDecimals = (step: number) => {
  const s = String(step);
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
};
export const fmtPrice = (price: number, tickSize: number) =>
  Number(price.toFixed(stepDecimals(tickSize)));
export const fmtQty = (qty: number, qtyStep: number) =>
  Number(qty.toFixed(stepDecimals(qtyStep)));

/* --------------------- meta/public --------------------- */
export type ExchangeInfo = {
  tickSize: number;
  qtyStep: number;
  minOrderQty: number;
  minNotionalUSD?: number;
};

export const getSymbolMeta = async (symbol: string): Promise<ExchangeInfo> => {
  const r = await bybit.getInstrumentsInfo({ category: CATEGORY, symbol });
  const row = r.result.list?.[0];
  if (!row) throw new Error(`No instrument info for ${symbol}`);
  return {
    tickSize: Number(row.priceFilter?.tickSize ?? '0.0001'),
    qtyStep: Number(row.lotSizeFilter?.qtyStep ?? '0.001'),
    minOrderQty: Number(row.lotSizeFilter?.minOrderQty ?? '0.001'),
    minNotionalUSD: Number(row.lotSizeFilter?.minNotionalValue ?? '0'),
  };
};

export const getLastPrice = async (symbol: string) => {
  const r = await bybit.getTickers({ category: CATEGORY, symbol });
  return Number(r.result.list?.[0]?.lastPrice ?? '0');
};

/** BUY = max, SELL = min */
export const getOrderPriceLimit = async (symbol: string) => {
  try {
    const r = await bybit.getOrderPriceLimit({ category: CATEGORY, symbol });
    const anyRes: any = r?.result ?? {};
    const buyMax = Number(anyRes.buyLmt ?? anyRes.upperLimit ?? NaN);
    const sellMin = Number(anyRes.sellLmt ?? anyRes.lowerLimit ?? NaN);
    return {
      buyMax: Number.isFinite(buyMax) ? buyMax : undefined,
      sellMin: Number.isFinite(sellMin) ? sellMin : undefined,
      ok: true as const,
    };
  } catch {
    return { buyMax: undefined, sellMin: undefined, ok: false as const };
  }
};

/* --------------------- leverage / posisi / akun --------------------- */
export const getPositionLeverage = async (symbol: string) => {
  const r = await bybit.getPositionInfo({ category: CATEGORY, symbol });
  const row = r.result.list?.[0];
  return row ? Number(row.leverage ?? 0) : 0;
};

export const setLeverage = async (symbol: string, lev: number) => {
  try {
    const cur = await getPositionLeverage(symbol).catch(() => 0);
    if (cur === lev) return { ok: true, ignored: true };
    await bybit.setLeverage({
      category: CATEGORY,
      symbol,
      buyLeverage: String(lev),
      sellLeverage: String(lev),
    });
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('110043')) return { ok: true, ignored: true };
    throw e;
  }
};

export const fetchPosition = async (symbol: string) => {
  const r = await bybit.getPositionInfo({ category: CATEGORY, symbol });
  const row = r.result.list?.[0];
  if (!row || Number(row.size) === 0) return null;
  return { size: Number(row.size), avgPrice: Number(row.avgPrice) };
};

export const getPositionMode = async (symbol: string) => {
  const r: any = await bybit.getPositionInfo({ category: CATEGORY, symbol });
  return Number(r?.result?.list?.[0]?.positionIdx ?? 0); // 0 = one-way
};

export const getAccountType = async () => {
  try {
    const r: any = await (bybit as any).getApiKeyInfo?.();
    const t = r?.result?.accountType ?? ENV.BYBIT_ACCOUNT_TYPE;
    return String(t || '').toLowerCase(); // 'unified' | 'contract'
  } catch {
    return String(ENV.BYBIT_ACCOUNT_TYPE || 'contract').toLowerCase();
  }
};

/* --------------------- orders --------------------- */
export const placeMarketShort = async (
  symbol: string,
  qty: number,
  clientId: string
) => {
  const last = await getLastPrice(symbol);
  await bybit.submitOrder({
    category: CATEGORY,
    symbol,
    side: 'Sell',
    orderType: 'Market',
    qty: String(qty),
    timeInForce: 'IOC',
    orderLinkId: clientId,
    reduceOnly: false,
  });
  return { price: last, qty };
};

export const placeLimit = async (
  symbol: string,
  qty: number,
  price: number,
  tag: string,
  clientId: string
) => {
  const isTP = /^TP[1-3]$/i.test(tag);
  const side = isTP ? 'Buy' : 'Sell';
  const reduceOnly = isTP;

  const res = await bybit.submitOrder({
    category: CATEGORY,
    symbol,
    side,
    orderType: 'Limit',
    qty: String(qty),
    price: String(price),
    timeInForce: 'GTC',
    orderLinkId: clientId,
    reduceOnly,
  });

  const oid = (res as any)?.result?.orderId;
  return { ok: true, oid, linkId: clientId };
};

/** batch reduce-only TP (fallback untuk akun non-unified) */
export const placeReduceOnlyTPBatch = async (args: {
  symbol: string;
  legs: Array<{ price: number; qty: number }>;
  meta: { tickSize: number; qtyStep: number; minOrderQty: number };
}) => {
  const { symbol, legs, meta } = args;
  const band = await getOrderPriceLimit(symbol).catch(() => ({
    ok: false as const,
  }));

  for (let i = 0; i < legs.length; i++) {
    const raw = legs[i];
    let price = roundToStep(raw.price, meta.tickSize);
    if ((band as any)?.buyMax) price = Math.min(price, (band as any).buyMax!);

    let qty = roundUpToStep(raw.qty, meta.qtyStep);
    if (qty < meta.minOrderQty)
      qty = roundUpToStep(meta.minOrderQty, meta.qtyStep);

    const p = fmtPrice(price, meta.tickSize);
    const q = fmtQty(qty, meta.qtyStep);
    await placeLimit(symbol, q, p, `TP${i + 1}`, `TP${i + 1}-${Date.now()}`);
    await new Promise((r) => setTimeout(r, 90));
  }
  return { ok: true as const };
};

/* ----------------- robust setTradingStop w/ retCode ----------------- */
export const setTradingStop = async (
  symbol: string,
  opts: {
    sl?: number;
    tp?: number;
    trailingStop?: {
      distanceAbs?: number;
      distancePct?: number;
      activePrice?: number;
    };
  }
) => {
  let trailingStopAbs: number | undefined = undefined;
  let activePriceStr: string | undefined = undefined;

  if (opts.trailingStop) {
    const ap = opts.trailingStop.activePrice;
    if (ap != null) activePriceStr = String(ap);

    if (opts.trailingStop.distanceAbs != null) {
      trailingStopAbs = opts.trailingStop.distanceAbs;
    } else if (opts.trailingStop.distancePct != null && ap != null) {
      trailingStopAbs = ap * opts.trailingStop.distancePct;
    }
  }

  const res: any = await bybit.setTradingStop({
    category: 'linear',
    symbol,
    positionIdx: 0,
    stopLoss: opts.sl != null ? String(opts.sl) : undefined,
    takeProfit: opts.tp != null ? String(opts.tp) : undefined,
    trailingStop: trailingStopAbs != null ? String(trailingStopAbs) : undefined,
    activePrice: activePriceStr,
  });

  const retCode = Number(res?.retCode ?? -1);
  const retMsg = String(res?.retMsg ?? '');
  if (retCode !== 0) {
    const err = new Error(`[setTradingStop] ret=${retCode} ${retMsg}`);
    (err as any).retCode = retCode;
    (err as any).retMsg = retMsg;
    throw err;
  }
  return { ok: true as const, retCode, retMsg };
};

const tryPlacePartialTP = async (
  symbol: string,
  price: number,
  qty: number
) => {
  const res: any = await bybit.setTradingStop({
    category: CATEGORY,
    symbol,
    positionIdx: 0,
    tpslMode: 'Partial',
    takeProfit: String(price),
    tpOrderType: 'Limit',
    tpLimitPrice: String(price),
    tpSize: String(qty),
    tpTriggerBy: 'LastPrice',
  });

  const retCode = Number(res?.retCode ?? -1);
  const retMsg = String(res?.retMsg ?? '');
  if (retCode !== 0) {
    const unsupported = retCode === 110045 || /not support/i.test(retMsg);
    return { ok: false as const, unsupported, retCode, retMsg };
  }
  return { ok: true as const };
};

export const placePartialTPBatch = async (args: {
  symbol: string;
  legs: Array<{ price: number; qty: number }>;
  slPrice: number;
  meta: { tickSize: number; qtyStep: number; minOrderQty: number };
}) => {
  const { symbol, legs, slPrice, meta } = args;

  const acct = await getAccountType().catch(() => 'contract');
  if (acct !== 'unified') {
    await placeReduceOnlyTPBatch({ symbol, legs, meta });
    return {
      ok: true as const,
      mode: 'reduce-only' as const,
      reason: 'non-unified' as const,
    };
  }

  const [band, last] = await Promise.all([
    getOrderPriceLimit(symbol).catch(() => ({ ok: false as const })),
    getLastPrice(symbol).catch(() => 0),
  ]);

  for (const raw of legs) {
    let price = roundToStep(raw.price, meta.tickSize);
    if ((band as any)?.buyMax) price = Math.min(price, (band as any).buyMax!);
    else if (last) price = Math.min(price, last * 1.2);

    let qty = roundUpToStep(raw.qty, meta.qtyStep);
    if (qty < meta.minOrderQty)
      qty = roundUpToStep(meta.minOrderQty, meta.qtyStep);

    const p = fmtPrice(price, meta.tickSize);
    const q = fmtQty(qty, meta.qtyStep);

    const res = await tryPlacePartialTP(symbol, p, q);
    if (!res.ok) {
      const msg = `[PartialTP failed] ${symbol} p=${p} q=${q} ret=${res.retCode} ${res.retMsg}`;
      const err = new Error(msg);
      (err as any).code = 'PARTIAL_TP_CALL_FAILED';
      throw err;
    }
    await new Promise((r) => setTimeout(r, 90));
  }

  return { ok: true as const, mode: 'partial' as const };
};

export const setTrailingByRate = async (
  symbol: string,
  activePrice: number,
  rate: number
) => {
  return setTradingStop(symbol, {
    trailingStop: { distancePct: rate, activePrice },
  });
};

export const amendOrder = async (
  symbol: string,
  args: {
    orderId?: string;
    orderLinkId?: string;
    newPrice?: number;
    newQty?: number;
  }
) => {
  await bybit.amendOrder({
    category: CATEGORY,
    symbol,
    orderId: args.orderId,
    orderLinkId: args.orderLinkId,
    price: args.newPrice != null ? String(args.newPrice) : undefined,
    qty: args.newQty != null ? String(args.newQty) : undefined,
  });
  return { ok: true };
};

export const cancelOrder = async (
  symbol: string,
  args: { orderId?: string; orderLinkId?: string }
) => {
  await bybit.cancelOrder({ category: CATEGORY, symbol, ...args });
  return { ok: true };
};

export const getOpenOrders = async (symbol: string) => {
  const fn: any =
    (bybit as any).getOpenOrders ?? (bybit as any).getActiveOrders ?? null;
  if (!fn) return [];
  const r = await fn.call(bybit, { category: CATEGORY, symbol });
  return r?.result?.list ?? [];
};

/* ---------------- compat cancelReplace for watcher ---------------- */
export const cancelReplace = async (args: any) => {
  const { symbol, type } = args || {};
  if (!symbol || !type) return { ok: false, reason: 'missing args' };

  if (type === 'MOVE_SL' && typeof args.price === 'number') {
    const ret = await setTradingStop(symbol, { sl: args.price });
    return { ok: true, detail: ret };
  }
  if (type === 'TRAILING_SL' && typeof args.trailPct === 'number') {
    const ret = await setTradingStop(symbol, {
      trailingStop: {
        distancePct: args.trailPct,
        activePrice: args.activePrice,
      },
    });
    return { ok: true, detail: ret };
  }
  if (type === 'AMEND') {
    await amendOrder(symbol, args);
    return { ok: true };
  }
  return { ok: false, reason: 'unknown type' };
};

export const placeProfitLockStopShort = async (
  symbol: string,
  triggerPrice: number,
  qty: number
) => {
  if (!(Number.isFinite(qty) && qty > 0)) {
    throw new Error(`[placeProfitLockStopShort] invalid qty: ${qty}`);
  }
  if (!(Number.isFinite(triggerPrice) && triggerPrice > 0)) {
    throw new Error(
      `[placeProfitLockStopShort] invalid triggerPrice: ${triggerPrice}`
    );
  }

  const res: any = await bybit.submitOrder({
    category: 'linear',
    symbol,
    side: 'Buy',
    orderType: 'Market',
    qty: String(qty),
    reduceOnly: true,
    triggerPrice: String(triggerPrice),
    triggerBy: 'LastPrice',
    triggerDirection: 1,
    positionIdx: 0,
    timeInForce: 'IOC',
    orderLinkId: `LOCKTP1-${Date.now()}`,
  });

  const retCode = Number(res?.retCode ?? -1);
  const retMsg = String(res?.retMsg ?? '');
  if (retCode !== 0) {
    const err = new Error(
      `[placeProfitLockStopShort] ret=${retCode} ${retMsg}`
    );
    (err as any).retCode = retCode;
    (err as any).retMsg = retMsg;
    throw err;
  }
  return { ok: true as const };
};
