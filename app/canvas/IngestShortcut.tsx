"use client";
import { useEffect } from "react";
import { doubleShift } from "./shortcuts";
import { runIngest, FRESH_KEY } from "./ingest";

/** Press Shift+I twice: a plain prompt asks for CRON_SECRET, then the daily ingest runs right now and the page reloads with a fresh manifest. */
export default function IngestShortcut() {
  useEffect(() => {
    let busy = false;
    const onKey = doubleShift("i", async () => {
      if (busy) return; const secret = prompt("Cron secret — run the ingest now?"); if (!secret) return;
      busy = true; document.body.style.cursor = "progress";
      try {
        const r = await runIngest(secret); alert(r.message);
        if (r.ok) { try { sessionStorage.setItem(FRESH_KEY, "1"); } catch { /* ignore */ } location.reload(); }
      } finally { busy = false; document.body.style.cursor = ""; }
    });
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
