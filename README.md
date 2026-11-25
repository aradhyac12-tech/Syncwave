# SyncWave web (connection only)
Deploy this folder as its own Vercel project (Root Directory empty / this folder, Framework Vite or Other).
- `index.html` + `src/` : the join page. No audio, no receiver, no hosting of the app.
- `api/presence.ts` : same-network discovery.
Setup: Vercel -> Storage -> add Upstash Redis (sets KV_REST_API_URL / KV_REST_API_TOKEN). Optional env PRESENCE_SALT = random text. Redeploy.
Then in the SyncWave host app type this site's address (e.g. your-project.vercel.app) once.

## 0.20.4 (join page hang fix)
- The page no longer navigates to a host by itself. An unreachable private address (receiver on another network, mobile data, router client isolation) made the browser hang until ERR_CONNECTION_TIMED_OUT. Now the person taps the host that was found; it opens in a new tab so this page can still show a hint.
- Only hosts seen in the last 15 s are offered (a stopped host stays in the store ~25 s).
- Warning when the browser reports a cellular connection; hint after 30 s of searching; polling pauses while the tab is hidden.
- `api/_lib.ts`: Redis REST call has a 2.5 s timeout, so a slow store answers 503 quickly instead of holding the request open.

## 0.20.9 (universal link, no flashing, auto connect)
- ONE permanent link/QR: the site address itself (https://syncwave-liart.vercel.app/). No token in it; the page finds the host on the same network by itself and, if exactly one host is found (and the device is not on mobile data), connects after a 2 s cancellable countdown using a single replace-navigation.
- No more 2-3 flashing pages: critical dark background inlined in index.html (CSP hash in vercel.json / _headers), index.html is never cached (hashed assets are immutable), unknown paths rewrite to the page instead of a white 404, asset base is `/`, navigation uses location.replace.
- Auto reconnect: page re-checks immediately when the network comes back or the tab returns; receiver (host app client) now retries forever with a 5 s cap and retries at once on online/visible.
- Redeploy this folder on Vercel (the CSP hash changed with index.html).

## 0.20.22 (logo theme)
- Join page recolored to the SyncWave logo palette (charcoal / amber / cream); favicon and touch icon added.
- The inline <style> in index.html changed, so its CSP hash was recomputed in vercel.json and public/_headers. Redeploy so both are updated together.
- NOT VERIFIED: not deployed or viewed on a phone.
