import { describe, it, expect } from "vitest";
import { NormalizedSchema, GradeSchema } from "@/lib/types";

describe("schemas", () => {
  it("accepts a valid normalization", () => {
    const r = NormalizedSchema.safeParse({ title: "XTDB", summaryEn: "A bitemporal database.", gist: "XTDB", tagsEn: ["database"], language: "en", entities: ["XTDB"], contentKind: "link" });
    expect(r.success).toBe(true);
  });
  it("rejects grade outside 0..3 and unknown role", () => {
    expect(GradeSchema.safeParse({ grade: 4, role: "evidence", rationale: "x", subQuestionIds: [] }).success).toBe(false);
    expect(GradeSchema.safeParse({ grade: 2, role: "vibes", rationale: "x", subQuestionIds: [] }).success).toBe(false);
  });
});
