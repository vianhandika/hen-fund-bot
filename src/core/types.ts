export type Side = 'SHORT';

export type OrderTag =
  | 'ENTRY'
  | 'DCA1'
  | 'DCA2'
  | 'DCA3'
  | 'DCA4'
  | 'TP1'
  | 'TP2'
  | 'TP3'
  | 'SL';

export type SymbolMeta = {
  symbol: string;
  tickSize: number;
  qtyStep: number;
  minOrderQty: number;
  minNotionalUSD?: number;
};

export type DealState = {
  dealId: string;
  symbol: string;
  side: 'SHORT';
  lev: number;
  entry: { price: number; qty: number; time: string; filled: boolean };
  dca: Array<{
    id: 'DCA1' | 'DCA2' | 'DCA3' | 'DCA4';
    price: number;
    qty: number;
    status: 'WORKING' | 'FILLED';
  }>;
  avgPrice: number;
  tp: Array<{
    id: 'TP1' | 'TP2' | 'TP3';
    price: number;
    takePct: number;
    status: 'WORKING' | 'FILLED';
  }>;
  sl: { mode: 'NONE' | 'BEP' | 'TP1'; price: number };
  flags: { tp1: boolean; tp2: boolean; tp3: boolean };
};
