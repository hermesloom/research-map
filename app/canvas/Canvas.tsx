"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmbeddingView, type ViewportState } from "embedding-atlas/react";
import { useSnapshot } from "./useSnapshot";
import { lensXY, lensLabels, primarySeed, tween } from "./lenses";
import { categoryColors, categoryIndex, visibleMask } from "./colors";
import { parseUrlState, serializeUrlState, type UrlState } from "./urlState";
import { probeWebGPU } from "./webgpu";
import { CardOverlay, type OverlayStore } from "./CardOverlay";
import CanvasFallback from "./CanvasFallback";
import TopBar from "./TopBar";
import Inspector from "./Inspector";
import Filters, { type FilterState } from "./Filters";

const COLORS = categoryColors();
const CENTER_ID = process.env.NEXT_PUBLIC_RESEARCH_QUESTION_POST_ID ?? "2115703316281778260";
const DENSITY_BELOW_SCALE = 1.5;

export default function Canvas() {
  const { snap, error, loadMeta } = useSnapshot();
  const [url, setUrl] = useState<UrlState>(() => parseUrlState(typeof location === "undefined" ? "" : location.search));
  // The viewport is uncontrolled while the user pans: `flyViewport` is only set for fly-to / initial restore; live values live in a ref.
  const [flyViewport, setFlyViewport] = useState<ViewportState | null>(url.v ? { x: url.v[0], y: url.v[1], scale: url.v[2] } : null);
  const viewportRef = useRef<ViewportState | null>(flyViewport);
  const [densityMode, setDensityMode] = useState<boolean>(!url.v || url.v[2] < DENSITY_BELOW_SCALE);
  const [filters, setFilters] = useState<FilterState>({});
  const [size, setSize] = useState(() => ({ w: typeof window === "undefined" ? 800 : window.innerWidth, h: typeof window === "undefined" ? 600 : window.innerHeight }));
  const host = useRef<HTMLDivElement>(null);
  const [gpu, setGpu] = useState<boolean | null>(null);
  useEffect(() => { probeWebGPU().then(setGpu); }, []);
  useEffect(() => { if (url.lens === "time" && snap && !snap.meta) void loadMeta(); }, [url.lens, snap, loadMeta]);   // the time lens needs sub-question attachments
  useEffect(() => { const el = host.current; if (!el) return; const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) })); ro.observe(el); return () => ro.disconnect(); }, []);

  // Throttled consumers of viewport changes: URL sync and the density/points switch. Never re-render per pan frame.
  const syncTimer = useRef<number | null>(null);
  const onViewport = useCallback((v: ViewportState) => {
    viewportRef.current = v;
    if (syncTimer.current !== null) return;
    syncTimer.current = window.setTimeout(() => {
      syncTimer.current = null; const cur = viewportRef.current; if (!cur) return;
      setDensityMode(cur.scale < DENSITY_BELOW_SCALE);
      const s = serializeUrlState({ ...urlRef.current, v: [+cur.x.toFixed(3), +cur.y.toFixed(3), +cur.scale.toFixed(3)] });
      history.replaceState(null, "", location.pathname + s);
    }, 250);
  }, []);
  const urlRef = useRef(url); urlRef.current = url;
  useEffect(() => { const cur = viewportRef.current; const s = serializeUrlState({ ...url, v: cur ? [+cur.x.toFixed(3), +cur.y.toFixed(3), +cur.scale.toFixed(3)] : undefined }); history.replaceState(null, "", location.pathname + s); }, [url]);

  const ctx = useMemo(() => snap ? {
    centerId: CENTER_ID,
    primarySub: snap.points.ids.map((_, i) => primarySeed(snap.meta?.subQuestions[i]?.[0] ?? null, snap.labels.questions)),
    subOrder: snap.labels.questions.filter((q) => q.parentId === "core").map((q) => q.id),
  } : null, [snap]);
  const mask = useMemo(() => snap ? visibleMask(snap.points, url.minGrade, url.showAll, filters, snap.meta) : null, [snap, url.minGrade, url.showAll, filters]);
  const target = useMemo(() => snap && ctx ? lensXY(url.lens, snap.points, ctx) : null, [snap, ctx, url.lens]);

  // Lens switch: tween every point from its previous to its new position (identity-preserving); 600 ms, then static.
  const [xy, setXy] = useState<{ x: Float32Array; y: Float32Array } | null>(null);
  const prev = useRef<{ x: Float32Array; y: Float32Array } | null>(null);
  useEffect(() => {
    if (!target) return; const from = prev.current ?? target;
    if (from === target) { setXy(target); prev.current = target; return; }
    const n = target.x.length; let raf = 0; const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 600);
      setXy({ x: tween(from.x, target.x, t, new Float32Array(n)), y: tween(from.y, target.y, t, new Float32Array(n)) });
      if (t < 1) raf = requestAnimationFrame(step); else { prev.current = target; setXy(target); }
    };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [target]);

  const data = useMemo(() => {
    if (!snap || !xy || !mask) return null; const idx: number[] = []; for (let i = 0; i < snap.points.count; i++) if (mask[i]) idx.push(i);
    const x = new Float32Array(idx.length), y = new Float32Array(idx.length), category = new Uint8Array(idx.length);
    idx.forEach((i, r) => { x[r] = xy.x[i]; y[r] = xy.y[i]; category[r] = categoryIndex(snap.points.leaf[i], snap.points.grade[i]); });
    return { x, y, category, idx };
  }, [snap, xy, mask]);
  const viewData = useMemo(() => (data ? { x: data.x, y: data.y, category: data.category } : null), [data]);
  const labels = useMemo(() => (snap && target && ctx ? lensLabels(url.lens, snap.points, target, { questions: snap.labels.questions, subOrder: ctx.subOrder, terrainLabels: snap.labels.labels }) : []), [snap, target, url.lens, ctx]);
  const config = useMemo(() => ({ colorScheme: "dark" as const, mode: (densityMode && url.lens === "terrain" ? "density" : "points") as "density" | "points", minimumDensity: 0.002, autoLabelEnabled: false }), [densityMode, url.lens]);

  // Overlay: one stable object; the class reads live values from the store (no re-instantiation on render).
  const select = useCallback((xId: string) => { setUrl((u) => ({ ...u, sel: xId })); void loadMeta(); }, [loadMeta]);
  const store = useRef<OverlayStore>({ snap: null, idx: [], xy: null, loadMeta, onPick: () => {}, version: 0 });
  store.current.snap = snap; store.current.idx = data?.idx ?? []; store.current.xy = data ? { x: data.x, y: data.y } : null; store.current.selected = url.sel; store.current.loadMeta = loadMeta;
  store.current.onPick = (row) => { if (data && snap) select(snap.points.ids[data.idx[row]]); };
  store.current.version = (data ? data.idx.length : 0) + (snap?.meta ? 1_000_000 : 0);
  const overlay = useMemo(() => ({ class: CardOverlay, props: { store: store.current } }), []);

  const flyTo = useCallback((i: number) => { if (xy) { const v = { x: xy.x[i], y: xy.y[i], scale: 6 }; viewportRef.current = v; setFlyViewport(v); setDensityMode(false); } }, [xy]);

  let body: React.ReactNode;
  if (error) body = <div style={{ padding: 24 }}>Could not load the map: {error}</div>;
  else if (!snap || !data || !viewData || gpu === null) body = <div style={{ padding: 24 }}>Loading map…</div>;
  else if (gpu) body = (
    <EmbeddingView data={viewData} categoryColors={COLORS} labels={labels} width={size.w} height={size.h} config={config}
      viewportState={flyViewport} onViewportState={onViewport} customOverlay={overlay} />
  );
  else body = (
    <CanvasFallback data={data} labels={labels} snap={snap} viewport={flyViewport} onViewport={onViewport} width={size.w} height={size.h}
      onPick={(row) => select(snap.points.ids[data.idx[row]])} />
  );
  return (
    <div ref={host} style={{ position: "fixed", inset: 0 }}>
      {body}
      {gpu === false && snap && <div className="fallback-note dim small">WebGL fallback: no density terrain or cards in this browser.</div>}
      {snap && <TopBar url={url} setUrl={setUrl} snap={snap} onFlyTo={flyTo} />}
      {snap && <Filters snap={snap} filters={filters} setFilters={setFilters} url={url} setUrl={setUrl} loadMeta={loadMeta} />}
      {snap && url.sel && <Inspector snap={snap} xId={url.sel} onClose={() => setUrl((u) => ({ ...u, sel: undefined }))} loadMeta={loadMeta} />}
    </div>
  );
}
