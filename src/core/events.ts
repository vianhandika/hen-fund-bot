export type FillEvent =
  | { tag: 'ENTRY'; price: number; qty: number; time: string }
  | {
      tag: 'DCA1' | 'DCA2' | 'DCA3' | 'DCA4';
      price: number;
      qty: number;
      time: string;
      partial?: boolean;
    }
  | {
      tag: 'TP1' | 'TP2' | 'TP3';
      price: number;
      qty: number;
      time: string;
    }
  | {
      tag: 'SL';
      price: number;
      time: string;
    };
