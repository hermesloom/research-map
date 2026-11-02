import { describe, it, expect } from "vitest";
import { z } from "zod";
import { baseUrl, wantsMarkdown, respond, parseQuery, parseParam, ApiError, fail, handle, nextUrl, notFound } from "@/lib/api/http";
import { PostsQuerySchema, IntIdParamSchema, IdParamSchema } from "@/lib/api/schemas";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
describe("negotiation", () => {
  it("baseUrl honours forwarded headers", () => {
    expect(baseUrl(req("http://localhost:3000/api/v1"))).toBe("http://localhost:3000");
    expect(baseUrl(req("http://internal/api/v1", { "x-forwarded-host": "research.nalenz.org", "x-forwarded-proto": "https" }))).toBe("https://research.nalenz.org");
    expect(baseUrl(req("http://internal/api/v1", { "x-forwarded-host": "a.org, b.internal", "x-forwarded-proto": "https,http" }))).toBe("https://a.org");
  });
  it("markdown on Accept or ?format=md, json otherwise; format wins over Accept", () => {
    expect(wantsMarkdown(req("http://x/"), undefined)).toBe(false); expect(wantsMarkdown(req("http://x/", { accept: "text/markdown" }))).toBe(true);
    expect(wantsMarkdown(req("http://x/", { accept: "application/json, text/markdown" }))).toBe(false); expect(wantsMarkdown(req("http://x/"), "md")).toBe(true); expect(wantsMarkdown(req("http://x/", { accept: "text/markdown" }), "json")).toBe(false);
    expect(wantsMarkdown(req("http://x/", { accept: "application/json;q=0.5, text/markdown" }))).toBe(true); expect(wantsMarkdown(req("http://x/", { accept: "text/markdown;q=0.1, application/json" }))).toBe(false); expect(wantsMarkdown(req("http://x/", { accept: "text/markdown;q=0" }))).toBe(false); expect(wantsMarkdown(req("http://x/", { accept: "*/*" }))).toBe(false);
  });
  it("respond sets content type, cache, cors and vary", async () => {
    const r = respond(req("http://x/", { accept: "text/markdown" }), { json: { a: 1 }, markdown: "# hi" }); expect(await r.text()).toBe("# hi"); expect(r.headers.get("content-type")).toMatch(/text\/markdown/);
    const j = respond(req("http://x/"), { json: { a: 1 }, markdown: "# hi" }); expect(await j.json()).toEqual({ a: 1 }); expect(j.headers.get("access-control-allow-origin")).toBe("*"); expect(j.headers.get("cache-control")).toMatch(/s-maxage=300/); expect(j.headers.get("vary")).toBe("Accept");
  });
});
describe("parseQuery", () => {
  it("coerces and defaults", () => {
    const q = parseQuery(req("http://x/api/v1/posts?minGrade=2&limit=5&since=2026-09-01&sort=oldest"), PostsQuerySchema); expect(q).toMatchObject({ minGrade: 2, limit: 5, offset: 0, sort: "oldest", since: "2026-09-01" });
  });
  it("rejects with a hint naming each bad parameter", () => {
    try { parseQuery(req("http://x/api/v1/posts?limit=9999&minGrade=7&since=yesterday"), PostsQuerySchema); throw new Error("no"); } catch (e) {
      const a = e as ApiError; expect(a.status).toBe(400); expect(a.hint).toMatch(/limit:/); expect(a.hint).toMatch(/minGrade:/); expect(a.hint).toMatch(/since: must be an ISO 8601 date/); expect(a.hint).toMatch(/openapi\.json/);
    }
  });
  it("rejects unknown parameters with the list of known ones", () => {
    try { parseQuery(req("http://x/?min_grade=3&Theme=1"), PostsQuerySchema); throw new Error("no"); } catch (e) { const a = e as ApiError; expect(a.status).toBe(400); expect(a.message).toBe("Unknown query parameters: min_grade, Theme."); expect(a.hint).toMatch(/Known parameters here: theme, topic/); }
  });
  it("treats empty values as absent instead of coercing them to 0", () => { expect(parseQuery(req("http://x/?theme=&topic=%20&limit="), PostsQuerySchema)).toMatchObject({ limit: 50 }); expect("theme" in parseQuery(req("http://x/?theme="), PostsQuerySchema)).toBe(false); expect(parseQuery(req("http://x/?a="), z.object({ a: z.string().optional() }))).toEqual({}); });
  it("path ids: empty or non-integer ids are 400 for integer routes", () => {
    expect(() => parseParam({ id: " " }, IntIdParamSchema, "h", "int")).toThrow(ApiError); expect(() => parseParam({ id: "1e1" }, IntIdParamSchema, "h", "int")).toThrow(ApiError); expect(parseParam({ id: " 7 " }, IntIdParamSchema, "h", "int")).toEqual({ id: 7 });
    expect(() => parseParam({ id: "" }, IdParamSchema, "h")).toThrow(ApiError); expect(parseParam({ id: "core" }, IdParamSchema, "h")).toEqual({ id: "core" });
  });
});
describe("errors", () => {
  it("fail produces the error envelope with docs", async () => {
    const r = fail(req("http://h/api/v1/posts/x"), notFound("post", "x", "/api/v1/posts")); expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { code: "not_found", message: 'No post with id "x".', hint: "List valid ids at /api/v1/posts.", docs: "http://h/api/v1" } });
  });
  it("handle maps ApiError, NoSnapshotError and unknown errors", async () => {
    expect((await handle(req("http://h/"), async () => { throw new ApiError(400, "bad_request", "m", "h"); })).status).toBe(400);
    const e = new Error("none"); e.name = "NoSnapshotError"; const r = await handle(req("http://h/"), async () => { throw e; }); expect(r.status).toBe(503); expect((await r.json()).error.code).toBe("no_snapshot");
    const orig = console.error; console.error = () => {}; try { expect((await handle(req("http://h/"), async () => { throw new TypeError("boom"); })).status).toBe(500); } finally { console.error = orig; }
  });
  it("nextUrl rewrites offset and uses the public base", () => {
    expect(nextUrl(req("http://internal/api/v1/posts?limit=2&offset=0", { "x-forwarded-host": "r.org", "x-forwarded-proto": "https" }), 2)).toBe("https://r.org/api/v1/posts?limit=2&offset=2"); expect(nextUrl(req("http://x/"), null)).toBeNull();
  });
});
