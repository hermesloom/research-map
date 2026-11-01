"use client";
import { useEffect, useRef, useState } from "react";
import { loadWidgets } from "./tweetEmbed";

/** The original X post, embedded via X's widget. Falls back to a link if the widget is blocked or the post is gone. */
export default function TweetEmbed({ id, url }: { id: string; url: string }) {
  const ref = useRef<HTMLDivElement>(null); const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  useEffect(() => {
    let on = true; const host = ref.current; if (!host) return; setState("loading");
    const slot = document.createElement("div"); host.appendChild(slot);   // one container per effect run, so strict-mode double runs and id changes never leave a stale embed behind
    loadWidgets().then((t) => t.widgets.createTweet(id, slot, { theme: "dark", dnt: true, conversation: "none", align: "center", width: 340 }))
      .then((node) => { if (on) setState(node ? "ok" : "failed"); }).catch(() => { if (on) setState("failed"); });
    return () => { on = false; slot.remove(); };
  }, [id]);
  return (
    <div className="tweet">
      <div ref={ref} />
      {state === "loading" && <p className="dim small">Loading the original post…</p>}
      {state === "failed" && <p className="small">Could not embed the post. <a href={url} target="_blank" rel="noopener">Open it on X</a></p>}
    </div>
  );
}
