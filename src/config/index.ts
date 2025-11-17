import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  BYBIT_BASE_URL: z.string().default('https://api.bybit.com'),
  BYBIT_WS_PRIVATE_URL: z.string().default('wss://stream.bybit.com/v5/private'),
  BYBIT_API_KEY: z.string().min(1),
  BYBIT_API_SECRET: z.string().min(1),
  BYBIT_ACCOUNT_TYPE: z.enum(['contract', 'unified']).default('contract'),
  BYBIT_LEVERAGE: z.coerce.number().int().default(0),
  ENTRY_USD: z.coerce.number().int().positive().default(1),
  ENTRY_MULT: z.coerce.number().positive().default(1),

  BOT_MODE: z.enum(['live', 'paper', 'dry']).default('live'),
  TZ: z.string().default('Asia/Jakarta'),
  DATA_DIR: z.string().default('./src/storage/files'),
  WINDOW_SKIP_START: z.string().default('23:00'),
  WINDOW_SKIP_END: z.string().default('04:00'),

  WS_RECV_WINDOW: z.coerce.number().positive().default(5000),
  WS_SELFTEST: z.string().default('1'),

  STRAT_TP1_PCT: z.coerce.number().positive().default(0.025),
  STRAT_TP2_PCT: z.coerce.number().positive().default(0.05),
  STRAT_TP3_PCT: z.coerce.number().positive().default(0.1),

  LOCK_AFTER_TP1: z.coerce.number().nonnegative().default(0.005),

  STRAT_TRIM_PCTS: z.string().default('0.4,0.3,0.3'),
  STRAT_DCA_STEPS: z.string().default('0.05,0.15,0.35,0.75'),
  STRAT_DCA_MULTS: z.string().default('1.5,2.25,3.4,5.1'),

  DISCORD_TOKEN: z.string().optional(),
  DISCORD_ALERT_CHANNEL_ID: z.string().optional(),
  DISCORD_MANUAL_CHANNEL_ID: z.string().optional(),

  LOG_LEVEL: z.string().optional(),
});

export const ENV = EnvSchema.parse(process.env);
