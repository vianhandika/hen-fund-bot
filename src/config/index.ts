import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  BYBIT_BASE_URL: z.string().default('https://api.bybit.com'),
  BYBIT_API_KEY: z.string().min(1),
  BYBIT_API_SECRET: z.string().min(1),

  // contract = akun derivatives biasa, unified = Unified Trading Account
  BYBIT_ACCOUNT_TYPE: z.enum(['contract', 'unified']).default('contract'),

  BYBIT_LEVERAGE: z.coerce.number().int().positive().default(10),
  ENTRY_USD: z.coerce.number().int().positive().default(1),
  
  BOT_MODE: z.enum(['live', 'paper', 'dry']).default('live'),
  TZ: z.string().default('Asia/Jakarta'),
  DATA_DIR: z.string().default('./src/storage/files'),
  ENTRY_MULT: z.coerce.number().positive().default(1),
  TRAILING_PCT: z.coerce.number().positive().default(0.03),
  WINDOW_SKIP_START: z.string().default('23:00'),
  WINDOW_SKIP_END: z.string().default('04:00'),
  WS_RECV_WINDOW: z.coerce.number().positive().default(5000),
  WS_SELFTEST : z.string().default('1'),

  // Discord
  DISCORD_TOKEN: z.string().optional(),
  DISCORD_ALERT_CHANNEL_ID: z.string().optional(),
  DISCORD_MANUAL_CHANNEL_ID: z.string().optional(),

  // Opsional
  LOG_LEVEL: z.string().optional(),
});

export const ENV = EnvSchema.parse(process.env);
