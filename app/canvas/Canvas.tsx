"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "./useSnapshot";
import { lensXY, lensLabels, primarySeed } from "./lenses";
import { categoryColors, categoryIndex, visibleMask } from "./colors";
import { parseUrlState, serializeUrlState, type UrlState } from "./urlState";
import { newestRows } from "./overlayLogic";
import type { OverlayStore } from "./CardOverlay";
import type { Camera } from "./render/camera";
import type { EngineData } from "./render/engine";
import Canvas2D, { type Canvas2DHandle } from "./Canvas2D";
import TopBar from "./TopBar";
import Inspector from "./Inspector";
import Filters, { type FilterState } from "./Filters";

const COLORS = categoryColors();
import { LEAF_PALETTE } from "./colors";
const CAT_COLORS = ["#bdbdbd", ...LEAF_PALETTE];   // index 0 = unclustered grey; leaf i → palette[i % n] at index i+1 (built per snapshot below)
const CENTER_ID = process.env.NEXT_PUBLIC_RESEARCH_QUESTION_POST_ID ?? "2115703316281778260";

export default function Canvas() {
  const { snap, error, loadMeta } = useSnapshot();
  const [url, setUrl] = useState<UrlState>(() => parseUrlState(typeof location === "undefined" ? "" : location.search));
  const urlRef = useRef(url); urlRef.current = url;
  const [filters, setFilters] = useState<FilterState>({});
  const map = useRef<Canvas2DHandle>(null);
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
    const color = idx.map((i) => COLORS[categoryIndex(snap.points.leaf[i], snap.points.grade[i])]);
    const nLeaves = Math.max(0, ...snap.points.leaves.map((l) => l.id)) + 1;
    const cat = Uint16Array.from(idx, (i) => (snap.points.leaf[i] < 0 ? 0 : snap.points.leaf[i] + 1));
    const catColor = [CAT_COLORS[0], ...Array.from({ length: nLeaves }, (_, l) => LEAF_PALETTE[l % LEAF_PALETTE.length])];
    const provisional = Uint8Array.from(idx, (i) => snap.points.provisional[i]); const newest = newestRows(snap.points, idx, 20);
    return { x: target.x, y: target.y, color, cat, catColor, provisional, newest };
  }, [snap, idx, target]);
  const labels = useMemo(() => (snap && lensPos && ctx ? lensLabels(url.lens, snap.points, lensPos, { questions: snap.labels.questions, subOrder: ctx.subOrder, terrainLabels: snap.labels.labels }) : []), [snap, lensPos, url.lens, ctx]);
  const selectedRow = useMemo(() => (snap && idx && url.sel ? idx.indexOf(snap.points.ids.indexOf(url.sel)) : -1), [snap, idx, url.sel]);

  const select = useCallback((xId: string) => { setUrl((u) => ({ ...u, sel: xId })); void loadMeta(); }, [loadMeta]);
  const store = useRef<OverlayStore>({ snap: null, idx: [], xy: null, loadMeta, onPick: () => {}, version: 0 });
  store.current.snap = snap; store.current.idx = idx ?? []; store.current.xy = target; store.current.selected = url.sel; store.current.loadMeta = loadMeta;
  store.current.onPick = (row) => { if (idx && snap) select(snap.points.ids[idx[row]]); };
  store.current.version = (idx?.length ?? 0) + (snap?.meta ? 1_000_000 : 0) + (url.lens === "terrain" ? 0 : url.lens === "question" ? 10_000_000 : 20_000_000);
  const onPick = useCallback((row: number) => { if (idx && snap) select(snap.points.ids[idx[row]]); }, [idx, snap, select]);
  const flyTo = useCallback((i: number) => { if (!idx || !target) return; const r = idx.indexOf(i); if (r >= 0) map.current?.flyTo(target.x[r], target.y[r]); }, [idx, target]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {error && <div style={{ padding: 24 }}>Could not load the map: {error}</div>}
      {!error && !snap && <div style={{ padding: 24 }}>Loading map…</div>}
      {snap && <Canvas2D ref={map} data={data} target={target} labels={labels} selectedRow={selectedRow} initialCamera={initialCamera} store={store.current} onCamera={onCamera} onPick={onPick} />}
      {snap && <TopBar url={url} setUrl={setUrl} snap={snap} onFlyTo={flyTo} />}
      {snap && <Filters snap={snap} filters={filters} setFilters={setFilters} url={url} setUrl={setUrl} loadMeta={loadMeta} />}
      {snap && url.sel && <Inspector snap={snap} xId={url.sel} onClose={() => setUrl((u) => ({ ...u, sel: undefined }))} loadMeta={loadMeta} />}
    </div>
  );
}
