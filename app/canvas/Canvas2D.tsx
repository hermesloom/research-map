"use client";
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { MapEngine, type EngineData } from "./render/engine";
import type { Camera } from "./render/camera";
import type { LabelIn } from "./render/labels";
import { CardOverlay, type OverlayStore } from "./CardOverlay";

export type Canvas2DHandle = { flyTo: (x: number, y: number, scale?: number) => void; fit: () => void; camera: () => Camera | null };
type Props = { data: EngineData | null; target: { x: Float32Array; y: Float32Array } | null; labels: LabelIn[]; selectedRow: number; initialCamera: Camera | null; store: OverlayStore; onCamera: (c: Camera) => void; onPick: (row: number) => void };

/** React shell around MapEngine: props in, imperative fly-to out. Re-renders of this component are cheap (no per-frame state). */
const Canvas2D = forwardRef<Canvas2DHandle, Props>(function Canvas2D({ data, target, labels, selectedRow, initialCamera, store, onCamera, onPick }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const overlayRef = useRef<HTMLDivElement>(null); const engine = useRef<MapEngine | null>(null); const overlay = useRef<CardOverlay | null>(null);
  const cbs = useRef({ onCamera, onPick }); cbs.current = { onCamera, onPick };
  useEffect(() => {
    const canvas = canvasRef.current!; const eng = new MapEngine(canvas, { onCamera: (c) => cbs.current.onCamera(c), onPick: (r) => cbs.current.onPick(r) }); engine.current = eng;
    const host = canvas.parentElement!; const ro = new ResizeObserver(([e]) => eng.resize(e.contentRect.width, e.contentRect.height, window.devicePixelRatio || 1)); ro.observe(host);
    eng.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1);
    overlay.current = new CardOverlay(overlayRef.current!, { proxy: eng.proxy, store });
    return () => { ro.disconnect(); overlay.current?.destroy(); eng.destroy(); engine.current = null; };
  }, [store]);
  useEffect(() => { if (data && engine.current) engine.current.setData(data, initialCamera); }, [data]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (target && engine.current) engine.current.setTarget(target.x, target.y); }, [target]);
  useEffect(() => { engine.current?.setLabels(labels); }, [labels]);
  useEffect(() => { engine.current?.setSelected(selectedRow); }, [selectedRow]);
  useImperativeHandle(ref, () => ({ flyTo: (x, y, s) => engine.current?.flyTo(x, y, s), fit: () => engine.current?.fit(), camera: () => engine.current?.camera ?? null }), []);
  return (<div style={{ position: "absolute", inset: 0 }}><canvas ref={canvasRef} style={{ display: "block" }} /><div ref={overlayRef} /></div>);
});
export default Canvas2D;
