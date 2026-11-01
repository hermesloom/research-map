import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("next/server", () => ({ connection: async () => {} }));
beforeEach(() => { process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k"; process.env.OWNER_SECRET = "owner-pw"; vi.resetModules(); });
describe("owner auth", () => {
  it("login sets cookie only for the right secret", async () => {
    const { POST } = await import("@/app/api/owner/login/route");
    expect((await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ secret: "nope" }) }))).status).toBe(401);
    const ok = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ secret: "owner-pw" }) })); expect(ok.status).toBe(200); expect(ok.headers.get("set-cookie")).toMatch(/rm_owner=.*HttpOnly/);
  });
  it("override route rejects non-owners and invalid bodies", async () => {
    vi.doMock("@/lib/db", () => ({ getDb: async () => ({}), collections: () => ({ overrides: { insertOne: async () => ({}) }, questions: { updateOne: async () => ({}) } }) })); vi.doMock("@/lib/publish", () => ({ publishSnapshot: async () => ({ count: 1 }) }));
    const { POST } = await import("@/app/api/owner/override/route"); const { ownerCookieValue } = await import("@/lib/ownerAuth");
    expect((await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ type: "pin", xId: "1", payload: { x: 1, y: 2 } }) }))).status).toBe(401);
    const cookie = `rm_owner=${ownerCookieValue("owner-pw")}`;
    expect((await POST(new Request("http://x", { method: "POST", headers: { cookie }, body: JSON.stringify({ type: "explode" }) }))).status).toBe(400);
    expect((await POST(new Request("http://x", { method: "POST", headers: { cookie }, body: JSON.stringify({ type: "pin", xId: "1", payload: { x: 1, y: 2 } }) }))).status).toBe(200);
  });
});

describe("override payload validation and undo", () => {
  it("rejects a pin without numeric x/y and a rename without a label; accepts valid ones", async () => {
    const inserted: any[] = [];
    vi.doMock("@/lib/db", () => ({ getDb: async () => ({}), collections: () => ({ overrides: { insertOne: async (d: any) => { inserted.push(d); return { insertedId: "oid" }; }, find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => inserted.slice(-1) }) }) }), deleteOne: async () => ({ deletedCount: 1 }) }, questions: { updateOne: async () => ({}) } }) }));
    vi.doMock("@/lib/publish", () => ({ publishSnapshot: async () => ({ count: 1 }) }));
    const { POST, DELETE } = await import("@/app/api/owner/override/route"); const { ownerCookieValue } = await import("@/lib/ownerAuth");
    const cookie = `rm_owner=${ownerCookieValue("owner-pw")}`; const post = (b: unknown) => POST(new Request("http://x", { method: "POST", headers: { cookie }, body: JSON.stringify(b) }));
    expect((await post({ type: "pin", xId: "1", payload: { x: "abc", y: 2 } })).status).toBe(400);
    expect((await post({ type: "renameLabel", clusterId: 0, payload: {} })).status).toBe(400);
    expect((await post({ type: "moveLeaf", xId: "1", payload: { clusterId: 1.5 } })).status).toBe(400);
    expect((await post({ type: "pin", xId: "1", payload: { x: 1, y: 2 } })).status).toBe(200);
    expect((await DELETE(new Request("http://x", { method: "DELETE", headers: { cookie } }))).status).toBe(200);   // undo last
    expect((await DELETE(new Request("http://x", { method: "DELETE" }))).status).toBe(401);
  });
});
