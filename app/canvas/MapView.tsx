"use client";
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { MapEngine, type EngineData } from "./gl/engine";
import { TerrainService } from "./gl/terrainService";
import { buildTerrain } from "./terrain/build";
import type { TerrainInput } from "./terrain/types";
import type { Camera } from "./render/camera";
import type { LabelIn } from "./render/labels";

export type MapHandle = { flyTo: (x: number, y: number, scale?: number) => void; fit: () => void; camera: () => Camera | null };
type Props = { data: EngineData | null; target: { x: Float32Array; y: Float32Array } | null; lens: string; labels: LabelIn[]; fitAnchors: { x: number; y: number }[]; terrain: { key: string; input: TerrainInput } | null; selectedRow: number; initialCamera: Camera | null; onCamera: (c: Camera) => void; onPick: (row: number) => void };

/** React shell around MapEngine: a WebGL2 canvas for geometry and a Canvas 2D overlay for text, stacked. Props in, imperative fly-to out; no per-frame React state. */
const MapView = forwardRef<MapHandle, Props>(function MapView({ data, target, lens, labels, fitAnchors, terrain, selectedRow, initialCamera, onCamera, onPick }, ref) {
  const glRef = useRef<HTMLCanvasElement>(null); const ovRef = useRef<HTMLCanvasElement>(null); const engine = useRef<MapEngine | null>(null); const lastLens = useRef(lens);
  const cbs = useRef({ onCamera, onPick }); cbs.current = { onCamera, onPick };
  useEffect(() => {
    const service = new TerrainService({ buildInline: buildTerrain });
    const eng = new MapEngine(glRef.current!, ovRef.current!, { onCamera: (c) => cbs.current.onCamera(c), onPick: (r) => cbs.current.onPick(r), terrain: service }); engine.current = eng;
    const host = glRef.current!.parentElement!; const ro = new ResizeObserver(([e]) => eng.resize(e.contentRect.width, e.contentRect.height, window.devicePixelRatio || 1)); ro.observe(host);
    eng.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1);
    (window as unknown as { __map?: unknown }).__map = { stats: () => eng.stats(), readPixel: (x: number, y: number) => eng.readPixel(x, y), labels: () => eng.placedLabels(), camera: () => eng.camera, setCamera: (c: Camera) => eng.setCamera(c), project: (x: number, y: number) => eng.project(x, y), pointAt: (row: number) => eng.pointAt(row) };
    return () => { ro.disconnect(); eng.destroy(); service.dispose(); engine.current = null; };
  }, []);
  useEffect(() => { if (data && engine.current) engine.current.setData(data, initialCamera); }, [data]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!target || !engine.current) return; const lensChanged = lastLens.current !== lens; lastLens.current = lens; engine.current.setTarget(target.x, target.y, { refit: lensChanged, fitFill: lens === "time" ? 0.6 : 0.85, fitAnchors }); }, [target, lens]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (terrain && engine.current) engine.current.setTerrain(terrain.key, terrain.input); }, [terrain]);
  useEffect(() => { engine.current?.setLabels(labels); }, [labels]);
  useEffect(() => { engine.current?.setSelected(selectedRow); }, [selectedRow]);
  useImperativeHandle(ref, () => ({ flyTo: (x, y, s) => engine.current?.flyTo(x, y, s), fit: () => engine.current?.fit(), camera: () => engine.current?.camera ?? null }), []);
  return (<div style={{ position: "absolute", inset: 0, overflow: "hidden" }}><canvas ref={glRef} style={{ display: "block", position: "absolute", inset: 0 }} /><canvas ref={ovRef} style={{ display: "block", position: "absolute", inset: 0 }} /></div>);
});
export default MapView;
