"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmbeddingView, type ViewportState, type DataPoint } from "embedding-atlas/react";
import { useSnapshot } from "./useSnapshot";
import { lensXY, tween } from "./lenses";
import { categoryColors, categoryIndex, visibleMask } from "./colors";
import { parseUrlState, serializeUrlState, type UrlState } from "./urlState";
import { probeWebGPU } from "./webgpu";
import CanvasFallback from "./CanvasFallback";
import { CardOverlay } from "./CardOverlay";
import TopBar from "./TopBar";
import Inspector from "./Inspector";
import Filters, { type FilterState } from "./Filters";

const COLORS = categoryColors();
const CENTER_ID = process.env.NEXT_PUBLIC_RESEARCH_QUESTION_POST_ID ?? "2115703316281778260";

export default function Canvas() {
  const { snap, error, loadMeta } = useSnapshot();
  const [url, setUrl] = useState<UrlState>(() => parseUrlState(typeof location === "undefined" ? "" : location.search));
  const [viewport, setViewport] = useState<ViewportState | null>(url.v ? { x: url.v[0], y: url.v[1], scale: url.v[2] } : null);
  const [tooltip, setTooltip] = useState<DataPoint | null>(null);
  const [filters, setFilters] = useState<FilterState>({});
  const [size, setSize] = useState({ w: 800, h: 600 });
  const host = useRef<HTMLDivElement>(null);
  const [gpu, setGpu] = useState<boolean | null>(null);
  useEffect(() => { probeWebGPU().then(setGpu); }, []);

  useEffect(() => { const el = host.current; if (!el) return; const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(el); return () => ro.disconnect(); }, [snap]);
  useEffect(() => {
    const s = serializeUrlState({ ...url, v: viewport ? [+viewport.x.toFixed(3), +viewport.y.toFixed(3), +viewport.scale.toFixed(3)] : undefined });
    const t = setTimeout(() => history.replaceState(null, "", location.pathname + s), 300); return () => clearTimeout(t);
  }, [url, viewport]);

  const ctx = useMemo(() => snap ? {
    centerId: CENTER_ID,
    primarySub: snap.points.ids.map((_, i) => snap.meta?.subQuestions[i]?.[0] ?? null),
    subOrder: snap.labels.questions.filter((q) => q.parentId === "core").map((q) => q.id),
  } : null, [snap]);
  const mask = useMemo(() => snap ? visibleMask(snap.points, url.minGrade, url.showAll, filters, snap.meta) : null, [snap, url.minGrade, url.showAll, filters]);
  const target = useMemo(() => snap && ctx ? lensXY(url.lens, snap.points, ctx) : null, [snap, ctx, url.lens]);

  // Lens switch: tween every point from its previous to its new position (identity-preserving).
  const [xy, setXy] = useState<{ x: Float32Array; y: Float32Array } | null>(null);
  const prev = useRef<{ x: Float32Array; y: Float32Array } | null>(null);
  useEffect(() => {
    if (!target) return; const from = prev.current ?? target; const n = target.x.length;
    const ox = new Float32Array(n), oy = new Float32Array(n); let raf = 0; const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 600);
      setXy({ x: tween(from.x, target.x, t, ox).slice(), y: tween(from.y, target.y, t, oy).slice() });
      if (t < 1) raf = requestAnimationFrame(step); else prev.current = target;
    };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [target]);

  const data = useMemo(() => {
    if (!snap || !xy || !mask) return null; const idx: number[] = []; for (let i = 0; i < snap.points.count; i++) if (mask[i]) idx.push(i);
    const x = new Float32Array(idx.length), y = new Float32Array(idx.length), category = new Uint8Array(idx.length);
    idx.forEach((i, r) => { x[r] = xy.x[i]; y[r] = xy.y[i]; category[r] = categoryIndex(snap.points.leaf[i], snap.points.grade[i]); });
    return { x, y, category, idx };
  }, [snap, xy, mask]);
  const labels = useMemo(() => {
    if (!snap) return [];
    if (url.lens === "terrain") return snap.labels.labels;
    return snap.labels.questions.filter((q) => q.parentId === "core").map((q, i) => ({ x: 0, y: -(i + 0.4), content: q.text, level: 0, priority: 1000 }));
  }, [snap, url.lens]);

  if (error) return <div style={{ padding: 24 }}>Could not load the map: {error}</div>;
  if (!snap || !data || gpu === null) return <div style={{ padding: 24 }}>Loading map…</div>;
  const scale = viewport?.scale ?? 1;
  const flyTo = (i: number) => { if (xy) setViewport({ x: xy.x[i], y: xy.y[i], scale: 6 }); };
  return (
    <div ref={host} style={{ position: "fixed", inset: 0 }}>
      {gpu ? (
        <EmbeddingView
          data={{ x: data.x, y: data.y, category: data.category }} categoryColors={COLORS} labels={labels} width={size.w} height={size.h}
          config={{ colorScheme: "dark", mode: scale < 1.5 && url.lens === "terrain" ? "density" : "points", minimumDensity: 0.002, autoLabelEnabled: false }}
          viewportState={viewport} onViewportState={setViewport} tooltip={tooltip} onTooltip={setTooltip}
          onSelection={(pts) => {
            const r = pts?.[0]; if (!r) return; let best = 0, bd = Infinity;
            for (let k = 0; k < data.x.length; k++) { const dd = (data.x[k] - r.x) ** 2 + (data.y[k] - r.y) ** 2; if (dd < bd) { bd = dd; best = k; } }
            const i = data.idx[best]; setUrl((u) => ({ ...u, sel: snap.points.ids[i] })); void loadMeta();
          }}
          customOverlay={{ class: CardOverlay, props: { snap, idx: data.idx, scale, xy: { x: data.x, y: data.y }, selected: url.sel, loadMeta } }}
        />
      ) : (
        <CanvasFallback data={data} labels={labels as never} snap={snap} viewport={viewport} onViewport={setViewport}
          onPick={(row) => { const i = data.idx[row]; setUrl((u) => ({ ...u, sel: snap.points.ids[i] })); void loadMeta(); }} />
      )}
      {!gpu && <div className="fallback-note dim small">WebGL fallback: no density terrain or cards in this browser.</div>}
      <TopBar url={url} setUrl={setUrl} snap={snap} onFlyTo={flyTo} />
      <Filters snap={snap} filters={filters} setFilters={setFilters} url={url} setUrl={setUrl} loadMeta={loadMeta} />
      {url.sel && <Inspector snap={snap} xId={url.sel} onClose={() => setUrl((u) => ({ ...u, sel: undefined }))} loadMeta={loadMeta} />}
    </div>
  );
}
