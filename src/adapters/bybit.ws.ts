// src/adapters/bybit.ws.ts
import WebSocket from 'ws';
import { ENV } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { buildPrivateWsAuthArgsV5, maskKey } from '../utils/ws.auth.js';

export type FillCb = (ev: { tag: string; price: number; qty: number; time: string }) => void;
export type AuthStatusCb = (s: 'AUTH_OK' | 'AUTH_FAIL') => void;

const API_KEY = String(ENV.BYBIT_API_KEY ?? '').trim();
const API_SECRET = String(ENV.BYBIT_API_SECRET ?? '').trim();

// MAINNET (USDT perpetual / unified)
const WS_PRIVATE_URL = 'wss://stream.bybit.com/v5/private';

/* ===============================
 *        PRIVATE EXECUTION
 * =============================*/
export const subscribeFills = async (
  symbol: string,
  cb: FillCb,
  onAuthStatus?: AuthStatusCb
) => {
  const ws = new WebSocket(WS_PRIVATE_URL);

  let alive = true;
  let lastPongTs = Date.now();
  let pingTimer: NodeJS.Timeout | null = null;
  let guardTimer: NodeJS.Timeout | null = null;
  let authed = false;

  const sendPing = () => {
    try {
      ws.send(JSON.stringify({ op: 'ping', req_id: String(Date.now()) }));
    } catch {}
  };

  ws.on('open', () => {
    logger.info({ url: WS_PRIVATE_URL, key: maskKey(API_KEY) }, 'WS private: open');

    const recv = Number(ENV.WS_RECV_WINDOW ?? 5000);
    const args = buildPrivateWsAuthArgsV5(API_KEY, API_SECRET, recv);
    ws.send(JSON.stringify({ op: 'auth', args }));

    pingTimer = setInterval(sendPing, 20_000);
    guardTimer = setInterval(() => {
      if (!alive) return;
      if (Date.now() - lastPongTs > 60_000) {
        logger.warn({ symbol }, 'WS private: no pong >60s, closing');
        try { ws.close(); } catch {}
      }
    }, 5_000);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));

      if (msg.op === 'pong') { lastPongTs = Date.now(); return; }

      if (msg.op === 'auth') {
        const ok = !!msg.success;
        const retMsg = msg.ret_msg ?? msg.retMsg;
        logger.info({ success: ok, ret_msg: retMsg }, 'WS private: auth result');

        if (!ok) {
          onAuthStatus?.('AUTH_FAIL');
          logger.error({ ret_msg: retMsg }, 'WS private: auth failed');
          return;
        }

        authed = true;
        onAuthStatus?.('AUTH_OK');
        ws.send(JSON.stringify({ op: 'subscribe', args: ['execution'] }));
        return;
      }

      if (msg.op === 'subscribe' && msg.success) {
        logger.info({ args: msg.args }, 'WS private: subscribed');
        return;
      }

      if (authed && msg.topic === 'execution' && Array.isArray(msg.data)) {
        for (const ex of msg.data) {
          if (!ex || ex.symbol !== symbol) continue;
          if (ex.execType !== 'Trade') continue;

          const link: string = ex.orderLinkId || '';
          const tag = link ? String(link).split('-')[0]?.toUpperCase() || '' : '';

          const evPayload = {
            tag,
            price: Number(ex.execPrice),
            qty: Number(ex.execQty),
            time: new Date(Number(ex.execTime || Date.now())).toISOString(),

            reduceOnly: ex.reduceOnly === true || ex.reduce_only === true,
            stopOrderType: ex.stopOrderType || ex.stop_order_type || ex.triggerBy || ex.trigger_by || '',
            orderType: ex.orderType || ex.order_type || '',
            leavesQty: Number(ex.leavesQty ?? ex.leaves_qty ?? ex.leaves ?? 0),
            orderQty: Number(ex.orderQty ?? ex.order_qty ?? NaN),
            cumExecQty: Number(ex.cumExecQty ?? ex.cum_exec_qty ?? ex.qty ?? 0)
          };

          logger.info({ symbol, tag: tag || '-', price: evPayload.price, qty: evPayload.qty }, 'WS exec');
          cb(evPayload as any);
        }
      }
    } catch (e) {
      logger.warn({ e: String((e as any)?.message ?? e) }, 'WS private: parse error');
    }
  });

  ws.on('pong', () => { lastPongTs = Date.now(); });

  ws.on('error', (err) => {
    alive = false;
    if (pingTimer) clearInterval(pingTimer);
    if (guardTimer) clearInterval(guardTimer);
    logger.error({ err: String((err as any)?.message ?? err) }, 'WS private: error');
  });

  ws.on('close', (code, reason) => {
    alive = false;
    if (pingTimer) clearInterval(pingTimer);
    if (guardTimer) clearInterval(guardTimer);
    logger.warn({ code, reason: String(reason) }, 'WS private: close');
  });

  return () => {
    if (!alive) return;
    alive = false;
    if (pingTimer) clearInterval(pingTimer);
    if (guardTimer) clearInterval(guardTimer);
    try { ws.close(); } catch {}
  };
};
