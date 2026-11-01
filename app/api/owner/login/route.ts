import { connection } from "next/server";
import { ownerCookieValue } from "@/lib/ownerAuth";
export async function POST(request: Request) {
  await connection();
  const { secret } = (await request.json().catch(() => ({}))) as { secret?: unknown }; const real = process.env.OWNER_SECRET;
  if (!real || typeof secret !== "string" || secret !== real) return new Response("unauthorized", { status: 401 });
  return new Response("ok", { status: 200, headers: { "Set-Cookie": `rm_owner=${ownerCookieValue(real)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` } });
}
