/**
 * Same-network discovery (pure, import-free so the Vercel function, the host app and the join page can all use it).
 *
 * How it works: a browser cannot scan the LAN or read mDNS, and a public https page may not fetch a phone's http address. So the host phone and every
 * device that opened the website both tell a tiny "presence" function that they are here. The function groups them by the PUBLIC address the request came
 * from (devices on one Wi-Fi / hotspot share it), and returns the hosts of that group. The page then navigates (never fetches) to the host's private
 * LAN address, which is the real proof of "same network": a stranger sharing the public address cannot reach 192.168.x.x.
 * Nothing but presence travels through the function: no audio, no session data, no accounts.
 */
export const PRESENCE_TTL_MS = 25_000, HOST_HEARTBEAT_MS = 8_000, DEVICE_POLL_MS = 2_000, MAX_HOSTS = 6, MAX_DEVICES = 40, MAX_BODY = 1024;
export interface HostEntry { name: string; host: string; port: number; secure: boolean; token: string }
export interface PresenceIn { role: 'host' | 'device'; id: string; name?: string; leave?: boolean; host?: string; port?: number; secure?: boolean; token?: string }
export interface StoredEntry { id: string; role: 'host' | 'device'; name: string; at: number; host?: HostEntry }
export interface PublicHost extends HostEntry { ageS: number }
export interface PresenceOut { ok: true; persistent: boolean; hosts: PublicHost[]; devices: { name: string; ageS: number }[] }
export type Invalid = 'bad-json' | 'bad-role' | 'bad-id' | 'bad-name' | 'bad-host' | 'not-private' | 'bad-port' | 'bad-token';

const ID = /^[A-Za-z0-9_-]{12,40}$/, TOKEN = /^[A-Za-z0-9_-]{8,128}$/, IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/, MDNS = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/i;
/** Only RFC 1918 IPv4 and `.local` names: an announced address must be unreachable from the open internet (no open redirect, nothing to scan). */
export function isLanHost(h: string): boolean {
  if (MDNS.test(h)) return true; const m = IPV4.exec(h); if (!m) return false; const o = m.slice(1).map(Number); if (o.some((n) => n > 255)) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}
export const cleanName = (s: unknown, fallback: string) => { const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32) : ''; return t || fallback; };

/** Validates one presence message; everything that reaches storage or another person's browser passed through here. */
export function parsePresence(raw: unknown): { ok: true; v: PresenceIn & { name: string } } | { ok: false; reason: Invalid } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'bad-json' };
  const r = raw as Record<string, unknown>;
  if (r.role !== 'host' && r.role !== 'device') return { ok: false, reason: 'bad-role' };
  if (typeof r.id !== 'string' || !ID.test(r.id)) return { ok: false, reason: 'bad-id' };
  const name = cleanName(r.name, r.role === 'host' ? 'SyncWave host' : 'Device');
  const v: PresenceIn & { name: string } = { role: r.role, id: r.id, name, ...(r.leave === true ? { leave: true } : {}) };
  if (r.role === 'host' && r.leave !== true) {
    if (typeof r.host !== 'string') return { ok: false, reason: 'bad-host' };
    if (!isLanHost(r.host)) return { ok: false, reason: 'not-private' };
    if (typeof r.port !== 'number' || !Number.isInteger(r.port) || r.port < 1 || r.port > 65535) return { ok: false, reason: 'bad-port' };
    if (typeof r.token !== 'string' || !TOKEN.test(r.token)) return { ok: false, reason: 'bad-token' };
    v.host = r.host; v.port = r.port; v.secure = r.secure === true; v.token = r.token;
  }
  return { ok: true, v };
}
export const toStored = (v: PresenceIn & { name: string }, now: number): StoredEntry => ({ id: v.id, role: v.role, name: v.name, at: now, ...(v.role === 'host' && v.host ? { host: { name: v.name, host: v.host, port: v.port as number, secure: !!v.secure, token: v.token as string } } : {}) });
/** Public view: ids are secrets that authorise "leave", so they never leave the function; stale entries are dropped here (the store only expires whole groups). */
export function publicView(entries: StoredEntry[], now: number, selfId?: string): { hosts: PublicHost[]; devices: { name: string; ageS: number }[] } {
  const live = entries.filter((e) => now - e.at <= PRESENCE_TTL_MS && now - e.at >= -5000);
  return {
    hosts: live.filter((e) => e.role === 'host' && e.host).sort((a, b) => b.at - a.at).slice(0, MAX_HOSTS).map((e) => ({ ...(e.host as HostEntry), ageS: Math.max(0, Math.round((now - e.at) / 1000)) })),
    devices: live.filter((e) => e.role === 'device' && e.id !== selfId).sort((a, b) => b.at - a.at).slice(0, MAX_DEVICES).map((e) => ({ name: e.name, ageS: Math.max(0, Math.round((now - e.at) / 1000)) })),
  };
}
/** What the join page does with the list: one host = go now (fast, no tap), several = ask which, none = keep looking. */
export type Pick = { action: 'go'; host: PublicHost } | { action: 'choose'; hosts: PublicHost[] } | { action: 'wait' };
export function pickHost(hosts: PublicHost[], last?: { host: string; port: number }): Pick {
  const ok = hosts.filter((h) => isLanHost(h.host) && TOKEN.test(h.token));
  if (!ok.length) return { action: 'wait' }; if (ok.length === 1) return { action: 'go', host: ok[0] };
  const mine = last && ok.filter((h) => h.host === last.host && h.port === last.port); return mine && mine.length === 1 ? { action: 'go', host: mine[0] } : { action: 'choose', hosts: ok };
}
export const hostUrl = (h: HostEntry) => `${h.secure ? 'https' : 'http'}://${h.host}:${h.port}/#t=${h.token}`;
/** Caps per group, so one noisy network cannot fill the store. Returns the entries to keep after adding `incoming`. */
export function mergeEntries(existing: StoredEntry[], incoming: StoredEntry, now: number): StoredEntry[] {
  const keep = existing.filter((e) => e.id !== incoming.id && now - e.at <= PRESENCE_TTL_MS); const same = keep.filter((e) => e.role === incoming.role), other = keep.filter((e) => e.role !== incoming.role);
  const cap = incoming.role === 'host' ? MAX_HOSTS : MAX_DEVICES, trimmed = [...same.sort((a, b) => b.at - a.at).slice(0, cap - 1), incoming];
  return [...other, ...trimmed];
}
