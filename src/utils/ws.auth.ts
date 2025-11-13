// src/utils/ws.auth.ts
import crypto from 'crypto';

export type AuthArgsV5 = [apiKey: string, expiresMs: string, sign: string];
export type AuthArgsTsKey = [apiKey: string, ts: string, sign: string];

function hmacHex(secret: string, msg: string) {
  return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

export function buildPrivateWsAuthArgsV5(
  apiKey: string,
  apiSecret: string,
  recvWindowMs = 5000
): AuthArgsV5 {
  const expires = Date.now() + Math.max(1000, recvWindowMs);
  const sign = hmacHex(apiSecret, 'GET/realtime' + String(expires));
  return [apiKey.trim(), String(expires), sign];
}

export function buildPrivateWsAuthArgsTsMs(
  apiKey: string,
  apiSecret: string
): AuthArgsTsKey {
  const ts = Date.now().toString();
  const sign = hmacHex(apiSecret, ts + apiKey.trim());
  return [apiKey.trim(), ts, sign];
}

export function buildPrivateWsAuthArgsTsSec(
  apiKey: string,
  apiSecret: string
): AuthArgsTsKey {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sign = hmacHex(apiSecret, ts + apiKey.trim());
  return [apiKey.trim(), ts, sign];
}

export function maskKey(k: string) {
  const s = (k || '').trim();
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '…' + s.slice(-4);
}
