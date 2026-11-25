/**
 * Pairing links (V17). Pure functions shared by the host app (builds links/QR), the full receiver and the tiny public join page (parses what a person
 * pastes or scans and decides where the browser may go). Nothing here touches the network.
 *
 * Security rule: the public join page only ever redirects to a PRIVATE-network address (RFC 1918 IPv4, localhost, or a `.local` mDNS name), so a crafted
 * link on the public site cannot be used as an open redirect to an arbitrary website.
 */
export const DEFAULT_HTTP_PORT = 8080, DEFAULT_WS_PORT = 8081, DEFAULT_HTTPS_PORT = 8443, DEFAULT_WSS_PORT = 8444;
export interface JoinTarget { host: string; port: number; secure: boolean; token: string }
export type JoinParse = { ok: true; target: JoinTarget } | { ok: false; reason: 'empty' | 'no-token' | 'bad-host' | 'bad-port' | 'not-private' };

const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export function isPrivateHost(h: string): boolean {
  const host = h.toLowerCase();
  if (host === 'localhost' || /^[a-z0-9-]+\.local$/.test(host)) return true;
  const m = IPV4.exec(host); if (!m) return false;
  const o = m.slice(1).map(Number); if (o.some((n) => n > 255)) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || o[0] === 127 || (o[0] === 169 && o[1] === 254);
}
const HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;
const validPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;

/** Builds the two links a host shows: `plain` (http, works everywhere, no microphone in the browser) and `secure` (https, self-signed certificate, enables the optional microphone calibration). */
export function buildJoinLinks(o: { ip: string; httpPort: number; httpsPort?: number; token: string }) {
  return { plain: `http://${o.ip}:${o.httpPort}/#t=${o.token}`, secure: o.httpsPort ? `https://${o.ip}:${o.httpsPort}/#t=${o.token}` : undefined };
}

/**
 * Accepts: a full pairing link (`http(s)://192.168.43.1:8080/#t=TOKEN`), `192.168.43.1:8080 TOKEN`, `192.168.43.1 TOKEN`, or a link of the public page
 * (`...#h=192.168.43.1&p=8080&t=TOKEN`). Returns where to go; never throws.
 */
export function parseJoinInput(raw: string, fallback: { host?: string; port?: number } = {}): JoinParse {
  const text = (raw ?? '').trim(); if (!text) return { ok: false, reason: 'empty' };
  let host = fallback.host ?? '', port = fallback.port ?? DEFAULT_HTTP_PORT, secure = false, token = '';
  const url = /^(https?):\/\/([^/?#\s]+)([^#\s]*)#(\S*)$/i.exec(text) ?? /^(https?):\/\/([^/?#\s]+)([^#\s]*)()$/i.exec(text);
  if (url) {
    secure = url[1].toLowerCase() === 'https';
    const hp = /^(?:\[[^\]]+\]|([^:]+))(?::(\d+))?$/.exec(url[2]); if (!hp || !hp[1]) return { ok: false, reason: 'bad-host' };
    host = hp[1]; port = hp[2] ? Number(hp[2]) : secure ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT;
    const q = new URLSearchParams(url[4] ?? ''); token = q.get('t') ?? '';
    // link of the public join page: the target is inside the fragment
    if (q.get('h')) { host = q.get('h')!; port = q.get('p') ? Number(q.get('p')) : DEFAULT_HTTP_PORT; secure = q.get('s') === '1'; }
  } else {
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    if (parts.length === 1) token = parts[0];
    else { const hp = /^([^:]+)(?::(\d+))?$/.exec(parts[0]); if (!hp) return { ok: false, reason: 'bad-host' }; host = hp[1]; if (hp[2]) port = Number(hp[2]); token = parts[1]; }
    if (parts.length === 1 && (/[.:]/.test(parts[0]) && !TOKEN.test(parts[0]))) return { ok: false, reason: 'no-token' };
  }
  if (!TOKEN.test(token)) return { ok: false, reason: 'no-token' };
  if (!host || !HOST.test(host)) return { ok: false, reason: 'bad-host' };
  if (!validPort(port)) return { ok: false, reason: 'bad-port' };
  if (!isPrivateHost(host)) return { ok: false, reason: 'not-private' };
  return { ok: true, target: { host, port, secure, token } };
}
/** Where the public join page sends the browser. The token travels in the fragment only (never in an HTTP request line or a server log). */
export const targetUrl = (t: JoinTarget) => `${t.secure ? 'https' : 'http'}://${t.host}:${t.port}/#t=${t.token}`;
export const JOIN_ERRORS: Record<Exclude<JoinParse, { ok: true }>['reason'], string> = {
  empty: 'Paste the pairing link shown on the host phone, or scan its QR code.',
  'no-token': 'That does not contain a pairing code. Use the full link from the host, or “address code”.',
  'bad-host': 'The address is not valid. It should look like 192.168.43.1:8080.',
  'bad-port': 'The port is not valid.',
  'not-private': 'For safety this page only opens devices on your local network (192.168.x.x, 10.x.x.x, 172.16–31.x.x).',
};

/** QR/share link that opens the public join website, which then jumps to the host. `site` like `syncwave-liart.vercel.app`; returns the plain link unchanged if it cannot be built. */
export function publicJoinLink(site: string, plainLink: string): string {
  const s = (site ?? '').trim().replace(/\/+$/, ''); if (!s) return plainLink;
  const base = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  const p = parseJoinInput(plainLink); if (!p.ok) return plainLink;
  const t = p.target; return `${base}/#h=${t.host}&p=${t.port}&t=${t.token}${t.secure ? '&s=1' : ''}`;
}

/** The ONE permanent link: just the site. It never carries a session token; the page finds the host on the same network by itself (presence), so the QR / link never changes. */
export function universalLink(site: string): string { const s = (site ?? '').trim().replace(/\/+$/, ''); return !s ? '' : /^https?:\/\//i.test(s) ? s + '/' : `https://${s}/`; }
