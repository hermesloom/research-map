"use client";
import { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { OrthographicView, type OrthographicViewState } from "@deck.gl/core";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { CollisionFilterExtension, type CollisionFilterExtensionProps } from "@deck.gl/extensions";
import type { ViewportState } from "embedding-atlas/react";
import type { Snapshot } from "./useSnapshot";
import { categoryColors } from "./colors";
import { initialViewState, toViewState, toViewport } from "./fallbackView";
import type { LensLabel } from "./lenses";

const RGBA = categoryColors().map((c) => { const m = c.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/)!; return [+m[1], +m[2], +m[3], Math.round(+m[4] * 255)] as [number, number, number, number]; });
type LabelRow = LensLabel;

/** WebGL2 fallback (deck.gl): points + collision-filtered hierarchical labels. No density mode, no DOM cards; the inspector still works via click. */
export default function CanvasFallback({ data, labels, snap, viewport, onViewport, onPick }: {
  data: { x: Float32Array; y: Float32Array; category: Uint8Array; idx: number[] }; labels: LabelRow[]; snap: Snapshot;
  viewport: ViewportState | null; onViewport: (v: ViewportState) => void; onPick: (row: number) => void;
}) {
  const points = useMemo(() => Array.from(data.idx, (_, r) => r), [data]);
  const textLabels = useMemo(() => labels.filter((l) => typeof l.content === "string" && l.level <= 1), [labels]);
  const fitted = useMemo(() => initialViewState(data.x, data.y, 600), [data]);
  const viewState: OrthographicViewState = viewport ? toViewState(viewport) : fitted;
  const layers = [
    new ScatterplotLayer<number>({ id: "points", data: points, getPosition: (r) => [data.x[r], data.y[r]], getFillColor: (r) => RGBA[data.category[r]], radiusUnits: "pixels", getRadius: 3.5, pickable: true, onClick: (info) => { if (info.index >= 0) onPick(info.index); } }),
    new TextLayer<LabelRow, CollisionFilterExtensionProps<LabelRow>>({ id: "labels", data: textLabels, getPosition: (l) => [l.x, l.y], getText: (l) => l.content as string, getSize: (l) => (l.level === 0 ? 20 : 13), getColor: [230, 230, 230, 230], outlineColor: [11, 13, 16, 220], outlineWidth: 2, fontSettings: { sdf: true }, sizeUnits: "pixels", sizeMinPixels: 12, sizeMaxPixels: 36,
      extensions: [new CollisionFilterExtension()], collisionEnabled: true, getCollisionPriority: (l) => l.priority, collisionTestProps: { sizeScale: 1.5 } }),
  ];
  return (
    <DeckGL views={new OrthographicView({ id: "ortho", flipY: false })} viewState={viewState} controller={true}
      onViewStateChange={({ viewState: v }) => { const vs = v as OrthographicViewState; const t = vs.target as number[]; onViewport(toViewport({ target: [t[0], t[1], 0], zoom: vs.zoom as number })); }}
      layers={layers} style={{ position: "absolute", inset: "0", background: "#0b0d10" }} getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")} />
  );
}
