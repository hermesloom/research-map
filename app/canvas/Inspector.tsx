"use client";
import { useEffect, useState } from "react";
import type { Snapshot } from "./useSnapshot";
import type { MetaFile } from "@/lib/snapshot";
import { toJsonCanvas } from "./export";
import OwnerControls from "./OwnerControls";

export default function Inspector({ snap, xId, onClose, loadMeta }: { snap: Snapshot; xId: string; onClose: () => void; loadMeta: () => Promise<MetaFile> }) {
  const [meta, setMeta] = useState<MetaFile | null>(snap.meta);
  useEffect(() => { let on = true; loadMeta().then((m) => { if (on) setMeta(m); }).catch(() => {}); return () => { on = false; }; }, [loadMeta, xId]);
  const i = snap.points.ids.indexOf(xId); if (i < 0) return null;
  const p = snap.points; const leaf = p.leaves.find((l) => l.id === p.leaf[i]); const theme = p.themes.find((t) => t.id === p.theme[i]);
  const qText = (id: string) => snap.labels.questions.find((q) => q.id === id)?.text ?? id;
  const date = new Date(p.createdAt[i] * 1000).toISOString().slice(0, 10); const xUrl = `https://x.com/sigalor/status/${xId}`;
  const exportCanvas = () => { if (!meta) return; const blob = new Blob([JSON.stringify(toJsonCanvas(p, meta), null, 1)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "research-map.canvas"; a.click(); URL.revokeObjectURL(a.href); };
  return (
    <aside className="inspector" aria-label="Post details">
      <button className="link close" onClick={onClose} aria-label="Close">×</button>
      {meta ? (<>
        <h2>{meta.title[i]}</h2>
        <p className="gist">{meta.gist[i]}</p>
        {meta.url[i] && <p><a href={meta.url[i]!} target="_blank" rel="noopener">{meta.domain[i]}</a></p>}
        {meta.thumb[i] && <img src={meta.thumb[i]!} alt="" style={{ maxWidth: "100%", borderRadius: 6 }} />}
        <dl>
          <dt>Where it lives</dt><dd>{theme?.label ?? "—"} › {leaf?.label ?? "unclustered"}{p.provisional[i] ? " (provisional)" : ""}</dd>
          <dt>Relation to the question</dt><dd>grade {p.grade[i]} · {meta.role[i]}{meta.rationale[i] && <><br /><span className="dim">{meta.rationale[i]}</span></>}</dd>
          {meta.subQuestions[i].length > 0 && <><dt>Sub-questions</dt><dd>{meta.subQuestions[i].map((q) => <div key={q}>{qText(q)}</div>)}</dd></>}
          {meta.tags[i].length > 0 && <><dt>Tags</dt><dd>{meta.tags[i].join(", ")}</dd></>}
          <dt>Kind · language</dt><dd>{p.kinds[p.kind[i]]} · {meta.lang[i]}</dd>
        </dl>
        <p className="x">Julian · @sigalor · <a href={xUrl} target="_blank" rel="noopener">{date}</a></p>
        <p className="small"><a href="https://github.com/hermesloom/research-map/edit/main/data/label-overrides.json" target="_blank" rel="noopener">Suggest a better label</a> · <button className="link" onClick={exportCanvas}>Export JSON Canvas</button></p>
        <OwnerControls snap={snap} xId={xId} />
      </>) : <p>Loading…</p>}
    </aside>
  );
}
