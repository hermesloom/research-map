import type { RunDoc } from "@/lib/types";

export const FRESH_KEY = "rm_fresh";

/** Calls the daily cron by hand with the secret as bearer and turns the outcome into one alert-sized line. */
export async function runIngest(secret: string, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  let res: Response;
  try { res = await fetchFn("/api/cron/ingest", { headers: { authorization: `Bearer ${secret}` } }); } catch (e) { return { ok: false, message: `Ingest request failed: ${String(e)}` }; }
  if (res.status === 401) return { ok: false, message: "Wrong key." };
  const run = (await res.json().catch(() => null)) as Pick<RunDoc, "ok" | "counts" | "errors" | "notes"> | null;
  if (!run) return { ok: false, message: `Ingest failed: HTTP ${res.status}` };
  const counts = Object.entries(run.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing changed";
  const tail = [...(run.errors ?? []).map((e) => `error: ${String(e).slice(0, 120)}`), ...(run.notes ?? [])].join("\n");
  return { ok: !!run.ok, message: `${run.ok ? "Ingest done" : "Ingest finished with errors"}: ${counts}${tail ? "\n" + tail : ""}` };
}

/** Manifest URL for the next load: once after a manual ingest it carries a cache-buster so the CDN's 5-minute copy is skipped. */
export function manifestUrl(base: string, storage: Pick<Storage, "getItem" | "removeItem"> | null, now: () => number = Date.now): string {
  try { if (storage?.getItem(FRESH_KEY)) { storage.removeItem(FRESH_KEY); return `${base}${base.includes("?") ? "&" : "?"}t=${now()}`; } } catch { /* storage unavailable */ }
  return base;
}
