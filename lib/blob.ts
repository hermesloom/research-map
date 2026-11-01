import { put } from "@vercel/blob";
/** Upload a public, immutable-by-convention file. Callers choose unique pathnames (hash or timestamp) so CDN caching is safe. */
export async function putPublic(pathname: string, body: Buffer | string, contentType: string): Promise<string> {
  const r = await put(pathname, body, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: 31536000 });
  return r.url;
}
