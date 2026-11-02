"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointsFile, MetaFile, LabelsFile } from "@/lib/snapshot";
import type { Manifest } from "@/lib/types";
import { manifestUrl } from "./ingest";
export interface Snapshot { points: PointsFile; labels: LabelsFile; meta: MetaFile | null; manifest: Manifest; }
/** Manifest → points + labels eagerly; meta (titles, gists, urls) lazily on first need. */
export function useSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null); const [error, setError] = useState<string | null>(null); const metaP = useRef<Promise<MetaFile> | null>(null);
  useEffect(() => { (async () => { try {
    const manifest: Manifest = await (await fetch(manifestUrl(process.env.NEXT_PUBLIC_DEV_MANIFEST ?? "/api/manifest", typeof sessionStorage === "undefined" ? null : sessionStorage))).json();
    if ((manifest as unknown as { error?: string }).error) throw new Error((manifest as unknown as { error: string }).error);
    const [points, labels] = await Promise.all([fetch(manifest.pointsUrl).then((r) => r.json()), fetch(manifest.labelsUrl).then((r) => r.json())]);
    setSnap({ points, labels, meta: null, manifest });
  } catch (e) { setError(String(e)); } })(); }, []);
  const metaUrl = snap?.manifest.metaUrl;
  const loadMeta = useCallback(() => {
    if (!metaUrl) return Promise.reject(new Error("no snapshot"));
    if (!metaP.current) metaP.current = fetch(metaUrl).then((r) => r.json()).then((m: MetaFile) => { setSnap((s) => (s ? { ...s, meta: m } : s)); return m; });
    return metaP.current;
  }, [metaUrl]);
  return { snap, error, loadMeta };
}
