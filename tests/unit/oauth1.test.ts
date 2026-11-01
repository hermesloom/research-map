import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { oauth1Header, percentEncode, signatureBaseString } from "@/lib/x/oauth1";
const v = JSON.parse(fs.readFileSync("tests/fixtures/x-oauth-vector.json", "utf8"));

describe("oauth1", () => {
  it("percent-encodes per RFC 3986 (space → %20, * → %2A, ~ kept)", () => {
    expect(percentEncode("Ladies + Gentlemen")).toBe("Ladies%20%2B%20Gentlemen");
    expect(percentEncode("a*b~c")).toBe("a%2Ab~c");
  });
  it("reproduces the documented signature", () => {
    const h = oauth1Header({ method: v.method, url: v.url, query: v.params, consumerKey: v.consumerKey, consumerSecret: v.consumerSecret,
      token: v.token, tokenSecret: v.tokenSecret, nonce: v.nonce, timestamp: v.timestamp });
    expect(h).toContain(`oauth_signature="${percentEncode(v.expectedSignature)}"`);
    expect(h.startsWith("OAuth ")).toBe(true);
  });
  it("base string has exactly two ampersands", () => {
    const b = signatureBaseString("GET", "https://api.x.com/2/users/1/tweets", { since_id: "5", oauth_nonce: "n" });
    expect(b.split("&").length).toBe(3);
  });
});
