import {
  DCA_STEPS, DCA_MULTS, TP1_PCT, TP2_PCT_FROM_TP1, TP3_PCT_FROM_TP2,
  TP4_PCT_FROM_AVG, PRE_TP1_SL_MULT, TRIM_PCTS, TRAILING_AFTER_TP3
} from '../../config/constants.js';
import { roundUpToStep, pctAbove, pctBelow, roundToStep } from '../../utils/math.js';
import { SymbolMeta, DealState } from '../types.js';

export const makeInitialPlanByQty = (
  symbol: string,
  meta: SymbolMeta,
  entryPrice: number,
  entryQtyMin: number,
  entryMult: number,
  lev: number
): DealState => {
  const entryQty = roundUpToStep(entryQtyMin * entryMult, meta.qtyStep);
  const dcaPrices = DCA_STEPS.map((step) => roundToStep(pctAbove(entryPrice, step), meta.tickSize));
  const dcaQtys = DCA_MULTS.map((mult) => roundUpToStep(entryQty * mult, meta.qtyStep));

  const avg = entryPrice; // awalnya sama
  const tp1 = roundToStep(pctBelow(avg, TP1_PCT), meta.tickSize);
  const tp2 = roundToStep(tp1 * (1 - TP2_PCT_FROM_TP1), meta.tickSize);
  const tp3 = roundToStep(tp2 * (1 - TP3_PCT_FROM_TP2), meta.tickSize);
  const tp4 = roundToStep(avg * (1 - TP4_PCT_FROM_AVG), meta.tickSize);

  const slPre = roundToStep(avg * PRE_TP1_SL_MULT, meta.tickSize);

  return {
    dealId: `${symbol}-${Date.now()}`,
    symbol,
    side: 'SHORT',
    lev,
    entry: { price: entryPrice, qty: entryQty, time: new Date().toISOString(), filled: true },
    dca: [
      { id: 'DCA1', price: dcaPrices[0], qty: dcaQtys[0], status: 'WORKING' },
      { id: 'DCA2', price: dcaPrices[1], qty: dcaQtys[1], status: 'WORKING' },
      { id: 'DCA3', price: dcaPrices[2], qty: dcaQtys[2], status: 'WORKING' },
    ],
    avgPrice: avg,
    tp: [
      { id: 'TP1', price: tp1, takePct: TRIM_PCTS[0], status: 'WORKING' },
      { id: 'TP2', price: tp2, takePct: TRIM_PCTS[1], status: 'WORKING' },
      { id: 'TP3', price: tp3, takePct: TRIM_PCTS[2], trailing: TRAILING_AFTER_TP3, status: 'WORKING' },
      { id: 'TP4', price: tp4, takePct: TRIM_PCTS[3], status: 'WORKING' },
    ],
    sl: { mode: 'preTP1', price: slPre },
    flags: { tp1: false, tp2: false, tp3: false, tp4: false },
  };
};

/** Setelah DCA terisi, re-anchor TP & SL pra-TP1 dari avg baru */
export const reanchorFromAvg = (state: DealState, tickSize: number) => {
  const avg = state.avgPrice;
  const tp1 = roundToStep(avg * (1 - TP1_PCT), tickSize);
  const tp2 = roundToStep(tp1 * (1 - TP2_PCT_FROM_TP1), tickSize);
  const tp3 = roundToStep(tp2 * (1 - TP3_PCT_FROM_TP2), tickSize);
  const tp4 = roundToStep(avg * (1 - TP4_PCT_FROM_AVG), tickSize);
  state.tp = [
    { id: 'TP1', price: tp1, takePct: state.tp[0].takePct, status: state.tp[0].status },
    { id: 'TP2', price: tp2, takePct: state.tp[1].takePct, status: state.tp[1].status },
    { id: 'TP3', price: tp3, takePct: state.tp[2].takePct, trailing: state.tp[2].trailing, status: state.tp[2].status },
    { id: 'TP4', price: tp4, takePct: state.tp[3].takePct, status: state.tp[3].status },
  ];
  if (state.sl.mode === 'preTP1') {
    state.sl.price = roundToStep(avg * 1.5, tickSize);
  }
};
