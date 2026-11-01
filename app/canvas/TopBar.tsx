"use client";
import { useState } from "react";
import type { Snapshot } from "./useSnapshot";
import type { UrlState } from "./urlState";
import { LENSES, type LensId } from "./lenses";

const CORE = "How can we make the structures through which humans coordinate their lives explicit, understandable, interoperable, and changeable, without requiring everyone to agree on one universal representation of reality?";

export default function TopBar({ url, setUrl, snap, onFlyTo }: { url: UrlState; setUrl: (f: (u: UrlState) => UrlState) => void; snap: Snapshot; onFlyTo: (i: number) => void }) {
  const [q, setQ] = useState(url.q ?? ""); const [results, setResults] = useState<{ xId: string; score: number }[] | null>(null); const [about, setAbout] = useState(false); const [busy, setBusy] = useState(false);
  const lens = LENSES.find((l) => l.id === url.lens)!;
  const search = async () => {
    const term = q.trim(); if (!term) { setResults(null); setUrl((u) => ({ ...u, q: undefined })); return; }
    setBusy(true);
    try {
      const res: { xId: string; score: number }[] = await (await fetch(`/api/search?q=${encodeURIComponent(term)}`)).json();
      setResults(res); setUrl((u) => ({ ...u, q: term }));
      const top = res.find((r) => snap.points.ids.includes(r.xId)); if (top) onFlyTo(snap.points.ids.indexOf(top.xId));
    } finally { setBusy(false); }
  };
  return (
    <div className="topbar" role="toolbar" aria-label="Map controls">
      <div className="row">
        <strong className="brand">research.nalenz.org</strong>
        <label className="ctl">Lens
          <select aria-label="Lens" value={url.lens} onChange={(e) => setUrl((u) => ({ ...u, lens: e.target.value as LensId }))}>
            {LENSES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <form className="ctl search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <input type="search" role="searchbox" aria-label="Search posts" placeholder="Search by meaning…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" disabled={busy}>{busy ? "…" : "Go"}</button>
        </form>
        <label className="ctl">Relevance ≥ {url.minGrade}
          <input type="range" min={0} max={3} step={1} value={url.minGrade} aria-label="Minimum relevance grade" onChange={(e) => setUrl((u) => ({ ...u, minGrade: Number(e.target.value) }))} />
        </label>
        <label className="ctl"><input type="checkbox" checked={url.showAll} onChange={(e) => setUrl((u) => ({ ...u, showAll: e.target.checked }))} /> show everything</label>
        <button className="link" onClick={() => setAbout((a) => !a)} aria-expanded={about}>What is this?</button>
      </div>
      <div className="purpose"><em>{lens.purpose}</em> <span className="dim">keeps: {lens.preserves.join(", ")} · drops: {lens.drops.join(", ")}</span></div>
      {results && (
        <ul className="results" aria-label="Search results">
          {results.slice(0, 10).map((r) => { const i = snap.points.ids.indexOf(r.xId); if (i < 0) return null; return (
            <li key={r.xId}><button className="link" onClick={() => { onFlyTo(i); setUrl((u) => ({ ...u, sel: r.xId })); }}>{snap.meta?.title[i] ?? r.xId}</button> <span className="dim">{r.score.toFixed(2)}</span></li>
          ); })}
          <li><button className="link" onClick={() => { setResults(null); setQ(""); setUrl((u) => ({ ...u, q: undefined })); }}>clear</button></li>
        </ul>
      )}
      {about && (
        <div className="about">
          <p>Every post of <a href="https://x.com/sigalor" target="_blank" rel="noopener">@sigalor</a>, placed automatically around one research question:</p>
          <blockquote>{CORE}</blockquote>
          <p className="dim">Posts keep one identity across lenses. Colour = topic, intensity = graded relevance to the question. Source and design: <a href="https://github.com/hermesloom/research-map" target="_blank" rel="noopener">hermesloom/research-map</a>.</p>
        </div>
      )}
    </div>
  );
}
