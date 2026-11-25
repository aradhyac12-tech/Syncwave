/**
 * Presence function internals (Vercel serverless, no npm dependencies). Connection purposes only: it stores who is online per network for ~25 s.
 * Storage: Upstash Redis / Vercel KV over its REST API when configured (needed for reliability: serverless instances do not share memory),
 * otherwise an in-memory fallback that works on a single warm instance only and says so (`persistent: false`).
 */
import { createHash } from 'node:crypto';
import { parsePresence, toStored, publicView, mergeEntries, MAX_BODY, PRESENCE_TTL_MS, type StoredEntry, type PresenceOut } from '../src/shared/rendezvous.js';

export interface Store { persistent: boolean; get(key: string): Promise<string | null>; set(key: string, value: string, ttlS: number): Promise<void> }
export function memoryStore(): Store {
  const m = new Map<string, { v: string; exp: number }>();
  return { persistent: false, async get(k) { const e = m.get(k); if (!e || e.exp < Date.now()) { m.delete(k); return null; } return e.v; }, async set(k, v, ttl) { m.set(k, { v, exp: Date.now() + ttl * 1000 }); if (m.size > 5000) for (const [kk, e] of m) if (e.exp < Date.now()) m.delete(kk); } };
}
export function upstashStore(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch): Store | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL, token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN; if (!url || !token) return null;
  const run = async (cmd: (string | number)[]) => { const r = await fetchFn(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(2500) }); if (!r.ok) throw new Error(`store ${r.status}`); return (await r.json()) as { result?: unknown }; };
  return { persistent: true, async get(k) { const j = await run(['GET', k]); return typeof j.result === 'string' ? j.result : null; }, async set(k, v, ttl) { await run(['SET', k, v, 'EX', ttl]); } };
}

/** First hop of x-forwarded-for (Vercel sets it). IPv6 is reduced to its /64 so a phone's changing privacy addresses stay in one group. */
export function clientIp(h: Record<string, string | string[] | undefined>): string {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const raw = (pick(h['x-forwarded-for']).split(',')[0] || pick(h['x-real-ip'])).trim();
  if (!raw.includes(':')) return raw.replace(/^::ffff:/i, '');
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw); if (v4) return v4[1];
  const [a, b = ''] = raw.split('::'), left = a ? a.split(':') : [], right = b ? b.split(':') : [], fill = raw.includes('::') ? Array(Math.max(0, 8 - left.length - right.length)).fill('0') : [];
  return [...left, ...fill, ...right].slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
export const roomKey = (ip: string, salt = '') => 'sw:rdv:' + createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 32);

export interface Req { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
export interface Res { status: number; headers: Record<string, string>; body: string }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (status: number, o: unknown): Res => ({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

export async function handle(req: Req, store: Store, salt: string, now = Date.now()): Promise<Res> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS, body: '' };
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'method' });
  let raw = req.body; if (typeof raw === 'string') { if (raw.length > MAX_BODY) return reply(413, { ok: false, error: 'too-large' }); try { raw = JSON.parse(raw); } catch { return reply(400, { ok: false, error: 'bad-json' }); } }
  else if (raw && JSON.stringify(raw).length > MAX_BODY) return reply(413, { ok: false, error: 'too-large' });
  const p = parsePresence(raw); if (!p.ok) return reply(400, { ok: false, error: p.reason });
  const ip = clientIp(req.headers); if (!ip) return reply(400, { ok: false, error: 'no-ip' });
  const key = roomKey(ip, salt);
  try {
    const text = await store.get(key); let entries: StoredEntry[] = []; try { const j = text ? JSON.parse(text) : []; if (Array.isArray(j)) entries = j; } catch { /* corrupt: start over */ }
    entries = p.v.leave ? entries.filter((e) => e.id !== p.v.id) : mergeEntries(entries, toStored(p.v, now), now);
    entries = entries.filter((e) => now - e.at <= PRESENCE_TTL_MS);
    await store.set(key, JSON.stringify(entries), Math.ceil(PRESENCE_TTL_MS / 1000) + 5);
    const v = publicView(entries, now, p.v.id), out: PresenceOut = { ok: true, persistent: store.persistent, ...v };
    return reply(200, out);
  } catch { return reply(503, { ok: false, error: 'store-unavailable' }); }
}
