/** Loader for X's embed widget (platform.twitter.com/widgets.js). Free, no X API request: the widget fetches the public post itself. */
export type Twttr = { widgets: { createTweet: (id: string, el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLElement | null> } };
export type ScriptLike = { onload?: ((this: unknown, ev?: unknown) => unknown) | null; onerror?: ((this: unknown, ev?: unknown) => unknown) | null };
export type WidgetsHost = { win: { twttr?: Twttr }; appendScript: (src: string) => ScriptLike };

const SRC = "https://platform.twitter.com/widgets.js";
const pending = new WeakMap<object, Promise<Twttr>>();

export function loadWidgets(host: WidgetsHost = browserHost()): Promise<Twttr> {
  if (host.win.twttr?.widgets) return Promise.resolve(host.win.twttr);
  const existing = pending.get(host.win); if (existing) return existing;
  const p = new Promise<Twttr>((resolve, reject) => {
    const s = host.appendScript(SRC);
    s.onload = () => { const t = host.win.twttr; if (t?.widgets) resolve(t); else reject(new Error("widgets.js loaded without twttr")); };
    s.onerror = () => reject(new Error("widgets.js failed to load"));
  });
  pending.set(host.win, p); return p;
}

function browserHost(): WidgetsHost {
  return {
    win: window as unknown as { twttr?: Twttr },
    appendScript(src) { const s = document.createElement("script"); s.src = src; s.async = true; s.charset = "utf-8"; document.head.appendChild(s); return s as unknown as ScriptLike; },
  };
}
