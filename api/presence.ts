/** POST /api/presence: "I am here" for hosts and devices on the same network. See shared/rendezvous.ts. Presence only: no audio, no accounts, nothing persisted beyond ~30 s. */
import { handle, memoryStore, upstashStore, type Req, type Store } from './_lib.js';

let store: Store | undefined;
export default async function handler(req: Req, res: { status(n: number): unknown; setHeader(k: string, v: string): void; send(b: string): void; end(): void }) {
  store ??= upstashStore(process.env) ?? memoryStore();
  const out = await handle(req, store, process.env.PRESENCE_SALT ?? '');
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.status(out.status); if (out.body) res.send(out.body); else res.end();
}
