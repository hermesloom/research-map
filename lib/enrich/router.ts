export type Host = "wikipedia" | "youtube" | "arxiv" | "github" | "doi" | "generic" | "xmedia";
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>?#]+)/i;

export function wikipediaTitle(url: string): { lang: string; title: string } | null {
  let u: URL; try { u = new URL(url); } catch { return null; }
  const m = u.hostname.match(/^([a-z]{2,3})\.(m\.)?wikipedia\.org$/);
  if (!m || !u.pathname.startsWith("/wiki/")) return null;
  const raw = u.pathname.slice("/wiki/".length);
  let title: string; try { title = decodeURIComponent(raw); } catch { title = raw; }
  return { lang: m[1], title };
}
export function youtubeId(url: string): string | null {
  let u: URL; try { u = new URL(url); } catch { return null; }
  if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  if (/(^|\.)youtube\.com$/.test(u.hostname)) {
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/); if (m) return m[2];
  }
  return null;
}
export function arxivId(url: string): string | null {
  const m = url.match(/arxiv\.org\/(?:abs|pdf|html)\/((?:[a-z-]+\/)?\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?/i);
  return m ? m[1] : null;
}
export function doiOf(url: string): string | null { const m = url.match(DOI_RE); return m ? m[1].replace(/\.(pdf|html)$/i, "") : null; }
export function githubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/); return m ? { owner: m[1], repo: m[2] } : null;
}
export function routeHost(url: string): Host {
  if (/^https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\/(photo|video)\//.test(url)) return "xmedia";
  if (wikipediaTitle(url)) return "wikipedia";
  if (youtubeId(url)) return "youtube";
  if (arxivId(url)) return "arxiv";
  if (githubRepo(url)) return "github";
  if (doiOf(url)) return "doi";
  return "generic";
}
