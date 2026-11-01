import { describe, it, expect } from "vitest";
import { routeHost, wikipediaTitle, arxivId, doiOf, youtubeId, githubRepo } from "@/lib/enrich/router";

describe("routeHost", () => {
  it.each([
    ["https://en.wikipedia.org/wiki/Yoneda_lemma", "wikipedia"],
    ["https://de.wikipedia.org/wiki/Pfadabh%C3%A4ngigkeit", "wikipedia"],
    ["https://www.youtube.com/watch?v=tETbivwzXBM", "youtube"],
    ["https://youtu.be/j9ZkpMdG1hg", "youtube"],
    ["https://arxiv.org/pdf/2103.03198", "arxiv"],
    ["https://arxiv.org/html/2607.26300", "arxiv"],
    ["https://github.com/CategoricalData/hydra", "github"],
    ["https://doi.org/10.1145/3158140", "doi"],
    ["https://dl.acm.org/doi/10.1145/3158140", "doi"],
    ["https://xtdb.com/", "generic"],
    ["https://x.com/sigalor/status/2116647051207291080/photo/1", "xmedia"],
  ])("%s → %s", (url, host) => expect(routeHost(url)).toBe(host));
});

describe("wikipedia title extraction handles encoding and fragments", () => {
  it("decodes and strips fragments", () => {
    expect(wikipediaTitle("https://de.wikipedia.org/wiki/Christian_Wolff_%28Aufkl%C3%A4rer%29")).toEqual({ lang: "de", title: "Christian_Wolff_(Aufklärer)" });
    expect(wikipediaTitle("https://en.wikipedia.org/wiki/Robert_Kegan#The_Evolving_Self")).toEqual({ lang: "en", title: "Robert_Kegan" });
    expect(wikipediaTitle("https://en.wiktionary.org/wiki/sympoiesis")).toBeNull();
  });
});

describe("id extractors", () => {
  it("arxiv", () => { expect(arxivId("https://arxiv.org/pdf/1711.07059v2")).toBe("1711.07059"); expect(arxivId("https://arxiv.org/abs/math/0305282")).toBe("math/0305282"); });
  it("doi", () => { expect(doiOf("https://dl.acm.org/doi/pdf/10.1145/3144555.3144560")).toBe("10.1145/3144555.3144560"); expect(doiOf("https://xtdb.com/")).toBeNull(); });
  it("youtube", () => { expect(youtubeId("https://www.youtube.com/watch?si=abc&v=e88CdSBBY-k&feature=youtu.be")).toBe("e88CdSBBY-k"); expect(youtubeId("https://youtu.be/j9ZkpMdG1hg")).toBe("j9ZkpMdG1hg"); expect(youtubeId("https://www.youtube.com/@Henophilia/videos")).toBeNull(); });
  it("github", () => { expect(githubRepo("https://github.com/eyereasoner/lingua")).toEqual({ owner: "eyereasoner", repo: "lingua" }); expect(githubRepo("https://github.com/euro-office")).toBeNull(); });
});
