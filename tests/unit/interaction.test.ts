import { describe, it, expect, vi } from "vitest";
import { Interaction } from "@/app/canvas/gl/interaction";

type Handler = (e: unknown) => void;
function fakeElement() {
  const listeners = new Map<string, Handler[]>(); const style: Record<string, string> = {};
  return {
    style, addEventListener: (t: string, h: Handler) => { listeners.set(t, [...(listeners.get(t) ?? []), h]); }, removeEventListener: (t: string, h: Handler) => { listeners.set(t, (listeners.get(t) ?? []).filter((x) => x !== h)); },
    setPointerCapture: () => {}, releasePointerCapture: () => {},
    fire: (t: string, e: Record<string, unknown>) => { for (const h of listeners.get(t) ?? []) h({ preventDefault() {}, ...e }); }, count: (t: string) => (listeners.get(t) ?? []).length,
  };
}
describe("Interaction", () => {
  it("drag pans by the pointer delta in pixels; a sub-3 px press is a click", () => {
    const el = fakeElement(); const pan = vi.fn(), click = vi.fn(); new Interaction(el as never, { pan, zoomAt: vi.fn(), click });
    el.fire("pointerdown", { pointerId: 1, offsetX: 100, offsetY: 100 }); el.fire("pointermove", { pointerId: 1, offsetX: 110, offsetY: 95 }); el.fire("pointerup", { pointerId: 1, offsetX: 110, offsetY: 95 });
    expect(pan).toHaveBeenCalledWith(10, -5); expect(click).not.toHaveBeenCalled();
    el.fire("pointerdown", { pointerId: 1, offsetX: 50, offsetY: 50 }); el.fire("pointermove", { pointerId: 1, offsetX: 51, offsetY: 51 }); el.fire("pointerup", { pointerId: 1, offsetX: 51, offsetY: 51 });
    expect(click).toHaveBeenCalledWith(51, 51);
  });
  it("wheel zooms at the cursor by exp(−deltaY·0.0015) (lines: 0.05); double-click zooms 2×", () => {
    const el = fakeElement(); const zoomAt = vi.fn(); new Interaction(el as never, { pan: vi.fn(), zoomAt, click: vi.fn() });
    el.fire("wheel", { offsetX: 10, offsetY: 20, deltaY: -100, deltaMode: 0 }); expect(zoomAt).toHaveBeenLastCalledWith(10, 20, Math.exp(0.15));
    el.fire("wheel", { offsetX: 10, offsetY: 20, deltaY: 3, deltaMode: 1 }); expect(zoomAt).toHaveBeenLastCalledWith(10, 20, Math.exp(-0.15));
    el.fire("dblclick", { offsetX: 5, offsetY: 6 }); expect(zoomAt).toHaveBeenLastCalledWith(5, 6, 2);
  });
  it("two pointers pinch-zoom at their midpoint by the distance ratio and do not pan", () => {
    const el = fakeElement(); const zoomAt = vi.fn(), pan = vi.fn(); new Interaction(el as never, { pan, zoomAt, click: vi.fn() });
    el.fire("pointerdown", { pointerId: 1, offsetX: 100, offsetY: 100 }); el.fire("pointerdown", { pointerId: 2, offsetX: 200, offsetY: 100 });
    el.fire("pointermove", { pointerId: 2, offsetX: 300, offsetY: 100 }); expect(zoomAt).toHaveBeenCalledWith(200, 100, 2); expect(pan).not.toHaveBeenCalled();
  });
  it("destroy removes every listener", () => {
    const el = fakeElement(); const i = new Interaction(el as never, { pan: vi.fn(), zoomAt: vi.fn(), click: vi.fn() }); i.destroy();
    for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "dblclick"]) expect(el.count(t)).toBe(0);
  });
});
