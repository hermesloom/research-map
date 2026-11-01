"use client";
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { MapEngine, type EngineData } from "./render/engine";
import type { Camera } from "./render/camera";
import type { LabelIn } from "./render/labels";

export type Canvas2DHandle = { flyTo: (x: number, y: number, scale?: number) => void; fit: () => void; camera: () => Camera | null };
type Props = { data: EngineData | null; target: { x: Float32Array; y: Float32Array } | null; lens: string; labels: LabelIn[]; selectedRow: number; initialCamera: Camera | null; onCamera: (c: Camera) => void; onPick: (row: number) => void };

/** React shell around MapEngine: props in, imperative fly-to out. Re-renders of this component are cheap (no per-frame state). */
const Canvas2D = forwardRef<Canvas2DHandle, Props>(function Canvas2D({ data, target, lens, labels, selectedRow, initialCamera, onCamera, onPick }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const engine = useRef<MapEngine | null>(null); const lastLens = useRef(lens);
  const cbs = useRef({ onCamera, onPick }); cbs.current = { onCamera, onPick };
  useEffect(() => {
    const canvas = canvasRef.current!; const eng = new MapEngine(canvas, { onCamera: (c) => cbs.current.onCamera(c), onPick: (r) => cbs.current.onPick(r) }); engine.current = eng;
    const host = canvas.parentElement!; const ro = new ResizeObserver(([e]) => eng.resize(e.contentRect.width, e.contentRect.height, window.devicePixelRatio || 1)); ro.observe(host);
    eng.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1);
    return () => { ro.disconnect(); eng.destroy(); engine.current = null; };
  }, []);
  useEffect(() => { if (data && engine.current) engine.current.setData(data, initialCamera); }, [data]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!target || !engine.current) return; const lensChanged = lastLens.current !== lens; lastLens.current = lens; engine.current.setTarget(target.x, target.y, { terrain: true, refit: lensChanged, fitFill: lens === "time" ? 0.6 : 0.85 }); }, [target, lens]);
  useEffect(() => { engine.current?.setLabels(labels); }, [labels]);
  useEffect(() => { engine.current?.setSelected(selectedRow); }, [selectedRow]);
  useImperativeHandle(ref, () => ({ flyTo: (x, y, s) => engine.current?.flyTo(x, y, s), fit: () => engine.current?.fit(), camera: () => engine.current?.camera ?? null }), []);
  return (<div style={{ position: "absolute", inset: 0 }}><canvas ref={canvasRef} style={{ display: "block" }} /></div>);
});
export default Canvas2D;
