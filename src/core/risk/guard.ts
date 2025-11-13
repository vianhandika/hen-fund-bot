import { ENV } from '../../config/index.js';
import { isInWindowWIB, toWib } from '../../utils/time.js';

export const shouldSkipByWindowAndFunding = (fundingRate: number, createdAtISO: string) => {
  const t = toWib(createdAtISO);

  if (Number.isFinite(fundingRate) && fundingRate <= -1) return true;

  if (isInWindowWIB(t, ENV.WINDOW_SKIP_START, ENV.WINDOW_SKIP_END)) return true;

  return false;
};