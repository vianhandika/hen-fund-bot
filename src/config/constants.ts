export const SHORT_ONLY = true;        // hard rule
// export const TP1_PCT = 0.008;          // 0.8% dari avg
// export const TP2_PCT_FROM_TP1 = 0.016; // 1.6% dari TP1
export const TP1_PCT = 0.01;          // 0.8% dari avg
export const TP2_PCT_FROM_TP1 = 0.02; // 1.6% dari TP1
export const TP3_PCT_FROM_TP2 = 0.04;  // 4% dari TP2
export const TP4_PCT_FROM_AVG = 0.40;  // 40% dari avg
export const TRAILING_AFTER_TP3 = 0.03;// 3%
export const DCA_STEPS = [0.05, 0.15, 0.35];       // +5/15/35% dari entry awal
export const DCA_MULTS = [1.5, 2.25, 3.4];         // kelipatan qty
export const TRIM_PCTS = [0.30, 0.30, 0.30, 0.10]; // TP1..TP4
export const PRE_TP1_SL_MULT = 1.5;   // SL pra-TP1 = avg * 1.5 (SHORT)