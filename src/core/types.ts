export type Side = 'SHORT';
export type OrderTag = 'ENTRY'|'DCA1'|'DCA2'|'DCA3'|'TP1'|'TP2'|'TP3'|'TP4'|'SL'|'TRAIL';

export type SymbolMeta = {
  symbol: string;
  tickSize: number; qtyStep: number; minOrderQty: number; // dapat dari exchangeInfo
  minNotionalUSD?: number; // optional cek extra
};

export type DealState = {
  dealId: string;
  symbol: string;
  side: Side;
  lev: number;
  entry: { price: number; qty: number; time: string; filled: boolean };
  dca: Array<{ id:'DCA1'|'DCA2'|'DCA3'; price: number; qty: number; status: 'WORKING'|'FILLED' }>;
  avgPrice: number;
  tp: Array<{ id:'TP1'|'TP2'|'TP3'|'TP4'; price: number; takePct: number; trailing?: number; status: 'WORKING'|'FILLED' }>;
  sl: { mode: 'preTP1'|'BEP'|'TP1'|'TRAIL'; price: number };
  flags: { tp1:boolean; tp2:boolean; tp3:boolean; tp4:boolean };
};
