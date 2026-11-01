import { timingSafeEqual } from "node:crypto";
import { sha256 } from "./hash";
export const ownerCookieValue = (secret: string) => sha256("owner:" + secret);
/** Owner session = HttpOnly cookie holding the hash of OWNER_SECRET; constant-time compare. */
export function isOwner(request: Request): boolean {
  const secret = process.env.OWNER_SECRET; if (!secret) return false;
  const m = (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)rm_owner=([a-f0-9]{64})/); if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(ownerCookieValue(secret)); return a.length === b.length && timingSafeEqual(a, b);
}
