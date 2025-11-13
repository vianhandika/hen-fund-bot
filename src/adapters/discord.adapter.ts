import { ActivityType, Client, GatewayIntentBits } from 'discord.js';
import { ENV } from '../config/index.js';
import { logger } from '../utils/logger.js';
import dayjs from '../utils/time.js';
import { ingestSignal } from '../services/orchestrator.service.js';

type Parsed = { symbol: string; fundingRate: number; createdAt: string } | null;

/* ----------------------------- Helpers ----------------------------- */

// Hilangkan formatting markdown/link di Discord
const stripMd = (s: string) =>
  String(s || '')
    // [TEXT](url) -> TEXT
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // <...> -> (hapus)
    .replace(/<[^>]+>/g, '')
    .trim();

const normalizeBybitPair = (raw?: string) => {
  if (!raw) return undefined;
  let base = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (base.endsWith('PERP')) {
    base = base.slice(0, -4); // buang 'PERP'
  }
  // Jika sudah USDT, biarkan. Jika belum, tambahkan.
  return base.endsWith('USDT') ? base : `${base}USDT`;
};

/** Ambil SYMBOL dari URL Bybit: .../usdt/<pair>?...  ->  <PAIR>USDT */
const extractSymbolFromUrl = (url?: string) => {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const ix = segs.findIndex((s) => s.toLowerCase() === 'usdt');
    if (ix >= 0 && segs[ix + 1]) {
      return normalizeBybitPair(segs[ix + 1]);
    }
  } catch (_) {}
  return undefined;
};

const pickSymbolFromText = (s?: string) => {
  if (!s) return undefined;
  let m = s.match(/\b([A-Z0-9]{2,}USDT)\b/i);
  if (m) return normalizeBybitPair(m[1]);
  m = s.match(/\b([A-Z0-9]{2,})PERP\b/i);
  if (m) return normalizeBybitPair(m[1] + 'PERP');
  m = s.match(/\b([A-Z0-9]{2,})\b/);
  if (m) return normalizeBybitPair(m[1]);

  return undefined;
};

const pickFunding = (s?: string) => {
  if (!s) return undefined;
  const m = s.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : undefined;
};

const pickUrls = (s?: string) => {
  if (!s) return [];
  return s.match(/https?:\/\/[^\s)]+/g) || [];
};

/* ----------------------------- Parser: EMBED AO ----------------------------- */
/**
 * Strategi:
 * 1) Cari field "Asset" (atau "Symbol") -> mungkin berupa [CLANKERUSDT](url)
 * 2) Cari field "Funding Rate"
 * 3) Jika Asset belum ketemu, coba dari emb.url, atau URL yang ada di field/description/title (ambil segmen setelah /usdt/)
 * 4) Fallback: cari SYMBOLUSDT di title/description
 * 5) Funding fallback dari description
 */
const parseFromEmbed = (msg: any): Parsed => {
  if (!msg.embeds || msg.embeds.length === 0) return null;
  const emb = msg.embeds[0];

  const fields = Array.isArray(emb.fields) ? emb.fields : [];
  const getField = (needle: string) =>
    fields.find(
      (f: any) =>
        typeof f?.name === 'string' &&
        f.name.toLowerCase().includes(needle.toLowerCase())
    )?.value as string | undefined;

  // 1) asset dari field
  const assetFieldRaw = getField('asset') || getField('symbol') || '';
  const assetText = stripMd(assetFieldRaw);
  let symbol =
    pickSymbolFromText(assetText) || undefined;

  // 2) funding dari field
  const frFieldRaw = getField('funding') || '';
  let fundingRate: number | undefined = pickFunding(stripMd(frFieldRaw));

  // 3) URL sources
  if (!symbol) {
    symbol = extractSymbolFromUrl((emb as any).url);
  }
  if (!symbol) {
    const bucket =
      String(assetFieldRaw || '') +
      ' ' +
      String(emb?.description || '') +
      ' ' +
      String(emb?.title || '');
    for (const u of pickUrls(bucket)) {
      symbol = extractSymbolFromUrl(u);
      if (symbol) break;
    }
  }

  // 4) Fallback dari title/description plain
  if (!symbol) {
    symbol =
      pickSymbolFromText(stripMd(emb?.title || '')) ||
      pickSymbolFromText(stripMd(emb?.description || ''));
  }

  // 5) Funding fallback dari description bila field kosong
  if (fundingRate == null) {
    fundingRate = pickFunding(stripMd(emb?.description || ''));
  }

  // 🔴 Penting: pastikan tidak undefined/null sebelum return
  if (!symbol || fundingRate == null || !Number.isFinite(fundingRate)) {
    logger.warn(
      {
        ch: msg.channelId,
        title: emb?.title,
        url: (emb as any)?.url,
        haveSymbol: !!symbol,
        haveFR: fundingRate != null && Number.isFinite(fundingRate),
      },
      'Discord embed parse failed (symbol/funding missing)'
    );
    return null;
  }

  const createdAt = dayjs(msg.createdTimestamp).tz(ENV.TZ).toISOString();
  return { symbol, fundingRate, createdAt };
};
/* ----------------------------- Parser: MANUAL ----------------------------- */
/** Format:
 * Asset: CLANKERUSDT
 * Funding Rate: 0.0050%
 */
