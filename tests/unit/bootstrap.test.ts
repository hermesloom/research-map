import { describe, it, expect } from "vitest";
import { toPayload, estimateFirecrawlCredits } from "@/scripts/bootstrap-lib";
describe("bootstrap helpers", () => {
  it("adapts the export file shape to an API payload", () => {
    const p = toPayload({ tweets: [{ id: "1", text: "x", created_at: "2026-01-01T00:00:00Z" }], includes: { media: [{ media_key: "m", type: "photo" }], tweets: [], users: [] } });
    expect(p.data!.length).toBe(1); expect(p.includes!.media!.length).toBe(1);
  });
  it("counts only generic-host, non-media, first URLs for the credit estimate", () => {
    const items: any = [{ kind: "link", urls: [{ expandedUrl: "https://xtdb.com/", isMedia: false }] }, { kind: "link", urls: [{ expandedUrl: "https://en.wikipedia.org/wiki/A", isMedia: false }] }, { kind: "media", urls: [{ expandedUrl: "https://x.com/u/status/1/photo/1", isMedia: true }] }, { kind: "replyToOther", urls: [{ expandedUrl: "https://foo.org", isMedia: false }] }];
    expect(estimateFirecrawlCredits(items)).toBe(1);
  });
});
