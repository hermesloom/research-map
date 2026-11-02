"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "./useSnapshot";
import { lensXY, lensLabels, lensAnchors, primarySeed } from "./lenses";
import { rgbaForRows, catRGBFor, visibleMask } from "./colors";
import { parseUrlState, serializeUrlState, type UrlState } from "./urlState";
import type { Camera } from "./render/camera";
import type { EngineData } from "./gl/engine";
import { terrainKey } from "./gl/terrainService";
import MapView, { type MapHandle } from "./MapView";
import TopBar from "./TopBar";
import Inspector from "./Inspector";
import Filters, { type FilterState } from "./Filters";
import { recentHighlights, type Highlight } from "./recent";

const CENTER_ID = process.env.NEXT_PUBLIC_RESEARCH_QUESTION_POST_ID ?? "2115703316281778260";

export default function Canvas() {
  const { snap, error, loadMeta } = useSnapshot();
  const [url, setUrl] = useState<UrlState>(() => parseUrlState(typeof location === "undefined" ? "" : location.search));
  const urlRef = useRef(url); urlRef.current = url;
  const [filters, setFilters] = useState<FilterState>({});
  const map = useRef<MapHandle>(null);
  const initialCamera = useMemo<Camera | null>(() => (url.v ? { x: url.v[0], y: url.v[1], scale: url.v[2] } : null), []);   // eslint-disable-line react-hooks/exhaustive-deps

  // URL sync for the camera, throttled; never a React render per pan frame.
  const camRef = useRef<Camera | null>(initialCamera); const syncTimer = useRef<number | null>(null);
  const onCamera = useCallback((c: Camera) => {
    camRef.current = c; if (syncTimer.current !== null) return;
    syncTimer.current = window.setTimeout(() => { syncTimer.current = null; const cur = camRef.current; if (!cur) return; history.replaceState(null, "", location.pathname + serializeUrlState({ ...urlRef.current, v: [+cur.x.toFixed(3), +cur.y.toFixed(3), +cur.scale.toFixed(2)] })); }, 250);
  }, []);
  useEffect(() => { const cur = camRef.current; history.replaceState(null, "", location.pathname + serializeUrlState({ ...url, v: cur ? [+cur.x.toFixed(3), +cur.y.toFixed(3), +cur.scale.toFixed(2)] : undefined })); }, [url]);
  useEffect(() => { if (url.lens === "time" && snap && !snap.meta) void loadMeta(); }, [url.lens, snap, loadMeta]);

  const ctx = useMemo(() => snap ? {
    centerId: CENTER_ID,
    primarySub: snap.points.ids.map((_, i) => primarySeed(snap.meta?.subQuestions[i]?.[0] ?? null, snap.labels.questions)),
    subOrder: snap.labels.questions.filter((q) => q.parentId === "core").map((q) => q.id),
  } : null, [snap]);
  const mask = useMemo(() => snap ? visibleMask(snap.points, url.minGrade, url.showAll, filters, snap.meta) : null, [snap, url.minGrade, url.showAll, filters]);
  const lensPos = useMemo(() => snap && ctx ? lensXY(url.lens, snap.points, ctx) : null, [snap, ctx, url.lens]);
  const idx = useMemo(() => { if (!snap || !mask) return null; const out: number[] = []; for (let i = 0; i < snap.points.count; i++) if (mask[i]) out.push(i); return out; }, [snap, mask]);

  // Engine data: visible rows only. Positions come from the lens; the engine animates between successive targets.
  const target = useMemo(() => { if (!lensPos || !idx) return null; const x = new Float32Array(idx.length), y = new Float32Array(idx.length); idx.forEach((i, r) => { x[r] = lensPos.x[i]; y[r] = lensPos.y[i]; }); return { x, y }; }, [lensPos, idx]);
  const data = useMemo<EngineData | null>(() => {
    if (!snap || !idx || !target) return null;
    const cat = Uint16Array.from(idx, (i) => (snap.points.leaf[i] < 0 ? 0 : snap.points.leaf[i] + 1));
    return { x: target.x, y: target.y, rgba: rgbaForRows(snap.points, idx), cat, catRGB: catRGBFor(snap.points) };
  }, [snap, idx, target]);
  // Terrain is keyed by lens + visible rows + positions; the engine builds it off the main thread and caches it. The time strata lens shows no terrain (owner's choice: rows and months carry the structure there).
  const terrain = useMemo(() => (data && idx && url.lens !== "time" ? { key: terrainKey(url.lens, idx, data.x, data.y), input: { x: data.x, y: data.y, cat: data.cat, catRGB: data.catRGB } } : null), [data, idx, url.lens]);
  const labels = useMemo(() => (snap && lensPos && ctx && idx ? lensLabels(url.lens, snap.points, lensPos, { questions: snap.labels.questions, subOrder: ctx.subOrder, terrainLabels: snap.labels.labels }, idx) : []), [snap, lensPos, url.lens, ctx, idx]);
  const fitAnchors = useMemo(() => lensAnchors(labels), [labels]);
  const rowsKey = useMemo(() => (idx ? terrainKey("rows", idx, new Float32Array(0), new Float32Array(0)) : ""), [idx]);
  const selectedRow = useMemo(() => (snap && idx && url.sel ? idx.indexOf(snap.points.ids.indexOf(url.sel)) : -1), [snap, idx, url.sel]);
  const highlights = useMemo<Highlight[]>(() => (snap && idx && url.recent ? recentHighlights(snap.points, idx) : []), [snap, idx, url.recent]);

  const select = useCallback((xId: string) => { setUrl((u) => ({ ...u, sel: xId })); void loadMeta(); }, [loadMeta]);
  const onPick = useCallback((row: number) => { if (idx && snap) select(snap.points.ids[idx[row]]); }, [idx, snap, select]);
  const flyTo = useCallback((i: number) => { if (!idx || !target) return; const r = idx.indexOf(i); if (r >= 0) map.current?.flyTo(target.x[r], target.y[r]); }, [idx, target]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {error && <div style={{ padding: 24 }}>Could not load the map: {error}</div>}
      {!error && !snap && <div style={{ padding: 24 }}>Loading map…</div>}
      {snap && <MapView ref={map} data={data} rowsKey={rowsKey} target={target} lens={url.lens} labels={labels} fitAnchors={fitAnchors} terrain={terrain} selectedRow={selectedRow} highlights={highlights} initialCamera={initialCamera} onCamera={onCamera} onPick={onPick} />}
      {snap && <TopBar url={url} setUrl={setUrl} snap={snap} onFlyTo={flyTo} />}
      {snap && <Filters snap={snap} filters={filters} setFilters={setFilters} url={url} setUrl={setUrl} loadMeta={loadMeta} />}
      {snap && url.sel && <Inspector snap={snap} xId={url.sel} onClose={() => setUrl((u) => ({ ...u, sel: undefined }))} loadMeta={loadMeta} />}
    </div>
  );
}
