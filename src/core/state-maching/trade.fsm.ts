import { DealState } from '../types.js';
import { FillEvent } from '../events.js';
import { calcVWAP } from '../pricing/average.js';
import { reanchorFromAvg } from '../planner/plan.short.js';

export const onFill = (
  state: DealState,
  ev: FillEvent,
  meta: { tickSize: number; qtyStep: number }
) => {
  switch (ev.tag) {
    case 'ENTRY':
      return state;

    case 'DCA1':
    case 'DCA2':
    case 'DCA3': {
      const legs = [
        { price: state.entry.price, qty: state.entry.qty },
        ...state.dca
          .filter((d) => d.status === 'FILLED')
          .map((d) => ({ price: d.price, qty: d.qty })),
        { price: ev.price, qty: ev.qty },
      ];
      state.avgPrice = calcVWAP(legs);
      const target = state.dca.find((d) => d.id === ev.tag);
      if (target) target.status = 'FILLED';
      reanchorFromAvg(state, meta.tickSize);
      return state;
    }

    case 'TP1':
    case 'TP2':
    case 'TP3':
    case 'TP4': {
      const id = ev.tag;
      state.tp = state.tp.map((t) => (t.id === id ? { ...t, status: 'FILLED' } : t));
      (state.flags as any)[id.toLowerCase()] = true;
      return state;
    }

    case 'SL':
    case 'TRAIL':
      return state;
  }
};
