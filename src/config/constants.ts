import { ENV } from './index.js';

const parseNumberList = (
  raw: string | undefined,
  fallback: number[]
): number[] => {
  if (!raw) return fallback;

  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));

  return parts.length ? parts : fallback;
};

/* ==========================
 *     STRATEGY CONSTANTS
 * =========================*/

export const SHORT_ONLY = true as const;

// --- TP (SHORT) — langsung dari AVG ---
export const TP1_PCT = ENV.STRAT_TP1_PCT;
export const TP2_PCT = ENV.STRAT_TP2_PCT;
export const TP3_PCT = ENV.STRAT_TP3_PCT;

// --- Lock setelah TP1 (dipakai nanti di watcher) ---
export const LOCK_AFTER_TP1 = ENV.LOCK_AFTER_TP1;

// --- DCA steps & multipliers ---
export const DCA_STEPS = parseNumberList(
  ENV.STRAT_DCA_STEPS,
  [0.05, 0.15, 0.35, 0.75]
);

export const DCA_MULTS = parseNumberList(
  ENV.STRAT_DCA_MULTS,
  [1.5, 2.25, 3.4, 5.1]
);

// --- Trim per TP (3 TP) ---
export const TRIM_PCTS = parseNumberList(ENV.STRAT_TRIM_PCTS, [0.4, 0.3, 0.3]);
