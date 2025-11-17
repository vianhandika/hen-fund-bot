import { promises as fs } from 'fs';
import path from 'path';
import { ENV } from '../config/index.js';
import { nowWib } from '../utils/time.js';

const ensureDir = async (dir: string) => fs.mkdir(dir, { recursive: true });

const paths = {
  dataDir: ENV.DATA_DIR,
  symbol: () => path.join(ENV.DATA_DIR, 'symbol.json'),
  statesDir: () => path.join(ENV.DATA_DIR, 'states'),
  locksDir: () => path.join(ENV.DATA_DIR, 'locks'),
  state: (symbol: string) =>
    path.join(paths.statesDir(), `state-${symbol}.json`),
  lock: (symbol: string) =>
    path.join(paths.locksDir(), `active-${symbol}.lock`),
  journal: (dateStr: string) =>
    path.join(ENV.DATA_DIR, `journal-${dateStr}.json`),
  stale: () => path.join(ENV.DATA_DIR, 'stale-SYMBOLS.json'),
};

export type SymbolItem = {
  symbol: string;
  fundingRate: number;
  createdAt: string;
};

export const initStorage = async () => {
  await ensureDir(paths.dataDir);
  await ensureDir(paths.statesDir());
  await ensureDir(paths.locksDir());

  try {
    await fs.access(paths.symbol());
  } catch {
    await fs.writeFile(paths.symbol(), '[]', 'utf8');
  }

  try {
    await fs.access(paths.stale());
  } catch {
    await fs.writeFile(paths.stale(), '[]', 'utf8');
  }
};

export const readSymbols = async (): Promise<SymbolItem[]> => {
  const buf = await fs.readFile(paths.symbol(), 'utf8');
  return JSON.parse(buf || '[]');
};

export const upsertSymbolIfNotExists = async (item: SymbolItem) => {
  const file = paths.symbol();
  const tmp = `${file}.tmp`;
  const list = await readSymbols();
  if (list.some((x) => x.symbol === item.symbol)) return false;
  list.push(item);
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await fs.rename(tmp, file);
  return true;
};

export const removeSymbol = async (symbol: string) => {
  const file = paths.symbol();
  const tmp = `${file}.tmp`;
  const list = await readSymbols();
  const next = list.filter((x) => x.symbol !== symbol);
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await fs.rename(tmp, file);
};

export const createSymbolLock = async (symbol: string): Promise<boolean> => {
  const file = paths.lock(symbol);
  try {
    const handle = await fs.open(file, 'wx');
    await handle.write(
      JSON.stringify({ lockedAt: nowWib().toISOString(), symbol })
    );
    await handle.close();
    return true;
  } catch {
    return false;
  }
};

export const releaseSymbolLock = async (symbol: string) => {
  try {
    await fs.unlink(paths.lock(symbol));
  } catch {}
};

export const writeState = async (symbol: string, data: unknown) => {
  const file = paths.state(symbol);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
};

export const readState = async <T>(symbol: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(paths.state(symbol), 'utf8'));
  } catch {
    return null;
  }
};

export const removeState = async (symbol: string) => {
  try {
    await fs.unlink(paths.state(symbol));
  } catch {}
};

// 🔴 Disesuaikan dengan watcher: 3 TP + SL (NO TP4/TRAILING)
export type FinalJournal = {
  tsClose: string;
  dealId: string;
  symbol: string;
  side: 'SHORT';
  lev: number;
  entry: { time: string; price: number; qty: number };
  dcaHits: { filled: string[] };
  exit: { mode: 'TP1' | 'TP2' | 'TP3' | 'SL'; price: number; time: string };
  pnl: {
    realizedUSD: number;
    feesUSD: number;
    fundingUSD: number;
    netUSD: number;
  };
  path: { tp1: boolean; tp2: boolean; tp3: boolean };
};

export const appendFinalJournal = async (row: FinalJournal) => {
  const dateStr = nowWib().format('YYYY-MM-DD');
  const file = paths.journal(dateStr);
  await ensureDir(paths.dataDir);
  await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
};

/* -----------------------------
 *  STALE SYMBOLS MANAGEMENT
 * ----------------------------*/
type StaleEntry = { symbol: string; reason?: string; at?: string };

export const readStale = async (): Promise<StaleEntry[]> => {
  try {
    const buf = await fs.readFile(paths.stale(), 'utf8');
    return JSON.parse(buf || '[]');
  } catch {
    return [];
  }
};

const writeStale = async (rows: StaleEntry[]) => {
  const file = paths.stale();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await fs.rename(tmp, file);
};

export const addToStale = async (symbol: string, reason?: string) => {
  const rows = await readStale();
  if (!rows.find((r) => r.symbol === symbol)) {
    rows.push({ symbol, reason, at: nowWib().toISOString() });
    await writeStale(rows);
  }
};

export const removeFromStale = async (symbol: string) => {
  const rows = await readStale();
  const next = rows.filter((r) => r.symbol !== symbol);
  if (next.length !== rows.length) {
    await writeStale(next);
  }
};

export const clearStale = async () => {
  await writeStale([]);
};
