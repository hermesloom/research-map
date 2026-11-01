import type { OverlayProxy } from "embedding-atlas/react";
import type { Snapshot } from "./useSnapshot";
import type { MetaFile } from "@/lib/snapshot";
import { visibleRows, newestRows, cardHtml } from "./overlayLogic";

export type OverlayProps = { proxy: OverlayProxy; snap: Snapshot; idx: number[]; scale: number; xy: { x: Float32Array; y: Float32Array }; selected?: string; loadMeta: () => Promise<MetaFile> };

/** DOM layer over the GPU canvas: provisional rings, newest-arrivals halo + trail, and real cards at close zoom. */
export class CardOverlay {
  private svg: SVGSVGElement; private cards: HTMLDivElement;
  constructor(private target: HTMLDivElement, props: OverlayProps) {
    target.style.pointerEvents = "none"; target.style.position = "absolute"; target.style.inset = "0"; target.style.overflow = "hidden";
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%"); target.appendChild(this.svg);
    this.cards = document.createElement("div"); this.cards.className = "cards"; target.appendChild(this.cards);
    this.update(props);
  }
  update(props: OverlayProps) {
    const { proxy, snap, idx, scale, xy } = props; const n = idx.length;
    const rings: string[] = []; const newest = newestRows(snap.points, idx, 20); const path: string[] = [];
    for (let r = 0; r < n; r++) { const i = idx[r]; if (snap.points.provisional[i]) { const p = proxy.location(xy.x[r], xy.y[r]); rings.push(`<circle cx="${p.x}" cy="${p.y}" r="7" fill="none" stroke="#fff" stroke-opacity=".8"/>`); } }
    for (const r of [...newest].reverse()) { const p = proxy.location(xy.x[r], xy.y[r]); path.push(`${p.x},${p.y}`); rings.push(`<circle cx="${p.x}" cy="${p.y}" r="11" fill="none" stroke="#ffd966" stroke-opacity=".6"/>`); }
    const sel = props.selected ? idx.indexOf(snap.points.ids.indexOf(props.selected)) : -1;
    if (sel >= 0) { const p = proxy.location(xy.x[sel], xy.y[sel]); rings.push(`<circle cx="${p.x}" cy="${p.y}" r="14" fill="none" stroke="#9cc4ff" stroke-width="2"/>`); }
    this.svg.innerHTML = `<polyline points="${path.join(" ")}" fill="none" stroke="#ffd966" stroke-opacity=".25"/>${rings.join("")}`;
    if (scale >= 5 && snap.meta) {
      const rows = visibleRows(xy.x, xy.y, proxy.location, proxy.width, proxy.height, 50);
      this.cards.innerHTML = rows.map((r) => {
        const i = idx[r]; const p = proxy.location(xy.x[r], xy.y[r]); const date = new Date(snap.points.createdAt[i] * 1000).toISOString().slice(0, 10);
        return `<div style="position:absolute;left:${p.x + 10}px;top:${p.y - 10}px;pointer-events:auto;max-width:260px">${cardHtml(snap.meta!, i, { grade: snap.points.grade[i], provisional: !!snap.points.provisional[i], url: `https://x.com/sigalor/status/${snap.points.ids[i]}`, date })}</div>`;
      }).join("");
    } else { if (scale >= 5 && !snap.meta) void props.loadMeta(); this.cards.innerHTML = ""; }
  }
  destroy() { this.target.innerHTML = ""; }
}
