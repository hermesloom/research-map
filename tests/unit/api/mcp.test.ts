import { describe, it, expect } from "vitest";
import { makeCorpus } from "./fixture";
import { createHandler } from "@/lib/api/mcp";
import { TOOLS } from "@/lib/api/tools";

const c = makeCorpus();
const handler = createHandler({ corpus: async () => c, search: { configured: () => true, embed: async () => [[1]], knn: async () => [{ xId: "1001", score: 0.9 }] }, base: "https://r.org" });
let id = 0;
async function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await handler(new Request("http://localhost:3000/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) }));
  const ct = res.headers.get("content-type") ?? ""; const body = await res.text();
  const json = ct.includes("text/event-stream") ? JSON.parse(body.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).at(-1)!) : body ? JSON.parse(body) : null;
  return { status: res.status, ct, json };
}
describe("MCP over Streamable HTTP (stateless)", () => {
  it("initialize advertises the server and instructions", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    expect(r.status).toBe(200); expect(r.json.result.serverInfo.name).toBe("research-map"); expect(r.json.result.instructions).toMatch(/get_overview/); expect(r.json.result.capabilities.tools).toBeDefined(); expect(r.json.result.capabilities.resources).toBeDefined();
  });
  it("tools/list exposes the eight tools with JSON schemas and read-only annotations", async () => {
    const r = await rpc("tools/list"); const tools = r.json.result.tools as { name: string; inputSchema: { type: string; properties?: Record<string, unknown> }; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name)); const lp = tools.find((t) => t.name === "list_posts")!; expect(lp.inputSchema.type).toBe("object"); expect(Object.keys(lp.inputSchema.properties!)).toContain("minGrade"); expect(lp.annotations.readOnlyHint).toBe(true);
  });
  it("tools/call returns markdown text plus structuredContent", async () => {
    const r = await rpc("tools/call", { name: "get_overview", arguments: {} }); expect(r.json.result.content[0].type).toBe("text"); expect(r.json.result.content[0].text).toContain("## Themes and topics"); expect(r.json.result.structuredContent.counts.posts).toBe(7);
    const s = await rpc("tools/call", { name: "search_posts", arguments: { q: "ontologies", limit: 3 } }); expect(s.json.result.structuredContent.data[0].id).toBe("1001");
  });
  it("unknown ids come back as an isError result with the hint, not a protocol error", async () => { const r = await rpc("tools/call", { name: "get_theme", arguments: { id: 42 } }); expect(r.json.result.isError).toBe(true); expect(r.json.result.content[0].text).toMatch(/No theme with id 42/); });
  it("a search backend failure is a 503-style isError result, not a crash", async () => {
    const h = createHandler({ corpus: async () => c, search: { configured: () => true, embed: async () => { throw new Error("openai 429"); }, knn: async () => [] }, base: "https://r.org" });
    const res = await h(new Request("http://localhost:3000/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "search_posts", arguments: { q: "x" } } }) }));
    const body = await res.text(); const json = JSON.parse(body.includes("data:") ? body.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).at(-1)! : body); expect(json.result.isError).toBe(true); expect(json.result.content[0].text).toMatch(/search backend did not answer/);
  });
  it("bad arguments are rejected", async () => { const r = await rpc("tools/call", { name: "list_posts", arguments: { limit: 99999 } }); expect(r.json.error ?? r.json.result.isError).toBeTruthy(); });
  it("resources/list and resources/read", async () => {
    const l = await rpc("resources/list"); expect((l.json.result.resources as { uri: string }[]).map((x) => x.uri).sort()).toEqual(["researchmap://llms.txt", "researchmap://overview"]);
    const o = await rpc("resources/read", { uri: "researchmap://overview" }); expect(o.json.result.contents[0].text).toContain("# research.nalenz.org — the map at a glance");
    const t = await rpc("resources/read", { uri: "researchmap://llms.txt" }); expect(t.json.result.contents[0].text).toContain("https://r.org/api/v1/posts");
  });
  it("GET (legacy SSE) is refused since serving is stateless", async () => { const res = await handler(new Request("http://localhost:3000/api/mcp", { method: "GET", headers: { accept: "text/event-stream" } })); expect([405, 400, 406]).toContain(res.status); });
});
