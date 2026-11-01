/// <reference lib="webworker" />
import { buildTerrain, transferables } from "./build";
import type { TerrainInput } from "./types";
/** Message protocol: { id, input } → { id, mesh } (buffers transferred) or { id, error }. */
self.onmessage = (e: MessageEvent<{ id: number; input: TerrainInput }>) => {
  const { id, input } = e.data;
  try { const mesh = buildTerrain(input); (self as unknown as Worker).postMessage({ id, mesh }, transferables(mesh)); }
  catch (err) { (self as unknown as Worker).postMessage({ id, error: String(err) }); }
};
