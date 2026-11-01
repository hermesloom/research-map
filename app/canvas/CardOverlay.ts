import type { Snapshot } from "./useSnapshot";
import type { MetaFile } from "@/lib/snapshot";
import { visibleRows, newestRows, cardHtml, affineFromProxy, type ProxyLike } from "./overlayLogic";

/** Mutable store shared with Canvas so the overlay object passed to EmbeddingView can stay referentially stable. */
export type OverlayStore = { snap: Snapshot | null; idx: number[]; xy: { x: Float32Array; y: Float32Array } | null; selected?: string; loadMeta: () => Promise<MetaFile>; onPick: (row: number) => void; version: number };
export type OverlayProps = { proxy: ProxyLike; store: OverlayStore };

/** DOM layer over the GPU canvas: provisional rings, newest-arrivals halo + trail, cards at close zoom, click-to-select.
 *  Renders at most once per animation frame and only when the viewport or the store changed. */
export class CardOverlay {
  private svg: SVGSVGElement; private cards: HTMLDivElement; private props: OverlayProps; private raf = 0; private sig = ""; private host: HTMLElement | null;
  constructor(private target: HTMLDivElement, props: OverlayProps) {
    this.props = props; target.style.pointerEvents = "none"; target.style.position = "absolute"; target.style.inset = "0"; target.style.overflow = "hidden";
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%"); target.appendChild(this.svg);
    this.cards = document.createElement("div"); this.cards.className = "cards"; target.appendChild(this.cards);
    this.host = target.parentElement;
    this.tick();
  }
  update(props: OverlayProps) { this.props = props; }
  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const { proxy, store } = this.props; if (!store.snap || !store.xy) return;
    const a = proxy.location(0, 0), b = proxy.location(1, 1);
    const sig = `${a.x.toFixed(2)},${a.y.toFixed(2)},${b.x.toFixed(2)},${b.y.toFixed(2)},${proxy.width},${proxy.height},${store.version},${store.selected ?? ""},${store.snap.meta ? 1 : 0}`;
    if (sig === this.sig) return; this.sig = sig; this.render();
  };
  private render() {
    const { proxy, store } = this.props; const snap = store.snap!, xy = store.xy!, idx = store.idx; const n = idx.length;
    void n; void newestRows;
    const pxPerUnit = affineFromProxy(proxy).pxPerUnit;
    const closeZoom = (proxy.zoomRel ?? pxPerUnit / 50) >= 8; // cards join at the same relative zoom as item titles
    if (closeZoom && snap.meta) {
      const rows = visibleRows(xy.x, xy.y, proxy.location, proxy.width, proxy.height, 50);
      this.cards.innerHTML = rows.map((r) => {
        const i = idx[r]; const p = proxy.location(xy.x[r], xy.y[r]); const date = new Date(snap.points.createdAt[i] * 1000).toISOString().slice(0, 10);
        return `<div style="position:absolute;left:${p.x + 10}px;top:${p.y - 10}px;pointer-events:auto;max-width:260px">${cardHtml(snap.meta!, i, { grade: snap.points.grade[i], provisional: !!snap.points.provisional[i], url: `https://x.com/sigalor/status/${snap.points.ids[i]}`, date })}</div>`;
      }).join("");
    } else { if (closeZoom && !snap.meta) void store.loadMeta(); if (this.cards.innerHTML) this.cards.innerHTML = ""; }
  }
  destroy() { cancelAnimationFrame(this.raf); this.target.innerHTML = ""; }
}
