/**
 * Public join page (V17). Deliberately tiny: no framework, no audio engine, no calibration model, no host controls.
 * The session itself is hosted by the SyncWave Android app on the local network; this page only turns a pairing link / address + code (or a scanned QR)
 * into a top-level navigation to the receiver page served BY THE APK. A public https page cannot open ws:// connections to a phone on the LAN (mixed
 * content), and the receiver needs the host's own origin for WebRTC timing, so the hand-off is a plain navigation, never a proxy.
 * Only private-network targets are accepted (see shared/joinLink.ts) and the pairing code stays in the URL fragment.
 * Automatic discovery (V20.3): the page tells this site's /api/presence function "a device is here" (random id, device name; the site sees the network's public
 * address) and gets back the hosts that announced themselves from the same public address. One host => straight there, no tap, no permission prompt;
 * the jump is a navigation to the host's private address, so only a device that can really reach that LAN gets in. Without the function the page works as before.
 * V20.4.1: the page no longer jumps to a host on its own. A private address that the receiver cannot reach makes the browser hang until
 * ERR_CONNECTION_TIMED_OUT, and the public address is shared by unrelated devices on mobile data, so the person taps the host that was found (only hosts
 * seen in the last 15 s are offered), gets a mobile-data warning, and a hint if the host does not open.
 */
import './join.css';
import { parseJoinInput, targetUrl, JOIN_ERRORS } from '../shared/joinLink';
import { pickHost, hostUrl, DEVICE_POLL_MS, type PresenceOut, type PublicHost } from '../shared/rendezvous';

const LAST = 'syncwave.join.lastHost';
const app = document.getElementById('app')!;
const lastHost = (() => { try { return localStorage.getItem(LAST) ?? ''; } catch { return ''; } })();

function go(raw: string, showError: (m: string) => void) {
  const r = parseJoinInput(raw, lastHost ? { host: lastHost.split(':')[0], port: Number(lastHost.split(':')[1]) || undefined } : {});
  if (!r.ok) return showError(JOIN_ERRORS[r.reason]);
  try { localStorage.setItem(LAST, `${r.target.host}:${r.target.port}`); } catch { /* optional convenience only */ }
  location.replace(targetUrl(r.target));      // replace, not assign: no extra history entry / page to go back through
}

const deviceId = (() => { try { let v = sessionStorage.getItem('syncwave.join.id'); if (!v) { v = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''); sessionStorage.setItem('syncwave.join.id', v); } return v; } catch { return 'tmp' + Math.random().toString(36).slice(2, 16); } })();
const deviceName = (() => { const u = navigator.userAgent, os = /Android/i.test(u) ? 'Android' : /iPhone|iPad/i.test(u) ? 'iPhone' : /Mac/i.test(u) ? 'Mac' : /Windows/i.test(u) ? 'Windows' : 'Device', br = /Edg\//.test(u) ? 'Edge' : /Firefox/i.test(u) ? 'Firefox' : /Chrome|CriOS/i.test(u) ? 'Chrome' : /Safari/i.test(u) ? 'Safari' : 'browser'; return `${os} ${br}`; })();
const lastTarget = () => { const [h, p] = lastHost.split(':'); return h ? { host: h, port: Number(p) || 8080 } : undefined; };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag); const { class: cls, ...rest } = props as Record<string, unknown>; if (cls) e.className = String(cls); Object.assign(e, rest);
  for (const k of kids) e.append(k); return e;
}

function render() {
  const input = el('input', { type: 'text', placeholder: 'http://192.168.43.1:8080/#t=…', autocapitalize: 'off', spellcheck: false, autocomplete: 'off', ariaLabel: 'Pairing link' } as Partial<HTMLInputElement>);
  const err = el('p', { class: 'err small', role: 'alert' }); const showError = (m: string) => { err.textContent = m; };
  const join = el('button', { type: 'button' }, 'Join session');
  join.onclick = () => go(input.value, showError); input.onkeydown = (e) => { if (e.key === 'Enter') join.click(); };
  const found = el('div', { class: 'found' });
  const card = el('section', { class: 'card' },
    el('h2', {}, 'Join a SyncWave session'),
    found,
    el('p', {}, 'No luck finding it automatically? Scan the QR code on the host phone, or paste its pairing link below. This device must be on the same Wi‑Fi (or the host’s hotspot).'),
    el('label', {}, 'Pairing link, or “address code”', input), join, err);
  if ('BarcodeDetector' in window && 'mediaDevices' in navigator) {
    const scan = el('button', { type: 'button', class: 'ghost' }, 'Scan QR code'); scan.onclick = () => void startScan(card, scan, showError, (t) => go(t, showError)); card.append(scan);
  }
  card.append(el('p', { class: 'small' }, 'The audio plays on this device once you are connected and never passes through this website. To find hosts nearby, this site sees your network’s public address, a random id and your device name for a few seconds; nothing else is sent or stored.'));
  app.replaceChildren(el('div', { class: 'brand' }, el('div', { class: 'logo' }, 'S'), el('h1', {}, 'SyncWave')), card);
  return { input, showError, found };
}

async function startScan(card: HTMLElement, btn: HTMLButtonElement, showError: (m: string) => void, done: (text: string) => void) {
  btn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const video = el('video', { playsInline: true, muted: true, autoplay: true }); video.srcObject = stream; card.append(video); await video.play();
    const det = new (window as unknown as { BarcodeDetector: new (o: object) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ['qr_code'] });
    const stop = () => { stream.getTracks().forEach((t) => t.stop()); video.remove(); btn.disabled = false; };
    const tick = async () => {
      if (!video.isConnected) return;
      try { const c = await det.detect(video); if (c[0]?.rawValue) { stop(); done(c[0].rawValue); return; } } catch { /* keep scanning */ }
      setTimeout(tick, 250);
    };
    void tick();
  } catch { btn.disabled = false; showError('Camera not available. Paste the pairing link instead.'); }
}