const parseManual = (content: string): Parsed => {
  const s = content.trim();

  // Format multi-line
  {
    const assetM = s.match(/Asset:\s*([A-Z0-9\-]{2,})/i);
    const frM = s.match(/Funding\s*Rate:\s*([+-]?\d+(?:\.\d+)?)\s*%/i);
    if (assetM && frM) {
      const norm = normalizeBybitPair(assetM[1]);
      if (norm) {
        return {
          symbol: norm,
          fundingRate: Number(frM[1]),
          createdAt: dayjs().tz(ENV.TZ).toISOString(),
        };
      }
    }
  }

  // JSON penuh (opsional)
  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      const o = JSON.parse(s);
      if (o?.symbol && typeof o.fundingRate === 'number') {
        const norm = normalizeBybitPair(String(o.symbol));
        if (norm) {
          return {
            symbol: norm,
            fundingRate: Number(o.fundingRate),
            createdAt: o.createdAt
              ? String(o.createdAt)
              : dayjs().tz(ENV.TZ).toISOString(),
          };
        }
      }
    } catch {}
  }

  // Inline: SYMBOL fr=0.0050 [at=ISO] (opsional)
  const m = s.match(
    /^([A-Z0-9\-]+)\s+fr=([+-]?\d+(?:\.\d+)?)(?:\s+at=([^\s]+))?$/i
  );
  if (m) {
    const [, sym, fr, at] = m;
    const norm = normalizeBybitPair(sym);
    if (norm) {
      return {
        symbol: norm,
        fundingRate: Number(fr),
        createdAt: at ? String(at) : dayjs().tz(ENV.TZ).toISOString(),
      };
    }
  }

  return null;
};


/* ----------------------------- Bootstrap ----------------------------- */

export const startDiscord = async () => {
  if (!ENV.DISCORD_TOKEN) {
    logger.warn('Discord disabled: missing DISCORD_TOKEN');
    return;
  }

  const alertId = process.env.DISCORD_ALERT_CHANNEL_ID;
  const manualId = process.env.DISCORD_MANUAL_CHANNEL_ID;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on('ready', () => {
    client.user?.setPresence({
      status: 'online',
      activities: [{ name: 'Bybit DCA (SHORT)', type: ActivityType.Watching }],
    });
    logger.info({ user: client.user?.tag }, 'Discord connected');
  });

  client.on('messageCreate', async (msg) => {
    try {
      let parsed: Parsed = null;

      // 1) AO alert channel (embed)
      if (alertId && msg.channelId === alertId) {
        parsed = parseFromEmbed(msg);
      }

      // 2) Manual channel (text) — hanya kalau bukan bot
      if (!parsed && manualId && msg.channelId === manualId && !msg.author.bot) {
        parsed = parseManual(msg.content);
      }

      if (!parsed) return;

      await ingestSignal(parsed);
      logger.info(
        {
          symbol: parsed.symbol,
          fr: parsed.fundingRate,
          at: parsed.createdAt,
          ch: msg.channelId,
        },
        'Signal ingested (Discord)'
      );
      await msg.react('✅').catch(() => {});
    } catch (e) {
      logger.error(e, 'Discord handler error');
      await msg.react('⚠️').catch(() => {});
    }
  });

  await client.login(ENV.DISCORD_TOKEN);
};
