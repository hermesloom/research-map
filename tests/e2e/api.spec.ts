import { test, expect } from "@playwright/test";
/** The LLM-facing API against the dev fixture snapshot (webServer sets NEXT_PUBLIC_DEV_MANIFEST). */
test("llms.txt is a plain-text guide", async ({ request }) => {
  const r = await request.get("/llms.txt"); expect(r.status()).toBe(200); expect(r.headers()["content-type"]).toContain("text/plain");
  const t = await r.text(); expect(t.startsWith("# research.nalenz.org")).toBe(true); expect(t).toContain("/api/v1/posts"); expect(t).toContain("/api/mcp");
});
test("posts are rows with labels inlined, in JSON and Markdown", async ({ request }) => {
  const r = await request.get("/api/v1/posts?limit=2&minGrade=2"); expect(r.status()).toBe(200); const j = await r.json();
  expect(j.data).toHaveLength(2); expect(j.data[0]).toMatchObject({ theme: { label: expect.any(String) }, topic: { label: expect.any(String) }, relevance: { label: expect.stringMatching(/core|adjacent/) } }); expect(j.page.next).toContain("offset=2"); expect(j.snapshot.count).toBeGreaterThan(0);
  const md = await request.get("/api/v1/posts?limit=1", { headers: { accept: "text/markdown" } }); expect(md.headers()["content-type"]).toContain("text/markdown"); expect(await md.text()).toContain("- relevance:");
});
test("overview, openapi, errors and the MCP endpoint", async ({ request }) => {
  expect((await (await request.get("/api/v1/overview")).json()).themes.length).toBeGreaterThan(0);
  expect((await (await request.get("/api/v1/openapi.json")).json()).openapi).toBe("3.1.0");
  const bad = await request.get("/api/v1/posts?minGrade=9"); expect(bad.status()).toBe(400); expect((await bad.json()).error.hint).toContain("minGrade");
  const s = await request.get("/api/v1/search?q=x"); expect(s.status()).toBe(503);
  const mcp = await request.post("/api/mcp", { headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
  expect(mcp.status()).toBe(200); expect((await mcp.text())).toContain("search_posts");
});
