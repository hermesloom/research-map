import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseTimeline, domainOf } from "@/lib/x/parse";
const payload = JSON.parse(fs.readFileSync("tests/fixtures/timeline-sample.json", "utf8"));
const OWNER = "1852658982608846848";
const items = parseTimeline(payload, OWNER, "2115703316281778260");

describe("parseTimeline", () => {
  it("keeps every tweet exactly once and sorts by createdAt ascending", () => {
    expect(items.length).toBe(payload.data.length);
    expect(new Set(items.map((i) => i.xId)).size).toBe(items.length);
    for (let i = 1; i < items.length; i++) expect(items[i].createdAt >= items[i - 1].createdAt).toBe(true);
  });
  it("classifies kinds", () => {
    const kinds = new Set(items.map((i) => i.kind));
    for (const k of ["text", "link", "media", "selfReply", "replyToOther", "retweet"]) expect(kinds.has(k as any)).toBe(true);
  });
  it("classifies photo permalink as media, not link", () => {
    const photo = items.find((i) => i.urls.length > 0 && i.urls.every((u) => /x\.com\/\w+\/status\/\d+\/photo\/1/.test(u.expandedUrl)));
    expect(photo).toBeDefined();
    expect(photo!.kind).toBe("media");
    expect(photo!.urls.every((u) => u.isMedia)).toBe(true);
  });
  it("uses note_tweet text when present", () => {
    const long = items.find((i) => i.text.length > 280);
    expect(long).toBeDefined();
  });
  it("expands t.co to unwound/expanded URL and extracts domain", () => {
    const link = items.find((i) => i.kind === "link")!;
    expect(link.urls[0].expandedUrl.startsWith("https://t.co/")).toBe(false);
    expect(link.urls[0].domain).not.toMatch(/^www\./);
  });
  it("flags the research question post", () => {
    expect(items.find((i) => i.xId === "2115703316281778260")!.isResearchQuestion).toBe(true);
  });
  it("sets parentId for replies and quotedId for quotes", () => {
    expect(items.find((i) => i.kind === "selfReply")!.parentId).toMatch(/^\d+$/);
    expect(items.find((i) => i.kind === "quote")!.quotedId).toMatch(/^\d+$/);
  });
  it("attaches media objects from includes", () => {
    const m = items.find((i) => i.kind === "media" && i.media.length > 0)!;
    expect(m).toBeDefined();
    expect(m.media[0].mediaKey).toBeTruthy();
  });
  it("domainOf strips www and lowercases", () => {
    expect(domainOf("https://WWW.Example.com/a?b")).toBe("example.com");
    expect(domainOf("not a url")).toBe("");
  });
});