const ui = render();

/** Automatic discovery loop. Silent on any failure: the manual link / QR flow underneath always works. */
let leaving = false, navigated = false, announced = false, autoStarted = false, cancelled = false;
let cdTimer: ReturnType<typeof setInterval> | undefined;
const FRESH_S = 15, HINT_AFTER_MS = 30_000, startedAt = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;
const next = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => void discover(), ms); };
/** Chrome on Android exposes the connection type; elsewhere this is simply false. */
const onMobileData = () => (navigator as unknown as { connection?: { type?: string } }).connection?.type === 'cellular';
function showFound(hosts: PublicHost[] | null, searching: boolean) {
  const box = ui.found; box.replaceChildren();
  if (onMobileData()) box.append(el('p', { class: 'err small', role: 'alert' }, 'This device seems to be on mobile data. Connect it to the host’s Wi‑Fi or hotspot first, otherwise the host cannot be reached.'));
  if (hosts && hosts.length) {
    box.append(el('p', {}, hosts.length > 1 ? 'Several hosts are on this network. Tap yours:' : 'Host found. Tap to connect:'));
    for (const h of hosts) { const b = el('button', { type: 'button' }, `${h.name} (${h.host})`); b.onclick = () => openHost(h); box.append(b); }
    box.append(el('p', { class: 'small' }, 'If the next page says “can’t be reached”, this device is not on the same Wi‑Fi as the host. Switch networks and tap again.'));
  } else if (searching) {
    box.append(el('p', { class: 'small', role: 'status' }, 'Looking for a host on this network…'));
    if (Date.now() - startedAt > HINT_AFTER_MS) box.append(el('p', { class: 'small' }, 'Still nothing. Make sure the host has started a session and this device is on the same Wi‑Fi (or the host’s hotspot), or use the QR code / pairing link below.'));
  }
}
/** Runs from a tap. A new tab keeps this page alive, so the hint stays visible if the host address does not answer; if the browser blocks the tab, fall back to navigating. */
function openHost(h: PublicHost) {
  try { localStorage.setItem(LAST, `${h.host}:${h.port}`); } catch { /* optional */ }
  const url = hostUrl(h);
  const w = window.open(url, '_blank', 'noopener');
  if (w) { ui.found.replaceChildren(el('p', { role: 'status' }, `Opening ${h.name}… If that tab shows “can’t be reached”, this device is not on the host’s network.`)); return; }
  navigated = true; leaveNow(); location.assign(url);
}
function leaveNow() { leaving = true; if (!announced) return; try { navigator.sendBeacon?.('/api/presence', new Blob([JSON.stringify({ role: 'device', id: deviceId, name: deviceName, leave: true })], { type: 'application/json' })); } catch { /* the entry expires by itself */ } }
/** One host found (and not on mobile data): connect by itself after a short, cancellable countdown, with a single replace-navigation (no extra pages). */
function autoGo(h: PublicHost) {
  autoStarted = true; let n = 2;
  const msg = el('p', { role: 'status' }); const cancel = el('button', { type: 'button', class: 'ghost' }, 'Cancel');
  cancel.onclick = () => { cancelled = true; autoStarted = false; clearInterval(cdTimer); showFound([h], false); next(DEVICE_POLL_MS); };
  const tick = () => { msg.textContent = n > 0 ? `Connecting to ${h.name} in ${n}…` : `Connecting to ${h.name}…`; if (n-- <= 0) { clearInterval(cdTimer); navigated = true; leaveNow(); try { localStorage.setItem(LAST, `${h.host}:${h.port}`); } catch { /* optional */ } location.replace(hostUrl(h)); } };
  ui.found.replaceChildren(msg, cancel); tick(); cdTimer = setInterval(tick, 1000);
}
async function discover() {
  if (leaving || navigated || autoStarted || document.hidden) return;
  let out: PresenceOut | null = null; announced = true;
  try { const ac = new AbortController(), t = setTimeout(() => ac.abort(), 4000); const r = await fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'device', id: deviceId, name: deviceName }), signal: ac.signal, cache: 'no-store' }); clearTimeout(t); if (r.ok) out = (await r.json()) as PresenceOut; } catch { /* no function here, or offline */ }
  if (!out || !out.ok) { showFound(null, false); return next(DEVICE_POLL_MS * 3); }
  const pick = pickHost(out.hosts.filter((h) => h.ageS <= FRESH_S), lastTarget());
  if (pick.action === 'go' && !cancelled && !onMobileData() && !document.hidden) { autoGo(pick.host); return; }
  showFound(pick.action === 'go' ? [pick.host] : pick.action === 'choose' ? pick.hosts : null, pick.action === 'wait');
  next(DEVICE_POLL_MS);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !navigated && !autoStarted) next(0); });
addEventListener('online', () => { if (!navigated && !autoStarted) next(0); });      // auto reconnect: network came back -> look again at once
addEventListener('pagehide', () => { if (!navigated) leaveNow(); });
// A link that already carries the code (…/#t=…, or #h=<address>&p=<port>&t=…) joins straight away; the fragment is removed from the address bar first.
if (location.hash.length > 1) {
  const raw = location.href; try { history.replaceState(null, '', location.pathname + location.search); } catch { /* */ }
  ui.input.value = raw; go(raw, ui.showError);
}
else void discover();
