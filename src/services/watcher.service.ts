import { subscribeFills } from '../adapters/bybit.ws.js';
import { onFill } from '../core/state-maching/trade.fsm.js';
import { DealState, SymbolMeta } from '../core/types.js';
import { logger } from '../utils/logger.js';
import {
  readState,
  writeState,
  removeState,
  appendFinalJournal,
  releaseSymbolLock,
} from '../storage/file.repo.js';

import { getMeta } from './order.service.js';

import {
  cancelReplace,
  fetchPosition,
  cancelOrder,
  getOpenOrders,
  placeProfitLockStopShort,
  fmtQty,
} from '../adapters/bybit.rest.js';

import { placePositionTPs } from './order.service.js';

import { LOCK_AFTER_TP1 } from '../config/constants.js';
import { roundToStep } from '../utils/math.js';

// ===== helpers cancel ==========================
async function cancelAllDCA(symbol: string) {
  const open = await getOpenOrders(symbol).catch(() => []);
  const dca = open.filter(
    (o: any) =>
      typeof o?.orderLinkId === 'string' && /^DCA[1-4]/i.test(o.orderLinkId)
  );
  for (const o of dca) {
    try {
      await cancelOrder(symbol, {
        orderId: o.orderId,
        orderLinkId: o.orderLinkId,
      });
    } catch (e) {
      logger.warn(
        {
          symbol,
          orderId: o?.orderId,
          orderLinkId: o?.orderLinkId,
          e: String((e as any)?.message ?? e),
        },
        'cancel DCA failed'
      );
    }
  }
  if (dca.length)
    logger.info({ symbol, count: dca.length }, 'Canceled all DCA orders');
}

async function cancelAllROTP(symbol: string) {
  const open = await getOpenOrders(symbol).catch(() => []);
  const tps = open.filter(
    (o: any) =>
      typeof o?.orderLinkId === 'string' && /^TP[1-3]/i.test(o.orderLinkId)
  );

  for (const o of tps) {
    try {
      await cancelOrder(symbol, {
        orderId: o.orderId,
        orderLinkId: o.orderLinkId,
      });
    } catch (e) {
      logger.warn(
        {
          symbol,
          orderId: o?.orderId,
          orderLinkId: o?.orderLinkId,
          e: String((e as any)?.message ?? e),
        },
        'cancel RO TP failed'
      );
    }
  }
  if (tps.length)
    logger.info({ symbol, count: tps.length }, 'Canceled all RO TP orders');
}

// ===== helpers SL ==============================
const moveStopLossTo = async (
  symbol: string,
  newPrice: number,
  reason: string
) => {
  try {
    const meta = await getMeta(symbol);
    const p = roundToStep(newPrice, meta.tickSize);
    const r = await cancelReplace({
      symbol,
      type: 'MOVE_SL',
      price: p,
      orderLinkId: 'SL-' + Date.now(),
    } as any);
    logger.info({ symbol, newPrice: p, reason, detail: r }, 'SL moved');
  } catch (e) {
    logger.error(
      {
        symbol,
        newPrice,
        reason,
        err: String((e as any)?.message ?? e),
        retCode: (e as any)?.retCode,
        retMsg: (e as any)?.retMsg,
      },
      'SL move failed'
    );
  }
};

// ===== finalize ================================
type ExitMode = 'TP1' | 'TP2' | 'TP3' | 'SL';

const inferExitModeFromFlags = (state: DealState | null): ExitMode => {
  if (!state) return 'SL';
  if (state.flags.tp3) return 'TP3';
  if (state.flags.tp2) return 'TP2';
  if (state.flags.tp1) return 'TP1';
  return 'SL';
};

