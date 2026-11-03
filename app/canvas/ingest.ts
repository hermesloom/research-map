import type { RunDoc } from "@/lib/types";

export const FRESH_KEY = "rm_fresh";
export const MANUAL_URL = "/api/cron/ingest/manual";

type RunStatus = Pick<RunDoc, "ok" | "counts" | "errors" | "notes"> & { startedAt: string; finishedAt?: string };
type Opts = { sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number; now?: () => number };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Starts the daily job by hand with the secret as bearer, then polls until it has finished and turns the outcome into one alert-sized line. The job runs server-side after the start response, so a dropped connection mid-run no longer loses the result. */
export async function runIngest(secret: string, fetchFn: typeof fetch = fetch, opts: Opts = {}): Promise<{ ok: boolean; message: string }> {
  const { sleep = wait, pollMs = 3000, timeoutMs = 15 * 60_000, now = Date.now } = opts; const headers = { authorization: `Bearer ${secret}` };
  let res: Response;
  try { res = await fetchFn(MANUAL_URL, { method: "POST", headers }); } catch (e) { return { ok: false, message: `Ingest request failed: ${String(e)}` }; }
  if (res.status === 401) return { ok: false, message: "Wrong key." };
  const start = (await res.json().catch(() => null)) as { startedAt?: string } | null;
  if (!res.ok || !start?.startedAt) return { ok: false, message: `Ingest failed: HTTP ${res.status}` };
  const t0 = now();
  while (now() - t0 < timeoutMs) {
    await sleep(pollMs);
    let poll: Response; try { poll = await fetchFn(`${MANUAL_URL}?since=${encodeURIComponent(start.startedAt)}`, { headers }); } catch { continue; }
    if (poll.status === 401) return { ok: false, message: "Wrong key." };
    const run = ((await poll.json().catch(() => null)) as { run?: RunStatus | null } | null)?.run;
    if (run?.finishedAt) return summarize(run);
  }
  return { ok: false, message: `Ingest still running after ${Math.round(timeoutMs / 60_000)} min; it finishes on its own — reload later.` };
}

function summarize(run: RunStatus): { ok: boolean; message: string } {
  const counts = Object.entries(run.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing changed";
  const tail = [...(run.errors ?? []).map((e) => `error: ${String(e).slice(0, 120)}`), ...(run.notes ?? [])].join("\n");
  return { ok: !!run.ok, message: `${run.ok ? "Ingest done" : "Ingest finished with errors"}: ${counts}${tail ? "\n" + tail : ""}` };
}

/** Manifest URL for the next load: once after a manual ingest it carries a cache-buster so the CDN's 5-minute copy is skipped. */
export function manifestUrl(base: string, storage: Pick<Storage, "getItem" | "removeItem"> | null, now: () => number = Date.now): string {
  try { if (storage?.getItem(FRESH_KEY)) { storage.removeItem(FRESH_KEY); return `${base}${base.includes("?") ? "&" : "?"}t=${now()}`; } } catch { /* storage unavailable */ }
  return base;
}
