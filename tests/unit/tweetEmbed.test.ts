import { describe, it, expect } from "vitest";
import { loadWidgets, type WidgetsHost } from "@/app/canvas/tweetEmbed";

function fakeHost(): WidgetsHost & { scripts: { src: string; onload?: () => void }[] } {
  const scripts: { src: string; onload?: () => void }[] = [];
  return { scripts, win: {} as WidgetsHost["win"], appendScript(src) { const s: { src: string; onload?: () => void } = { src }; scripts.push(s); return s; } };
}

describe("loadWidgets", () => {
  it("inserts the X widgets script once and resolves every caller with the same twttr object once it has loaded", async () => {
    const host = fakeHost(); const p1 = loadWidgets(host), p2 = loadWidgets(host);
    expect(host.scripts.length).toBe(1); expect(host.scripts[0].src).toBe("https://platform.twitter.com/widgets.js");
    const twttr = { widgets: { createTweet: async () => null } }; (host.win as { twttr?: unknown }).twttr = twttr; host.scripts[0].onload!();
    expect(await p1).toBe(twttr); expect(await p2).toBe(twttr);
  });
  it("resolves immediately when the script is already present on the window", async () => {
    const host = fakeHost(); const twttr = { widgets: { createTweet: async () => null } }; (host.win as { twttr?: unknown }).twttr = twttr;
    expect(await loadWidgets(host)).toBe(twttr); expect(host.scripts.length).toBe(0);
  });
});