const finalizeDeal = async (
  symbol: string,
  state: DealState | null,
  exit: { mode: ExitMode; price: number; time: string },
  stopExecWs?: () => void
) => {
  try {
    await cancelAllDCA(symbol);
    await cancelAllROTP(symbol);

    if (state) {
      await appendFinalJournal({
        tsClose: exit.time,
        dealId: state.dealId,
        symbol: state.symbol,
        side: 'SHORT',
        lev: state.lev,
        entry: {
          time: state.entry.time,
          price: state.entry.price,
          qty: state.entry.qty,
        },
        dcaHits: {
          filled: state.dca
            .filter((d) => d.status === 'FILLED')
            .map((d) => d.id),
        },
        exit, // <-- tipe sudah match FinalJournal.exit
        pnl: { realizedUSD: 0, feesUSD: 0, fundingUSD: 0, netUSD: 0 },
        path: {
          tp1: state.flags.tp1,
          tp2: state.flags.tp2,
          tp3: state.flags.tp3,
        },
      });
    }
  } catch (e) {
    logger.error(e, 'appendFinalJournal failed');
  } finally {
    try {
      stopExecWs?.();
    } catch {}
    try {
      await removeState(symbol);
    } catch {}
    try {
      await releaseSymbolLock(symbol);
    } catch {}
  }
};

// ===== resync protections on avg change ========
const resyncProtectionsOnAverageChange = async (
  symbol: string,
  state: DealState,
  meta: SymbolMeta
) => {
  if (!state.flags.tp1) {
    // 1) cancel TP RO lama -> place ulang sesuai avg & size terbaru
    await cancelAllROTP(symbol);
    const pos = await fetchPosition(symbol).catch(() => null);
    const sizeNow = pos?.size ?? state.entry.qty;
    await placePositionTPs(symbol, state.avgPrice, sizeNow, meta);

    logger.info(
      { symbol, avg: state.avgPrice, sizeNow },
      'Replaced partial TPs after DCA'
    );
  }
};

// ===== risk adjustments (SHORT only) ===========
const applyRiskAdjustments = async (symbol: string, state: DealState) => {
  // TP1 hit → pasang SL+ (LOCK_AFTER_TP1), cancel semua DCA
  if (state.flags.tp1 && state.sl.mode !== 'BEP') {
    const meta = await getMeta(symbol);
    const lockPct = LOCK_AFTER_TP1;
    const target = roundToStep(state.avgPrice * (1 - lockPct), meta.tickSize);

    const pos = await fetchPosition(symbol).catch(() => null);
    const sizeNow = pos?.size ?? 0;
    if (sizeNow > 0) {
      const qtyRounded = Number(fmtQty(sizeNow, meta.qtyStep));
      await placeProfitLockStopShort(symbol, target, qtyRounded);
      await cancelAllDCA(symbol);
      state.sl = { mode: 'BEP', price: target };
      logger.info(
        { symbol, price: target, qty: qtyRounded },
        `TP1 -> LOCK +${(lockPct * 100).toFixed(2)}% set`
      );
    }
  }

  // TP2 hit → SL dipindah ke harga TP1
  if (state.flags.tp2 && state.sl.mode !== 'TP1') {
    const tp1 = state.tp.find((t) => t.id === 'TP1');
    if (tp1) {
      state.sl = { mode: 'TP1', price: tp1.price };
      await moveStopLossTo(symbol, tp1.price, 'TP2->SL=TP1');
    }
  }

  // TP3: tidak ada trailing, posisi diharapkan close full lewat TP3
};

