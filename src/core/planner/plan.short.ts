import {
  DCA_STEPS,
  DCA_MULTS,
  TP1_PCT,
  TP2_PCT,
  TP3_PCT,
  TRIM_PCTS,
} from '../../config/constants.js';
import {
  roundUpToStep,
  pctAbove,
  pctBelow,
  roundToStep,
} from '../../utils/math.js';
import { SymbolMeta, DealState } from '../types.js';

const DCA_IDS = ['DCA1', 'DCA2', 'DCA3', 'DCA4'] as const;

/**
 * Plan awal: SHORT only
 * - 4 DCA leg (DCA1..DCA4) pakai STRAT_DCA_STEPS & STRAT_DCA_MULTS
 * - 3 TP (TP1, TP2, TP3) langsung dari AVG:
 *    TP1 = avg * (1 - TP1_PCT)
 *    TP2 = avg * (1 - TP2_PCT)
 *    TP3 = avg * (1 - TP3_PCT)
 * - NO SL awal (mode = 'NONE'); SL+ nanti diatur di watcher saat TP1 ke-hit.
 */
export const makeInitialPlanByQty = (
  symbol: string,
  meta: SymbolMeta,
  entryPrice: number,
  entryQtyMin: number,
  entryMult: number,
  lev: number
): DealState => {
  const entryQty = roundUpToStep(entryQtyMin * entryMult, meta.qtyStep);

  // DCA prices & qtys dari config
  const dcaPrices = DCA_STEPS.map((step) =>
    roundToStep(pctAbove(entryPrice, step), meta.tickSize)
  );
  const dcaQtys = DCA_MULTS.map((mult) =>
    roundUpToStep(entryQty * mult, meta.qtyStep)
  );

  const dca = DCA_IDS.map((id, idx) => ({
    id,
    price: dcaPrices[idx],
    qty: dcaQtys[idx],
    status: 'WORKING' as const,
  }));

  const avg = entryPrice;

  const tp1 = roundToStep(pctBelow(avg, TP1_PCT), meta.tickSize);
  const tp2 = roundToStep(pctBelow(avg, TP2_PCT), meta.tickSize);
  const tp3 = roundToStep(pctBelow(avg, TP3_PCT), meta.tickSize);

  return {
    dealId: `${symbol}-${Date.now()}`,
    symbol,
    side: 'SHORT',
    lev,
    entry: {
      price: entryPrice,
      qty: entryQty,
      time: new Date().toISOString(),
      filled: true,
    },
    dca,
    avgPrice: avg,
    tp: [
      {
        id: 'TP1',
        price: tp1,
        takePct: TRIM_PCTS[0] ?? 0.4,
        status: 'WORKING',
      },
      {
        id: 'TP2',
        price: tp2,
        takePct: TRIM_PCTS[1] ?? 0.3,
        status: 'WORKING',
      },
      {
        id: 'TP3',
        price: tp3,
        takePct: TRIM_PCTS[2] ?? 0.3,
        status: 'WORKING',
      },
    ],
    // NO SL awal — nanti di watcher:
    // - TP1 hit -> pasang SL+ (LOCK_AFTER_TP1)
    // - TP2 hit -> SL pindah ke TP1
    sl: { mode: 'NONE', price: avg },
    flags: { tp1: false, tp2: false, tp3: false },
  };
};

/** Setelah DCA terisi, re-anchor TP dari avg baru (3 TP, NO SL adjustment) */
export const reanchorFromAvg = (state: DealState, tickSize: number) => {
  const avg = state.avgPrice;

  const tp1 = roundToStep(pctBelow(avg, TP1_PCT), tickSize);
  const tp2 = roundToStep(pctBelow(avg, TP2_PCT), tickSize);
  const tp3 = roundToStep(pctBelow(avg, TP3_PCT), tickSize);

  state.tp = [
    {
      id: 'TP1',
      price: tp1,
      takePct: state.tp[0]?.takePct ?? 0.4,
      status: state.tp[0]?.status ?? 'WORKING',
    },
    {
      id: 'TP2',
      price: tp2,
      takePct: state.tp[1]?.takePct ?? 0.3,
      status: state.tp[1]?.status ?? 'WORKING',
    },
    {
      id: 'TP3',
      price: tp3,
      takePct: state.tp[2]?.takePct ?? 0.3,
      status: state.tp[2]?.status ?? 'WORKING',
    },
  ];
};
