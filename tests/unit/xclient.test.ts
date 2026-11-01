import { describe, it, expect, beforeEach } from "vitest";
import { fetchNewPosts } from "@/lib/x/client";

beforeEach(() => {
  process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k";
  process.env.X_CONSUMER_KEY = "ck"; process.env.X_CONSUMER_SECRET = "cs"; process.env.X_ACCESS_TOKEN = "t"; process.env.X_ACCESS_TOKEN_SECRET = "ts";
});

describe("fetchNewPosts", () => {
  it("refuses to run without since_id or start_time", async () => {
    await expect(fetchNewPosts({ fetchImpl: async () => new Response("{}") } as any)).rejects.toThrow(/since_id|start_time/);
  });
  it("requests the owner timeline with the exact field set and no author expansion, and paginates", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init: any) => {
      calls.push(url);
      expect(init.headers.Authorization).toMatch(/^OAuth /);
      if (calls.length === 1) return new Response(JSON.stringify({ data: [{ id: "2", text: "b", created_at: "2026-01-02T00:00:00Z" }], meta: { next_token: "N" } }));
      return new Response(JSON.stringify({ data: [{ id: "1", text: "a", created_at: "2026-01-01T00:00:00Z" }], meta: {} }));
    };
    const r = await fetchNewPosts({ sinceId: "0", fetchImpl: fetchImpl as any });
    expect(r.requests).toBe(2);
    expect(r.payload.data!.map((t) => t.id)).toEqual(["2", "1"]);
    const u = new URL(calls[0]);
    expect(u.pathname).toBe("/2/users/1852658982608846848/tweets");
    expect(u.searchParams.get("since_id")).toBe("0");
    expect(u.searchParams.get("expansions")).toBe("attachments.media_keys");
    expect(u.searchParams.get("tweet.fields")).toContain("note_tweet");
    expect(u.searchParams.get("expansions")).not.toContain("author_id");
    expect(new URL(calls[1]).searchParams.get("pagination_token")).toBe("N");
  });
  it("returns an empty payload on 0 results without a second request", async () => {
    let n = 0;
    const r = await fetchNewPosts({ sinceId: "9", fetchImpl: (async () => { n++; return new Response(JSON.stringify({ meta: { result_count: 0 } })); }) as any });
    expect(n).toBe(1); expect(r.payload.data ?? []).toEqual([]);
  });
});
