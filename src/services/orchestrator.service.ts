import { ENV } from '../config/index.js';
import { logger } from '../utils/logger.js';

import {
  upsertSymbolIfNotExists,
  readSymbols,
  removeSymbol,
  writeState,
  readState,
} from '../storage/file.repo.js';

import { shouldSkipByWindowAndFunding } from '../core/risk/guard.js';
import { makeInitialPlanByQty } from '../core/planner/plan.short.js';
import { DealState } from '../core/types.js';
import {
  releaseSymbol,
  tryAcquireSymbol,
  withSymbolLock,
} from '../core/concurrency/lock.js';

import {
  getMeta,
  placeEntryShort,
  placeDCAOrders,
  placePositionTPs,
  calcEntryQtyFromNotional,
  waitUntilPositionVisible,
} from './order.service.js';

import { getLastPrice, getOpenOrders } from '../adapters/bybit.rest.js';
import { SHORT_ONLY } from '../config/constants.js';
import { startWatcherForSymbol } from './watcher.service.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isSymbolBusy = async (symbol: string) => {
  const state = await readState(symbol).catch(() => null);
  if (state) return true;

  const queued = await readSymbols().catch(() => []);
  if (queued.some((s: any) => s?.symbol === symbol)) return true;

  const got = await tryAcquireSymbol(symbol);
  if (got) {
    await releaseSymbol(symbol);
    return false;
  }
  return true;
};

export const ingestSignal = async (item: {
  symbol: string;
  fundingRate: number;
  createdAt: string;
}): Promise<boolean> => {
  if (shouldSkipByWindowAndFunding(item.fundingRate, item.createdAt)) {
    logger.info(
      { symbol: item.symbol, fr: item.fundingRate, at: item.createdAt },
      'signal skipped by funding/time window'
    );
    return false;
  }

  if (await isSymbolBusy(item.symbol)) {
    logger.info(
      { symbol: item.symbol, reason: 'BUSY' },
      'signal ignored (already running/queued/locked)'
    );
    return false;
  }

  await upsertSymbolIfNotExists(item);
  return true;
};

export const runOrchestratorTick = async () => {
  const symbols = await readSymbols();

  for (const s of symbols) {
    const res = await withSymbolLock(s.symbol, async () => {
      await removeSymbol(s.symbol);

      // 1) meta
      const meta = await getMeta(s.symbol);

      // 2) ENTRY SHORT only
      if (!SHORT_ONLY) {
        throw new Error('Config expects SHORT_ONLY=true');
      }

      // === qty dari ENV.ENTRY_USD (notional) kalau ada; fallback ENTRY_MULT × minOrderQty
      let entryQtyReq: number;
      const entryUsd = Number(ENV.ENTRY_USD ?? 0);
      if (Number.isFinite(entryUsd) && entryUsd > 0) {
        const last = await getLastPrice(s.symbol);
        entryQtyReq = calcEntryQtyFromNotional({
          notionalUSD: entryUsd,
          last,
          qtyStep: meta.qtyStep,
          minOrderQty: meta.minOrderQty,
          minNotionalUSD: meta.minNotionalUSD,
        });
      } else {
        entryQtyReq = Math.max(
          meta.minOrderQty * ENV.ENTRY_MULT,
          meta.minOrderQty
        );
      }

      const entry = await placeEntryShort(
        s.symbol,
        entryQtyReq,
        ENV.BYBIT_LEVERAGE,
        meta
      );

      const pos = await waitUntilPositionVisible(s.symbol, 6000);
      if (!pos) {
        logger.error({ symbol: s.symbol }, 'entry not visible → abort');
        return true;
      }

      // 3) plan dari ENTRY (basisQty = entry.qty)
      const plan: DealState = makeInitialPlanByQty(
        s.symbol,
        meta,
        entry.price,
        entry.qty,
        1,
        ENV.BYBIT_LEVERAGE
      );

      // 4) DCA SELL (4 legs)
      await placeDCAOrders(
        s.symbol,
        plan.dca.map((d) => ({ id: d.id, price: d.price, qty: d.qty })),
        meta
      );

      await sleep(200);

      // 5) TP partial (RO reduce-only) — 3 TP dari AVG: 2.5%, 5%, 10%
      await placePositionTPs(
        s.symbol,
        plan.avgPrice,
        entry.qty, // TRIM_PCTS menentukan pembagian
        meta
      );

      // 6) (opsional) capture open orders saat init, supaya keliatan di log
      const openOrders = await getOpenOrders(s.symbol).catch(() => []);
      logger.info(
        {
          symbol: s.symbol,
          entry: { price: entry.price, qty: entry.qty },
          dca: plan.dca.map((d) => ({ id: d.id, p: d.price, q: d.qty })),
          tp: plan.tp.map((t) => ({ id: t.id, p: t.price, take: t.takePct })),
          openOrders: openOrders
            .filter((o: any) =>
              /^(DCA[1-4]|TP[1-3])/.test(String(o.orderLinkId || ''))
            )
            .map((o: any) => ({
              type: String(o.orderLinkId || '').split('-')[0],
              price: Number(o.price ?? 0),
              qty: Number(o.qty ?? 0),
              orderLinkId: o.orderLinkId,
              orderId: o.orderId,
            })),
        },
        'orchestrator: plan initialized'
      );

      // 7) persist state
      await writeState(s.symbol, plan);

      // 8) START WATCHER UNTUK SYMBOL INI
      try {
        await startWatcherForSymbol(s.symbol);
        logger.info({ symbol: s.symbol }, 'watcher started from orchestrator');
      } catch (e) {
        logger.error(
          { symbol: s.symbol, err: String((e as any)?.message ?? e) },
          'start watcher failed'
        );
      }

      return true;
    });

    if (!res.ok) continue;
  }
};
