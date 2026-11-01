import type { Db } from "mongodb";
import { collections } from "../db";
import { fetchNewPosts } from "../x/client";

/** Pure diff: which recent local items vanished from X (tombstone) and which tombstoned ones reappeared (revive). */
export function diffDeletions(local: { xId: string; createdAt: Date; deletedAt?: Date }[], remoteIds: string[], now: Date, days = 14) {
  const cutoff = new Date(now.getTime() - days * 86400_000); const remote = new Set(remoteIds);
  const window = local.filter((i) => i.createdAt > cutoff);
  return { toDelete: window.filter((i) => !i.deletedAt && !remote.has(i.xId)).map((i) => i.xId), toRevive: window.filter((i) => i.deletedAt && remote.has(i.xId)).map((i) => i.xId) };
}

/** Safety around diffDeletions: never tombstone when the remote window was truncated, nor more than 10% of the window at once. */
export function planReconcile(local: { xId: string; createdAt: Date; deletedAt?: Date }[], remoteIds: string[], now: Date, remote: { truncated: boolean }, days = 14) {
  const d = diffDeletions(local, remoteIds, now, days); const windowSize = local.filter((i) => i.createdAt > new Date(now.getTime() - days * 86400_000)).length;
  if (remote.truncated) return { toDelete: [], toRevive: d.toRevive, aborted: "remote window truncated; not tombstoning" as string | null };
  if (d.toDelete.length > Math.max(1, Math.floor(windowSize * 0.1))) return { toDelete: [], toRevive: d.toRevive, aborted: `would tombstone ${d.toDelete.length} of ${windowSize} (>10%); refusing` as string | null };
  return { ...d, aborted: null as string | null };
}

/** Weekly: one owned-read timeline call over the last 14 days to honour X's deletion-sync policy. Cost scales with posts in the window. */
export async function reconcileDeletions(db: Db, deps: { fetchNewPosts?: typeof fetchNewPosts; now?: () => Date }) {
  const c = collections(db); const now = (deps.now ?? (() => new Date()))(); const startTime = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const { payload, requests, truncated } = await (deps.fetchNewPosts ?? fetchNewPosts)({ startTime, maxPages: 10 });
  const local = await c.items.find({ createdAt: { $gt: new Date(startTime) }, kind: { $ne: "retweet" } }, { projection: { xId: 1, createdAt: 1, deletedAt: 1 } }).toArray();
  const r = planReconcile(local, (payload.data ?? []).map((t) => t.id), now, { truncated });
  if (r.toDelete.length) await c.items.updateMany({ xId: { $in: r.toDelete } }, { $set: { deletedAt: now } });
  if (r.toRevive.length) await c.items.updateMany({ xId: { $in: r.toRevive } }, { $unset: { deletedAt: "" } });
  await c.runs.insertOne({ startedAt: now, finishedAt: new Date(), kind: "reconcile", counts: { requests, deleted: r.toDelete.length, revived: r.toRevive.length }, errors: [], notes: r.aborted ? [r.aborted] : [], ok: true });
  return r;
}
