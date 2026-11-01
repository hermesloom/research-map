"use client";
import { useMemo, useState } from "react";
import type { Snapshot } from "./useSnapshot";
import type { UrlState } from "./urlState";
import type { MetaFile } from "@/lib/snapshot";
import { monthBins, gradeBins } from "./histogram";

export type FilterState = { kinds?: Set<number>; langs?: Set<string>; monthRange?: [number, number] };

export default function Filters({ snap, filters, setFilters, loadMeta }: { snap: Snapshot; filters: FilterState; setFilters: (f: FilterState) => void; url: UrlState; setUrl: (f: (u: UrlState) => UrlState) => void; loadMeta: () => Promise<MetaFile> }) {
  const [open, setOpen] = useState(false); const [drag, setDrag] = useState<number | null>(null);
  const bins = useMemo(() => monthBins(snap.points.createdAt), [snap]); const grades = useMemo(() => gradeBins(snap.points.grade), [snap]);
  const maxLog = Math.max(...bins.map((b) => Math.log1p(b.count)), 1);
  const langs = useMemo(() => snap.meta ? [...new Set(snap.meta.lang)].sort() : [], [snap.meta]);
  const toggle = (set: Set<number> | undefined, v: number, all: number[]) => { const s = new Set(set ?? all); if (s.has(v)) s.delete(v); else s.add(v); return s.size === all.length ? undefined : s; };
  const selectRange = (a: number, b: number) => { const lo = Math.min(a, b), hi = Math.max(a, b); setFilters({ ...filters, monthRange: lo === 0 && hi === bins.length - 1 ? undefined : [bins[lo].start, bins[hi].end] }); };
  const inRange = (b: { start: number; end: number }) => !filters.monthRange || (b.end >= filters.monthRange[0] && b.start <= filters.monthRange[1]);
  return (
    <div className={`filters ${open ? "open" : ""}`}>
      <button className="link toggle" onClick={() => { setOpen((o) => !o); if (!snap.meta) void loadMeta(); }} aria-expanded={open}>{open ? "hide filters" : "filters & timeline"}</button>
      {open && (
        <div className="panel">
          <div className="hist" role="group" aria-label="Posts per month (drag to filter)">
            {bins.map((b, i) => (
              <div key={b.key} className={`bar ${inRange(b) ? "" : "off"}`} title={`${b.label}: ${b.count}`} style={{ height: `${(Math.log1p(b.count) / maxLog) * 100}%` }}
                onMouseDown={() => setDrag(i)} onMouseEnter={() => drag !== null && selectRange(drag, i)} onMouseUp={() => { if (drag !== null) selectRange(drag, i); setDrag(null); }} />
            ))}
          </div>
          <div className="row dim small">{bins[0]?.label} → {bins[bins.length - 1]?.label}{filters.monthRange && <button className="link" onClick={() => setFilters({ ...filters, monthRange: undefined })}>reset months</button>}</div>
          <div className="row small">grades: {grades.map((n, g) => <span key={g} className="dim">g{g}: {n}</span>)}</div>
          <div className="row small">kind: {snap.points.kinds.slice(0, 5).map((k, i) => (
            <label key={k}><input type="checkbox" checked={!filters.kinds || filters.kinds.has(i)} onChange={() => setFilters({ ...filters, kinds: toggle(filters.kinds, i, [0, 1, 2, 3, 4]) })} /> {k}</label>
          ))}</div>
          {langs.length > 0 && <div className="row small">language: {langs.map((l) => (
            <label key={l}><input type="checkbox" checked={!filters.langs || filters.langs.has(l)} onChange={() => { const s = new Set(filters.langs ?? langs); if (s.has(l)) s.delete(l); else s.add(l); setFilters({ ...filters, langs: s.size === langs.length ? undefined : s }); }} /> {l}</label>
          ))}</div>}
        </div>
      )}
    </div>
  );
}
