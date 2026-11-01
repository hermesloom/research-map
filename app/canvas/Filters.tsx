"use client";
import type { Snapshot } from "./useSnapshot"; import type { UrlState } from "./urlState"; import type { MetaFile } from "@/lib/snapshot";
export type FilterState = { kinds?: Set<number>; langs?: Set<string>; monthRange?: [number, number] };
export default function Filters(_p: { snap: Snapshot; filters: FilterState; setFilters: (f: FilterState) => void; url: UrlState; setUrl: (f: (u: UrlState) => UrlState) => void; loadMeta: () => Promise<MetaFile> }) { return null; }
