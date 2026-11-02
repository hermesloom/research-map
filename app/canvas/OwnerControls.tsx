"use client";
import { useEffect, useState } from "react";
import type { Snapshot } from "./useSnapshot";
import { doubleShift } from "./shortcuts";

/** Appears inside the inspector for the owner only. Login via Shift+O twice (keeps the public UI clean). */
export default function OwnerControls({ snap, xId }: { snap: Snapshot; xId: string }) {
  const [owner, setOwner] = useState(false); const [login, setLogin] = useState(false); const [secret, setSecret] = useState(""); const [msg, setMsg] = useState("");
  useEffect(() => { fetch("/api/owner/override").then((r) => r.json()).then((j) => setOwner(!!j.owner)).catch(() => {}); }, []);
  useEffect(() => {
    const onKey = doubleShift("o", () => setLogin(true));
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const i = snap.points.ids.indexOf(xId);
  const post = async (body: Record<string, unknown>) => {
    setMsg("saving…"); const r = await fetch("/api/owner/override", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setMsg(r.ok ? "saved — republished; reload to see it" : `failed: ${r.status}`);
  };
  if (!owner && !login) return null;
  if (!owner) return (
    <form className="owner" onSubmit={async (e) => { e.preventDefault(); const r = await fetch("/api/owner/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret }) }); if (r.ok) { setOwner(true); setLogin(false); } else setMsg("wrong secret"); }}>
      <input type="password" placeholder="owner secret" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="Owner secret" /> <button type="submit">Log in</button> <span className="dim">{msg}</span>
    </form>
  );
  return (
    <div className="owner">
      <div className="dim small">Owner tools</div>
      <div className="row small">
        <button onClick={() => post({ type: "pin", xId, payload: { x: snap.points.x[i], y: snap.points.y[i] } })}>Pin here</button>
        <button onClick={() => { const label = prompt("New label for this leaf topic"); if (label) post({ type: "renameLabel", clusterId: snap.points.leaf[i], payload: { label } }); }} disabled={snap.points.leaf[i] < 0}>Rename leaf</button>
        <select aria-label="Move to leaf" defaultValue="" onChange={(e) => { if (e.target.value !== "") post({ type: "moveLeaf", xId, payload: { clusterId: Number(e.target.value) } }); }}>
          <option value="">Move to leaf…</option>{snap.points.leaves.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <select aria-label="Retire sub-question" defaultValue="" onChange={(e) => { if (e.target.value && confirm("Retire this sub-question?")) post({ type: "retireQuestion", questionId: e.target.value, payload: {} }); }}>
          <option value="">Retire sub-question…</option>{snap.labels.questions.filter((q) => q.parentId).map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}
        </select>
      </div>
      <div className="row small"><button onClick={async () => { setMsg("undoing…"); const r = await fetch("/api/owner/override", { method: "DELETE" }); const j = r.ok ? await r.json() : null; setMsg(j?.undone ? `undid ${j.undone} — republished; reload to see it` : r.ok ? "nothing to undo" : `failed: ${r.status}`); }}>Undo last override</button></div>
      <div className="dim small">{msg}</div>
    </div>
  );
}
