import { z } from "zod";
import type { Corpus } from "./corpus";

export const CACHE_SNAPSHOT = "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";
export const CACHE_SEARCH = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
export const CACHE_DOCS = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Accept, Content-Type" };

/** Public origin of this deployment, from proxy headers when present. */
export function baseUrl(request: Request): string {
  const u = new URL(request.url); const first = (h: string | null) => h?.split(",")[0].trim() || null;   // behind several proxies the header is comma-joined
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host")) ?? u.host;
  const proto = first(request.headers.get("x-forwarded-proto")) ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : u.protocol.replace(":", ""));
  return `${proto}://${host}`;
}
export const docsUrl = (request: Request) => `${baseUrl(request)}/api/v1`;

/** `?format` wins; otherwise Markdown when the Accept header prefers text/markdown over application/json by q-value (ties go to the one listed first). */
export function wantsMarkdown(request: Request, format?: string): boolean {
  if (format === "md") return true; if (format === "json") return false;
  const q: Record<string, [number, number]> = {};
  (request.headers.get("accept") ?? "").split(",").forEach((part, i) => { const [type, ...params] = part.trim().toLowerCase().split(";"); const qv = params.map((x) => x.trim()).find((x) => x.startsWith("q=")); const n = qv ? Number(qv.slice(2)) : 1; if (!q[type] && Number.isFinite(n)) q[type] = [n, i]; });
  const md = q["text/markdown"], js = q["application/json"]; if (!md || md[0] === 0) return false; if (!js) return true;
  return md[0] > js[0] || (md[0] === js[0] && md[1] < js[1]);
}
export function respond(request: Request, body: { json: unknown; markdown?: string; format?: string }, init: { status?: number; cache?: string } = {}): Response {
  const headers: Record<string, string> = { ...CORS, "Cache-Control": init.cache ?? CACHE_SNAPSHOT, Vary: "Accept" };
  if (body.markdown !== undefined && wantsMarkdown(request, body.format)) return new Response(body.markdown, { status: init.status ?? 200, headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8" } });
  return new Response(JSON.stringify(body.json), { status: init.status ?? 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}
export function text(body: string, cache = CACHE_DOCS, type = "text/plain; charset=utf-8"): Response { return new Response(body, { headers: { ...CORS, "Cache-Control": cache, "Content-Type": type } }); }

export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public hint: string) { super(message); } }
export function fail(request: Request, e: ApiError): Response {
  return new Response(JSON.stringify({ error: { code: e.code, message: e.message, hint: e.hint, docs: docsUrl(request) } }), { status: e.status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
export const notFound = (what: string, id: string, list: string) => new ApiError(404, "not_found", `No ${what} with id ${JSON.stringify(id)}.`, `List valid ids at ${list}.`);

/** Parse the query string with a zod schema. Unknown parameters are a 400 (a typo must never silently return the unfiltered corpus); an empty value counts as absent; a failure's hint names each bad parameter. */
export function parseQuery<S extends z.ZodObject>(request: Request, schema: S): z.infer<S> {
  const known = Object.keys(schema.shape); const raw: Record<string, string> = {}; const unknown: string[] = [];
  for (const [k, v] of new URL(request.url).searchParams) { if (!known.includes(k)) { if (!unknown.includes(k)) unknown.push(k); continue; } if (v.trim() === "" || k in raw) continue; raw[k] = v; }
  if (unknown.length) throw new ApiError(400, "bad_request", `Unknown query parameter${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`, `Known parameters here: ${known.join(", ")}. Parameter docs: /api/v1 or /api/v1/openapi.json.`);
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, "bad_request", "Invalid query parameter" + (r.error.issues.length > 1 ? "s." : "."), r.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; ") + ". Parameter docs: /api/v1 or /api/v1/openapi.json.");
  return r.data;
}
/** Path id: trimmed, never empty; integer ids must look like integers (so " " or "1e1" cannot coerce to a valid id). */
export function parseParam<S extends z.ZodObject>(params: Record<string, string>, schema: S, hint: string, kind: "int" | "string" = "string"): z.infer<S> {
  const id = params.id?.trim() ?? "";
  if (!id || (kind === "int" && !/^-?\d+$/.test(id))) throw new ApiError(400, "bad_request", `Invalid id ${JSON.stringify(params.id)}.`, hint);
  const r = schema.safeParse({ ...params, id }); if (!r.success) throw new ApiError(400, "bad_request", `Invalid id ${JSON.stringify(params.id)}.`, hint); return r.data;
}
/** Route wrapper: ApiError → its status, anything else → 500 with a stable shape; a missing snapshot → 503. */
export async function handle(request: Request, fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); } catch (e) {
    if (e instanceof ApiError) return fail(request, e);
    if (e instanceof Error && e.name === "NoSnapshotError") return fail(request, new ApiError(503, "no_snapshot", "No published snapshot yet.", "The daily pipeline has not published a layout. Try again later or check /api/status."));
    console.error(e); return fail(request, new ApiError(500, "internal", "Unexpected error.", "Retry; if it persists, open an issue at https://github.com/hermesloom/research-map."));
  }
}
export const OPTIONS = async () => new Response(null, { status: 204, headers: CORS });

/** Build the next-page URL by replacing `offset` on the current request. */
export function nextUrl(request: Request, nextOffset: number | null): string | null {
  if (nextOffset === null) return null; const u = new URL(request.url); u.searchParams.set("offset", String(nextOffset)); return `${baseUrl(request)}${u.pathname}${u.search}`;
}
export function envelope<T>(c: Corpus, data: T, page?: { limit: number; offset: number; total: number; next: string | null }) {
  return page ? { data, page, snapshot: c.snapshot } : { data, snapshot: c.snapshot };
}
