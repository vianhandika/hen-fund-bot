import { roundToStep, roundUpToStep } from '../utils/math.js';
import {
  getSymbolMeta,
  getLastPrice,
  getOrderPriceLimit,
  placeLimit,
  placeMarketShort,
  setLeverage,
  fmtPrice,
  fmtQty,
  fetchPosition,
  getOpenOrders,
  cancelOrder,
  setTradingStop,
} from '../adapters/bybit.rest.js';
import { SymbolMeta } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { ENV } from '../config/index.js';

// === konstanta strategi ===
import {
  TP1_PCT,
  TP2_PCT_FROM_TP1,
  TP3_PCT_FROM_TP2,
  TP4_PCT_FROM_AVG,
  TRIM_PCTS,
} from '../config/constants.js';

export const getMeta = async (symbol: string): Promise<SymbolMeta> => {
  const info = await getSymbolMeta(symbol);
  return {
    symbol,
    tickSize: info.tickSize,
    qtyStep: info.qtyStep,
    minOrderQty: info.minOrderQty,
    minNotionalUSD: info.minNotionalUSD,
  };
};

export const placeEntryShort = async (
  symbol: string,
  qty: number,
  lev: number,
  meta: SymbolMeta
) => {
  await setLeverage(symbol, lev).catch((e) => {
    logger.warn({ symbol, lev, err: String(e?.message ?? e) }, 'setLeverage warn');
  });

  const qtyAdj = Math.max(qty, meta.minOrderQty);
  return placeMarketShort(symbol, qtyAdj, `ENTRY-${Date.now()}`);
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** DCA SELL (clamp ke SELL MIN) — return daftar order yang dipasang */
export const placeDCAOrders = async (
  symbol: string,
  legs: Array<{ id: string; price: number; qty: number }>,
  meta: SymbolMeta
): Promise<{ placed: Array<{ tag: string; price: number; qty: number; orderId?: string; orderLinkId: string }> }> => {
  const placed: Array<{ tag: string; price: number; qty: number; orderId?: string; orderLinkId: string }> = [];

  const [band, last] = await Promise.all([
    getOrderPriceLimit(symbol),
    getLastPrice(symbol).catch(() => 0),
  ]);

  for (const l of legs) {
    let price = roundToStep(l.price, meta.tickSize);
    const sellMin =
      (band as any).sellMin ?? (last ? last * 0.8 : price);
    if (price < sellMin) price = sellMin;

    let qty = roundUpToStep(l.qty, meta.qtyStep);
    if (qty < meta.minOrderQty) qty = roundUpToStep(meta.minOrderQty, meta.qtyStep);

    const priceNum = fmtPrice(price, meta.tickSize);
    const qtyNum = fmtQty(qty, meta.qtyStep);

    const linkId = `${l.id}-${Date.now()}`;
    try {
      const res = await placeLimit(
        symbol,
        Number(qtyNum),
        Number(priceNum),
        l.id,
        linkId
      );
      placed.push({
        tag: l.id,
        price: Number(priceNum),
        qty: Number(qtyNum),
        orderId: (res as any)?.oid,
        orderLinkId: linkId,
      });
      logger.info(
        { symbol, tag: l.id, price: Number(priceNum), qty: Number(qtyNum), oid: (res as any)?.oid, orderLinkId: linkId },
        'DCA placed'
      );
    } catch (e: any) {
      logger.error(
        { symbol, tag: l.id, price: priceNum, qty: qtyNum, err: e?.message || e },
        'DCA submit failed'
      );
    }
    await sleep(80);
  }

  return { placed };
};

/** Hitung harga TP berdasarkan avg sesuai konstanta SHORT strategy */
export const buildShortTPPrices = (avg: number) => {
  const tp1 = avg * (1 - TP1_PCT);
  const tp2 = tp1 * (1 - TP2_PCT_FROM_TP1);
  const tp3 = tp2 * (1 - TP3_PCT_FROM_TP2);
  const tp4 = avg * (1 - TP4_PCT_FROM_AVG);
  return [tp1, tp2, tp3, tp4];
};

/** Tunggu posisi muncul terlebih dahulu di Bybit (kadang butuh ~200–500ms) */
export const waitUntilPositionVisible = async (symbol: string, timeoutMs = 6000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pos = await fetchPosition(symbol).catch(() => null);
    if (pos && pos.size > 0) return pos;   // { size, avgPrice }
    await new Promise(r => setTimeout(r, 150));
  }
  return null;
};

