import type { OverlayProxy } from "embedding-atlas/react";
import type { Snapshot } from "./useSnapshot";
import type { MetaFile } from "@/lib/snapshot";
export type OverlayProps = { proxy: OverlayProxy; snap: Snapshot; idx: number[]; scale: number; xy: { x: Float32Array; y: Float32Array }; selected?: string; loadMeta: () => Promise<MetaFile> };
/** Stub until Task 23. */
export class CardOverlay {
  constructor(private target: HTMLDivElement, _props: OverlayProps) { target.style.pointerEvents = "none"; }
  update(_props: OverlayProps) {}
  destroy() { this.target.innerHTML = ""; }
}
