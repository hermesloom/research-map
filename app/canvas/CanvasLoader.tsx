"use client";
import dynamic from "next/dynamic";
const Canvas = dynamic(() => import("./Canvas"), { ssr: false, loading: () => <p style={{ padding: 16 }}>Loading map…</p> });
export default function CanvasLoader() { return <Canvas />; }
