/** Pointer/wheel handling → camera intents. Drag pans, wheel and double-click zoom at the cursor, two pointers pinch, a still press is a click. */
export type InteractionHandlers = { pan: (dX: number, dY: number) => void; zoomAt: (X: number, Y: number, factor: number) => void; click: (X: number, Y: number) => void };
type El = HTMLElement & { setPointerCapture?: (id: number) => void };
export class Interaction {
  private drag: { id: number; X: number; Y: number; moved: boolean } | null = null; private pointers = new Map<number, { X: number; Y: number }>(); private pinchDist = 0;
  constructor(private el: El, private h: InteractionHandlers) {
    el.style.touchAction = "none"; el.style.cursor = "grab";
    el.addEventListener("pointerdown", this.onDown); el.addEventListener("pointermove", this.onMove); el.addEventListener("pointerup", this.onUp); el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false }); el.addEventListener("dblclick", this.onDbl);
  }
  private onDown = (e: PointerEvent) => {
    this.el.setPointerCapture?.(e.pointerId); this.pointers.set(e.pointerId, { X: e.offsetX, Y: e.offsetY });
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinchDist = Math.hypot(a.X - b.X, a.Y - b.Y); this.drag = null; return; }
    this.drag = { id: e.pointerId, X: e.offsetX, Y: e.offsetY, moved: false }; this.el.style.cursor = "grabbing";
  };
  private onMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { X: e.offsetX, Y: e.offsetY });
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; const dist = Math.hypot(a.X - b.X, a.Y - b.Y); if (this.pinchDist > 0 && dist > 0) this.h.zoomAt((a.X + b.X) / 2, (a.Y + b.Y) / 2, dist / this.pinchDist); this.pinchDist = dist; return; }
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dX = e.offsetX - this.drag.X, dY = e.offsetY - this.drag.Y; if (Math.hypot(dX, dY) > 3) this.drag.moved = true;
    if (dX !== 0 || dY !== 0) this.h.pan(dX, dY); this.drag.X = e.offsetX; this.drag.Y = e.offsetY;
  };
  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId); this.el.style.cursor = "grab";
    if (this.drag && this.drag.id === e.pointerId) { const wasClick = !this.drag.moved; this.drag = null; if (wasClick) this.h.click(e.offsetX, e.offsetY); }
  };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.h.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))); };
  private onDbl = (e: MouseEvent) => { this.h.zoomAt(e.offsetX, e.offsetY, 2); };
  destroy() {
    const el = this.el; el.removeEventListener("pointerdown", this.onDown); el.removeEventListener("pointermove", this.onMove); el.removeEventListener("pointerup", this.onUp); el.removeEventListener("pointercancel", this.onUp); el.removeEventListener("wheel", this.onWheel); el.removeEventListener("dblclick", this.onDbl);
  }
}
