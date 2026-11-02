/** Hidden chord: Shift+<key> pressed twice within `windowMs`. Returns a keydown handler. Shared by the owner login (O) and the manual ingest (I). */
export function doubleShift(key: string, fire: () => void, windowMs = 600, now: () => number = Date.now): (e: Pick<KeyboardEvent, "shiftKey" | "key">) => void {
  let last = 0;
  return (e) => { if (!e.shiftKey || e.key.toLowerCase() !== key) return; const t = now(); if (t - last < windowMs) { last = 0; fire(); } else last = t; };
}
