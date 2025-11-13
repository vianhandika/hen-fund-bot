import { createSymbolLock, releaseSymbolLock } from '../../storage/file.repo.js';
import { logger } from '../../utils/logger.js';

/** Coba acquire lock untuk satu symbol; kalau gagal (sudah aktif), return false. */
export const tryAcquireSymbol = async (symbol: string): Promise<boolean> => {
  const ok = await createSymbolLock(symbol);
  if (!ok) {
    logger.debug({ symbol }, 'lock busy: symbol already active');
    return false;
  }
  return true;
};

/** Rilis lock symbol (idempotent). */
export const releaseSymbol = async (symbol: string): Promise<void> => {
  await releaseSymbolLock(symbol);
};

/** Jalankan `fn` di dalam critical section per-symbol. Return false jika gagal lock. */
export const withSymbolLock = async <T>(
  symbol: string,
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false }> => {
  const ok = await tryAcquireSymbol(symbol);
  if (!ok) return { ok: false };
  try {
    const value = await fn();
    return { ok: true, value };
  } finally {
    await releaseSymbol(symbol);
  }
};

