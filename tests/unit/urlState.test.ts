import { describe, it, expect } from "vitest";
import { parseUrlState, serializeUrlState } from "@/app/canvas/urlState";
describe("urlState", () => {
  it("defaults", () => { expect(parseUrlState("")).toEqual({ lens: "terrain", minGrade: 1, showAll: false, recent: false }); });
  it("round-trips", () => { const s = { lens: "question" as const, minGrade: 2, showAll: true, recent: true, q: "audit trust", sel: "123", v: [1.5, -2, 3] as [number, number, number] }; expect(parseUrlState(serializeUrlState(s))).toEqual(s); });
  it("recent is off by default and only on for recent=1", () => { expect(parseUrlState("?recent=1").recent).toBe(true); expect(parseUrlState("?recent=yes").recent).toBe(false); expect(serializeUrlState({ lens: "terrain", minGrade: 1, showAll: false, recent: false })).toBe(""); });
  it("ignores garbage", () => { expect(parseUrlState("?lens=nope&g=9").lens).toBe("terrain"); expect(parseUrlState("?g=9").minGrade).toBe(1); });
});
