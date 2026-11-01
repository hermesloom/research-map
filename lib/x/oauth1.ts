import { createHmac, randomBytes } from "node:crypto";

export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
export function signatureBaseString(method: string, baseUrl: string, params: Record<string, string>): string {
  const pairs = Object.entries(params)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  return `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
}
export interface OAuth1Input { method: string; url: string; query: Record<string, string>; consumerKey: string; consumerSecret: string; token: string; tokenSecret: string; nonce?: string; timestamp?: string; }
export function oauth1Header(i: OAuth1Input): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: i.consumerKey,
    oauth_nonce: i.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: i.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: i.token,
    oauth_version: "1.0",
  };
  const base = signatureBaseString(i.method, i.url, { ...i.query, ...oauth });
  const key = `${percentEncode(i.consumerSecret)}&${percentEncode(i.tokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`).join(", ");
}
