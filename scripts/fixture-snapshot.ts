/** Dev-only: build a fake snapshot from the test fixture so the canvas can be developed without MongoDB/Blob.
 *  Writes public/dev/{manifest,points,meta,labels}.json; run `NEXT_PUBLIC_DEV_MANIFEST=/dev/manifest.json pnpm dev`. */
import fs from "node:fs";
import { parseTimeline } from "@/lib/x/parse";
import { buildSnapshot } from "@/lib/snapshot";
import type { Layout, Enrichment, Relation, Question } from "@/lib/types";

const payload = JSON.parse(fs.readFileSync("tests/fixtures/timeline-sample.json", "utf8"));
const items = parseTimeline(payload, "1852658982608846848", "2115703316281778260").filter((i) => !["replyToOther", "retweet"].includes(i.kind));
// Replicate each item N times with jitter so the map has enough points to look like a map.
const N = 40; const rng = (s: number) => () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; const rnd = rng(7);
const all = items.flatMap((it, k) => Array.from({ length: N }, (_, j) => ({ ...it, xId: j === 0 ? it.xId : `${it.xId}${j}`, createdAt: new Date(it.createdAt.getTime() - j * 86400_000 * 3), isResearchQuestion: j === 0 && it.isResearchQuestion, _k: k })));
const clusters = Array.from({ length: 6 }, (_, i) => ({ id: i, label: ["Formal Foundations", "Standards & Ontologies", "Law as Code", "Local-first Systems", "Consent & Autonomy", "Audit & Trust"][i], themeId: i < 3 ? 0 : 1, size: 0, x: Math.cos((i / 6) * 2 * Math.PI) * 10, y: Math.sin((i / 6) * 2 * Math.PI) * 10 }));
const points = all.map((it, idx) => { const c = clusters[it._k % 6]; c.size++; const r = Math.sqrt(rnd()) * 3.5, a = rnd() * 2 * Math.PI; return { xId: it.xId, x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), clusterId: idx % 11 === 0 ? -1 : c.id, provisional: idx % 17 === 0 }; });
const layout: Layout = { version: 1, createdAt: new Date(), method: "fixture", status: "published", points, labels: [], themes: [{ id: 0, label: "Making structures explicit", clusterIds: [0, 1, 2] }, { id: 1, label: "Changing structures legitimately", clusterIds: [3, 4, 5] }], clusters, hulls: [], procrustesResidual: null };
const enrichment = new Map<string, Enrichment>(all.map((it) => [it.xId, { xId: it.xId, source: "none", thin: false, needsContent: false, fetchedAt: new Date(), normalized: { title: (it.text.replace(/https?:\/\/\S+/g, "").trim() || it.urls[0]?.title || it.urls[0]?.domain || "Post").slice(0, 60), summaryEn: it.text.slice(0, 200), gist: it.text.slice(0, 280), tagsEn: ["fixture"], language: it.lang === "de" ? "de" : "en", entities: [], contentKind: "thought" } }]));
const questions: Question[] = [{ _id: "core", text: "Core question", parentId: null, validFrom: new Date(), validTo: null, origin: "seed" }, ...["explicit", "understandable", "interoperable", "changeable", "plural", "trusted"].map((t, i) => ({ _id: `seed-${i + 1}`, text: `How can structures be ${t}?`, parentId: "core", validFrom: new Date(), validTo: null, origin: "seed" as const }))];
const relations = new Map<string, Relation[]>(all.map((it, idx) => [it.xId, [{ xId: it.xId, questionId: "core", role: ["evidence", "example", "tool", "tangent"][idx % 4] as Relation["role"], grade: [3, 2, 2, 1, 0][idx % 5], rationale: "fixture rationale", cosine: 0.2, modelVersion: "fixture", disagreement: false }, { xId: it.xId, questionId: `seed-${(idx % 6) + 1}`, role: "example", grade: 2, rationale: "", cosine: 0.2, modelVersion: "fixture", disagreement: false }]]));
const snap = buildSnapshot({ layout, items: all, enrichment, relations, questions, overrides: [], generatedAt: new Date() });
fs.mkdirSync("public/dev", { recursive: true });
fs.writeFileSync("public/dev/points.json", JSON.stringify(snap.points)); fs.writeFileSync("public/dev/meta.json", JSON.stringify(snap.meta)); fs.writeFileSync("public/dev/labels.json", JSON.stringify(snap.labels));
fs.writeFileSync("public/dev/manifest.json", JSON.stringify({ _id: "current", layoutVersion: 1, pointsUrl: "/dev/points.json", metaUrl: "/dev/meta.json", labelsUrl: "/dev/labels.json", generatedAt: new Date(), count: snap.points.count, embeddingModel: "fixture" }));
console.log(`dev snapshot: ${snap.points.count} points, ${snap.labels.labels.length} labels`);