export const retrySetSL = async (symbol: string, slPrice: number, tries = 5) => {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      await setTradingStop(symbol, { sl: slPrice });
      return true;
    } catch (e: any) {
      lastErr = e;
      // ret=10001 (zero position) → tunggu & ulang
      await new Promise(r => setTimeout(r, 250 + i * 150));
    }
  }
  throw lastErr;
};

/** Pasang TP partial (atau RO fallback) sesuai TRIM_PCTS — return daftar order yang dipasang jika RO */
export const placePositionTPs = async (
  symbol: string,
  avgPrice: number,
  positionQty: number,
  meta: SymbolMeta
): Promise<{ mode: 'partial'|'reduce-only'; placed?: Array<{ tag: string; price: number; qty: number; orderId?: string; orderLinkId: string }> }> => {
  // pastikan posisi tercatat dulu
  await waitUntilPositionVisible(symbol);

  const qtyLegs = TRIM_PCTS.map(p => Math.max(p * positionQty, 0));
  const prices  = buildShortTPPrices(avgPrice);

  const legs = prices.map((price, i) => ({
    price,
    qty: qtyLegs[i] ?? 0,
  }));

  // === SL pra-TP1 tetap 1 biji (entire position) di luar sini,
  //     JANGAN kirim SL per-TP di Partial API ===
  // const slPrice = roundToStep(avgPrice * PRE_TP1_SL_MULT, meta.tickSize);

  // >>> Disarankan: SELALU RO agar bisa dikelola ketat <<<
  // Cancel TP RO lama sebelum pasang ulang
  // (kalau sebelumnya kamu sempat pakai Partial, order2-nya tidak punya linkId → makin penting untuk pindah ke RO)
  const open = await getOpenOrders(symbol).catch(() => []);
  const oldTPs = open.filter((o: any) => typeof o?.orderLinkId === 'string' && /^TP[1-4]/i.test(o.orderLinkId));
  for (const o of oldTPs) {
    try { await cancelOrder(symbol, { orderId: o.orderId, orderLinkId: o.orderLinkId }); } catch {}
  }

  // === MODE: Reduce-Only TP ===
  const placed: Array<{ tag: string; price: number; qty: number; orderId?: string; orderLinkId: string }> = [];
  const band = await getOrderPriceLimit(symbol).catch(() => ({ ok: false as const }));

  for (let i = 0; i < legs.length; i++) {
    const raw = legs[i];
    let price = roundToStep(raw.price, meta.tickSize);
    if ((band as any)?.buyMax) price = Math.min(price, (band as any).buyMax!);

    let qty = roundUpToStep(raw.qty, meta.qtyStep);
    if (qty < meta.minOrderQty) qty = roundUpToStep(meta.minOrderQty, meta.qtyStep);

    const p = fmtPrice(price, meta.tickSize);
    const q = fmtQty(qty, meta.qtyStep);

    const tag = `TP${i + 1}`;
    const linkId = `${tag}-${Date.now()}`;

    try {
      const res = await placeLimit(symbol, Number(q), Number(p), tag, linkId);
      placed.push({ tag, price: Number(p), qty: Number(q), orderId: (res as any)?.oid, orderLinkId: linkId });
      await sleep(90);
    } catch (e: any) {
      logger.error({ symbol, tag, price: p, qty: q, err: e?.message || e }, 'RO TP submit failed');
    }
  }
  logger.info({ symbol, mode: 'reduce-only' }, 'TP placement mode');
  return { mode: 'reduce-only', placed };
};

export const calcEntryQtyFromNotional = (args: {
  notionalUSD: number;  // target nilai USD untuk entry
  last: number;         // last price
  qtyStep: number;
  minOrderQty: number;
  minNotionalUSD?: number;
}) => {
  const { notionalUSD, last, qtyStep, minOrderQty, minNotionalUSD } = args;

  // qty mentah dari notional
  let qty = notionalUSD > 0 && last > 0 ? notionalUSD / last : minOrderQty;

  // penuhi minNotionalUSD kalau ada
  if (minNotionalUSD && minNotionalUSD > 0 && last > 0) {
    const minQtyByNotional = minNotionalUSD / last;
    if (qty < minQtyByNotional) qty = minQtyByNotional;
  }

  // penuhi minOrderQty, lalu round up ke step
  qty = Math.max(qty, minOrderQty);
  return roundUpToStep(qty, qtyStep);
};