// ===== WATCHER MAIN ============================
export const startWatcherForSymbol = async (symbol: string) => {
  let state: DealState | null = await readState<DealState>(symbol);
  if (!state) {
    logger.warn({ symbol }, 'watcher: no state found, abort');
    await releaseSymbolLock(symbol);
    return () => {};
  }

  const meta = await getMeta(symbol);

  const EPS_SIZE = 1e-10;
  const EPS_PRICE = meta.tickSize / 2;
  const approxEq = (a: number, b: number, tol: number) =>
    Math.abs(a - b) <= tol;

  let pos0 = await fetchPosition(symbol).catch(() => null);
  let lastKnownSize = pos0?.size ?? state.entry.qty;
  let lastKnownAvg = pos0?.avgPrice ?? state.avgPrice;

  // === hanya PRIVATE fills ===
  const stopExecWs = await subscribeFills(symbol, async (ev: any) => {
    try {
      if (!state) return;

      let appliedTag: string | undefined = ev.tag;

      // LOCK* (SL+ market) → close deal
      if (appliedTag && /^LOCK/i.test(appliedTag)) {
        const mode = inferExitModeFromFlags(state);
        await finalizeDeal(
          symbol,
          state,
          { mode, price: ev.price, time: ev.time },
          stopExecWs
        );
        state = null;
        return;
      }

      // ---------- INFER SL dari payload ----------
      const isReduceOnly = ev.reduceOnly === true || ev.reduce_only === true;
      const leavesQtyNum = Number(
        ev.leavesQty ?? ev.leaves_qty ?? ev.leaves ?? 0
      );
      const orderQtyNum = Number(ev.orderQty ?? ev.order_qty);
      const cumExecQty = Number(
        ev.cumExecQty ?? ev.cum_exec_qty ?? ev.qty ?? 0
      );

      const closedByThisFill =
        isReduceOnly &&
        (leavesQtyNum === 0 ||
          (Number.isFinite(orderQtyNum) &&
            Number.isFinite(cumExecQty) &&
            cumExecQty >= orderQtyNum));

      const stopKindRaw = String(
        ev.stopOrderType ??
          ev.stop_order_type ??
          ev.triggerType ??
          ev.trigger_type ??
          ev.orderType ??
          ev.order_type ??
          ''
      ).toLowerCase();
      const looksLikeStop = stopKindRaw.includes('stop');

      const hitStoredSL =
        state?.sl?.price != null &&
        approxEq(Number(ev.price), Number(state.sl.price), meta.tickSize);

      if (!appliedTag) {
        if (looksLikeStop || hitStoredSL || closedByThisFill) {
          appliedTag = 'SL';
          logger.info(
            {
              symbol,
              inferred: appliedTag,
              price: ev.price,
              stopKindRaw,
              hitStoredSL,
              closedByThisFill,
            },
            'Inferred close by stop-loss heuristics'
          );
        }
      }

      // ---------- baca posisi terbaru ----------
      const posAfter = await fetchPosition(symbol).catch(() => null);
      const sizeNow = posAfter?.size ?? lastKnownSize;
      const avgNow = posAfter?.avgPrice ?? lastKnownAvg;

      const sizeUp = sizeNow > lastKnownSize + EPS_SIZE;
      const sizeDown = sizeNow < lastKnownSize - EPS_SIZE;
      const avgMoved = Math.abs(avgNow - state.avgPrice) > EPS_PRICE;

      // ---------- infer TP bila tag kosong ----------
      if (!appliedTag || appliedTag === '') {
        if (sizeDown) {
          if (!state.flags.tp1) appliedTag = 'TP1';
          else if (!state.flags.tp2) appliedTag = 'TP2';
          else if (!state.flags.tp3) appliedTag = 'TP3';
          logger.info(
            { symbol, inferred: appliedTag, sizeNow, lastKnownSize },
            'Inferred TP by size drop'
          );
        }
      }

      // ---------- FSM onFill ----------
      if (appliedTag) {
        state = onFill(state!, { ...ev, tag: appliedTag } as any, {
          tickSize: meta.tickSize,
          qtyStep: meta.qtyStep,
        });
      } else {
        state = onFill(state!, ev as any, {
          tickSize: meta.tickSize,
          qtyStep: meta.qtyStep,
        });
      }
      if (!state) return;

      // ---------- resync protections saat avg berubah sebelum TP1 ----------
      if (!state.flags.tp1 && (sizeUp || avgMoved)) {
        if (posAfter?.avgPrice && avgMoved) {
          state.avgPrice = posAfter.avgPrice;
          logger.info(
            { symbol, avgNow, from: lastKnownAvg },
            'Avg updated from exchange before resync'
          );
        }
        await resyncProtectionsOnAverageChange(symbol, state, meta);
      }

      // ---------- risk rules saat TP1/2/3 ----------
      if (
        appliedTag === 'TP1' ||
        appliedTag === 'TP2' ||
        appliedTag === 'TP3' ||
        ev.tag === 'TP1' ||
        ev.tag === 'TP2' ||
        ev.tag === 'TP3'
      ) {
        await applyRiskAdjustments(symbol, state);
      }

      await writeState(symbol, state);

      // ---------- jika posisi sudah 0 → finalize di sini ----------
      if (sizeNow <= EPS_SIZE) {
        const mode = inferExitModeFromFlags(state);
        await finalizeDeal(
          symbol,
          state,
          { mode, price: ev.price, time: ev.time },
          stopExecWs
        );
        state = null;
        return;
      }

      // ---------- fallback: tanpa tag, tapi mungkin sudah close ----------
      const noTag = !(appliedTag || ev.tag);
      if (noTag) {
        let pos = await fetchPosition(symbol).catch(() => null);
        if (!pos || pos.size === 0) {
          const mode = inferExitModeFromFlags(state);
          await finalizeDeal(
            symbol,
            state,
            { mode, price: ev.price, time: ev.time },
            stopExecWs
          );
          state = null;
          return;
        }
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 300));
          pos = await fetchPosition(symbol).catch(() => null);
          if (!pos || pos.size === 0) {
            const mode = inferExitModeFromFlags(state);
            await finalizeDeal(
              symbol,
              state,
              { mode, price: ev.price, time: new Date().toISOString() },
              stopExecWs
            );
            state = null;
            return;
          }
        }
      }

      lastKnownSize = sizeNow;
      lastKnownAvg = avgNow;
    } catch (e) {
      logger.error(e, 'watcher fill handler error');
    }
  });

  // ---------- reconciler: safety net bila event terlewat ----------
  const reconciler = setInterval(async () => {
    if (!state) {
      clearInterval(reconciler);
      return;
    }
    try {
      const pos = await fetchPosition(symbol).catch(() => null);
      if (!pos || pos.size === 0) {
        const mode = inferExitModeFromFlags(state);
        await finalizeDeal(
          symbol,
          state,
          { mode, price: state.sl?.price ?? 0, time: new Date().toISOString() },
          stopExecWs
        );
        state = null;
        clearInterval(reconciler);
      }
    } catch {
      // swallow
    }
  }, 4000);

  logger.info({ symbol }, 'watcher started');

  return () => {
    try {
      stopExecWs?.();
    } catch {}
    try {
      clearInterval(reconciler);
    } catch {}
  };
};

// Opsional helper (saat ini tidak dipakai, tapi bisa dipakai kalau mau SL=BEP fix)
const setSLToBEP = async (symbol: string, avg: number, reason: string) => {
  const meta = await getMeta(symbol);
  let p = roundToStep(avg, meta.tickSize);

  try {
    await cancelReplace({ symbol, type: 'MOVE_SL', price: p } as any);
    logger.info({ symbol, price: p, reason }, 'SL->BEP set');
    return p;
  } catch (e: any) {
    const msg = String(e?.retMsg || e?.message || '');
    const needHigher =
      (e as any)?.retCode === 10001 || /should greater base_price/i.test(msg);

    if (!needHigher) throw e;

    const p2 = roundToStep(avg + meta.tickSize, meta.tickSize);
    await cancelReplace({ symbol, type: 'MOVE_SL', price: p2 } as any);
    logger.info(
      { symbol, price: p2, reason, note: 'retry +1 tick' },
      'SL->BEP set'
    );
    return p2;
  }
};
