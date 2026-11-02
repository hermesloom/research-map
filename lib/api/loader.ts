import fs from "node:fs/promises";
import path from "node:path";
import { buildCorpus, type Corpus } from "./corpus";
import type { LabelsFile, MetaFile, PointsFile } from "../snapshot";
import type { Manifest } from "../types";
import { CORE_QUESTION } from "../llm/grade";

export class NoSnapshotError extends Error { name = "NoSnapshotError"; }
export interface LoaderDeps { fetchManifest: () => Promise<Manifest | null>; fetchJson: (url: string) => Promise<unknown>; now: () => number; ttlMs: number; researchQuestionPostId: string }

/** Dev fixture: the canvas's `NEXT_PUBLIC_DEV_MANIFEST=/dev/manifest.json` makes the loader read `public/dev/*` from disk instead of Mongo + Blob. Reads are scoped to that one folder so the bundler traces nothing else. */
const DEV_DIR = path.join(process.cwd(), "public", "dev");
export const devManifestPath = () => process.env.NEXT_PUBLIC_DEV_MANIFEST ?? null;
async function readDev(url: string) { return JSON.parse(await fs.readFile(path.join(DEV_DIR, path.basename(url)), "utf8")); }
export function defaultDeps(): LoaderDeps {
  const dev = devManifestPath();
  return {
    fetchManifest: dev ? () => readDev(dev) : async () => { const { getDb, collections } = await import("../db"); return collections(await getDb()).manifest.findOne({ _id: "current" }); },
    fetchJson: async (url) => { if (dev && url.startsWith("/")) return readDev(url); const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(`snapshot file ${url}: HTTP ${r.status}`); return r.json(); },
    now: Date.now, ttlMs: 5 * 60_000, researchQuestionPostId: process.env.RESEARCH_QUESTION_POST_ID ?? "2115703316281778260",
  };
}

let cache: { corpus: Corpus; key: string; checkedAt: number; inflight: Promise<Corpus> | null } | null = null;
export function resetCorpusCache() { cache = null; }

/** One corpus per process, rebuilt only when the manifest's generatedAt changes; the manifest itself is re-read at most every ttlMs. */
export async function getCorpus(deps: Partial<LoaderDeps> = {}): Promise<Corpus> {
  const d = { ...defaultDeps(), ...deps }; const now = d.now();
  if (cache && now - cache.checkedAt < d.ttlMs) return cache.corpus;
  if (cache?.inflight) return cache.inflight;
  const load = (async () => {
    const m = await d.fetchManifest(); if (!m) throw new NoSnapshotError("no published snapshot");
    const key = `${m.layoutVersion}:${new Date(m.generatedAt).toISOString()}`;
    if (cache && cache.key === key) { cache.checkedAt = now; return cache.corpus; }
    const [points, meta, labels] = await Promise.all([d.fetchJson(m.pointsUrl), d.fetchJson(m.metaUrl), d.fetchJson(m.labelsUrl)]) as [PointsFile, MetaFile, LabelsFile];
    const corpus = buildCorpus({ points, meta, labels, manifest: m, coreQuestion: CORE_QUESTION, researchQuestionPostId: d.researchQuestionPostId });
    cache = { corpus, key, checkedAt: now, inflight: null }; return corpus;
  })();
  if (cache) cache.inflight = load; else cache = { corpus: null as unknown as Corpus, key: "", checkedAt: -Infinity, inflight: load };
  try { return await load; }
  catch (e) {
    if (cache && cache.key !== "") { console.error("snapshot refresh failed; serving the cached corpus", e); cache.checkedAt = now; cache.inflight = null; return cache.corpus; }   // a warm corpus beats an error page
    cache = null; throw e;
  } finally { if (cache) cache.inflight = null; }
}
