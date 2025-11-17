import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import { ENV } from '../config/index.js';
import {
  buildPrivateWsAuthArgsV5,
  buildPrivateWsAuthArgsTsMs,
  buildPrivateWsAuthArgsTsSec,
  maskKey,
} from './ws.auth.js';

const WS_PRIVATE = String(ENV.BYBIT_WS_PRIVATE_URL ?? '').trim();

type TryPlan =
  | { kind: 'V5_EXPIRES'; label: string }
  | { kind: 'TS_MS'; label: string }
  | { kind: 'TS_SEC'; label: string };

const plans: TryPlan[] = [
  { kind: 'V5_EXPIRES', label: 'AUTH v5(GET/realtime+expires)' },
  { kind: 'TS_MS', label: 'AUTH ts+key (ms)' },
  { kind: 'TS_SEC', label: 'AUTH ts+key (s)' },
];

function buildArgs(plan: TryPlan, apiKey: string, apiSecret: string) {
  switch (plan.kind) {
    case 'V5_EXPIRES': {
      const recv = Number(ENV.WS_RECV_WINDOW ?? 5000);
      const args = buildPrivateWsAuthArgsV5(apiKey, apiSecret, recv);
      const expires = Number(args[1]);
      return { args, note: { expires } };
    }
    case 'TS_MS': {
      const args = buildPrivateWsAuthArgsTsMs(apiKey, apiSecret);
      return { args, note: { ts: args[1], tsMode: 'ms' } };
    }
    case 'TS_SEC': {
      const args = buildPrivateWsAuthArgsTsSec(apiKey, apiSecret);
      return { args, note: { ts: args[1], tsMode: 's' } };
    }
  }
}

export async function wsAuthSelfTest(): Promise<void> {
  const key = String(ENV.BYBIT_API_KEY ?? '').trim();
  const sec = String(ENV.BYBIT_API_SECRET ?? '').trim();

  return new Promise((resolve) => {
    const ws = new WebSocket(WS_PRIVATE);
    let done = false;
    let pingTimer: NodeJS.Timeout | null = null;
    let idx = 0;

    const finish = (ok: boolean, note: any = {}) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {}
      if (pingTimer) clearInterval(pingTimer);
      if (ok) logger.info({ ...note }, 'WS self-test: OK');
      else logger.warn({ ...note }, 'WS self-test: FAILED');
      resolve();
    };

    const tryAuth = () => {
      if (idx >= plans.length) {
        return finish(false, { stage: 'auth', ret_msg: 'All attempts failed' });
      }
      const plan = plans[idx];
      const built = buildArgs(plan, key, sec);
      logger.info(
        { attempt: plan.label, note: built.note },
        'WS self-test: auth attempt'
      );
      ws.send(JSON.stringify({ op: 'auth', args: built.args }));
    };

    ws.on('open', () => {
      logger.info(
        { url: WS_PRIVATE, key_fingerprint: maskKey(key) },
        'WS self-test: open'
      );
      pingTimer = setInterval(() => {
        try {
          ws.send(JSON.stringify({ op: 'ping', req_id: 'selftest' }));
        } catch {}
      }, 20_000);
      tryAuth();
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.op === 'pong') return;

        if (msg.op === 'auth') {
          const ok = !!msg.success;
          const retMsg = msg.ret_msg ?? msg.retMsg;
          if (!ok) {
            logger.warn(
              { ret_msg: retMsg, attempt: plans[idx]?.label },
              'WS self-test: auth not ok'
            );
            idx += 1;
            return tryAuth();
          }
          ws.send(JSON.stringify({ op: 'subscribe', args: ['execution'] }));
          return;
        }

        if (msg.op === 'subscribe') {
          if (msg.success === true) return finish(true, { stage: 'subscribe' });
          return finish(false, {
            stage: 'subscribe',
            ret_msg: msg.ret_msg ?? msg.retMsg,
          });
        }
      } catch (e) {
        return finish(false, { stage: 'parse', err: String(e) });
      }
    });

    ws.on('error', (e) => finish(false, { stage: 'error', err: String(e) }));
    ws.on('close', () => finish(false, { stage: 'closed' }));
    setTimeout(() => finish(false, { stage: 'timeout' }), 10_000);
  });
}
