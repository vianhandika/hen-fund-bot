const EPS = 1e-12;

export const roundUpToStep = (val: number, step: number) =>
  Math.ceil((val + EPS) / step) * step;

export const roundToStep = (val: number, step: number) =>
  Math.round((val + EPS) / step) * step;

export const pctAbove = (price: number, pct: number) => price * (1 + pct);
export const pctBelow = (price: number, pct: number) => price * (1 - pct);
