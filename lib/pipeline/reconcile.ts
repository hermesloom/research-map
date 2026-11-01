import type { Db } from "mongodb";
import { collections } from "../db";
import { fetchNewPosts } from "../x/client";

/** Pure diff: which recent local items vanished from X (tombstone) and which tombstoned ones reappeared (revive). */
export function diffDeletions(local: { xId: string; createdAt: Date; deletedAt?: Date }[], remoteIds: string[], now: Date, days = 14) {
  const cutoff = new Date(now.getTime() - days * 86400_000); const remote = new Set(remoteIds);
  const window = local.filter((i) => i.createdAt > cutoff);
  return { toDelete: window.filter((i) => !i.deletedAt && !remote.has(i.xId)).map((i) => i.xId), toRevive: window.filter((i) => i.deletedAt && remote.has(i.xId)).map((i) => i.xId) };
}

/** Weekly: one owned-read timeline call over the last 14 days (≈ $0.05) to honour X's deletion-sync policy. */
export async function reconcileDeletions(db: Db, deps: { fetchNewPosts?: typeof fetchNewPosts; now?: () => Date }) {
  const c = collections(db); const now = (deps.now ?? (() => new Date()))(); const startTime = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const { payload, requests } = await (deps.fetchNewPosts ?? fetchNewPosts)({ startTime });
  const local = await c.items.find({ createdAt: { $gt: new Date(startTime) } }, { projection: { xId: 1, createdAt: 1, deletedAt: 1 } }).toArray();
  const r = diffDeletions(local, (payload.data ?? []).map((t) => t.id), now);
  if (r.toDelete.length) await c.items.updateMany({ xId: { $in: r.toDelete } }, { $set: { deletedAt: now } });
  if (r.toRevive.length) await c.items.updateMany({ xId: { $in: r.toRevive } }, { $unset: { deletedAt: "" } });
  await c.runs.insertOne({ startedAt: now, finishedAt: new Date(), kind: "reconcile", counts: { requests, deleted: r.toDelete.length, revived: r.toRevive.length }, errors: [], notes: [], ok: true });
  return r;
}
