import { loadEnv } from "@/lib/env";

async function main() {
  const e = loadEnv();
  if (!e.GITHUB_DISPATCH_TOKEN) throw new Error("GITHUB_DISPATCH_TOKEN missing");
  const res = await fetch(`https://api.github.com/repos/${e.GITHUB_REPO}/dispatches`, {
    method: "POST", headers: { Authorization: `Bearer ${e.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "research-map" },
    body: JSON.stringify({ event_type: "relayout" }),
  });
  console.log(res.status === 204 ? "batch relayout dispatched" : `dispatch failed: ${res.status} ${await res.text()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
