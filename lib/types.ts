import { z } from "zod";

export type Kind = "text" | "link" | "media" | "selfReply" | "quote" | "replyToOther" | "retweet";
export type Stage = "ingested" | "enriched" | "normalized" | "embedded" | "placed" | "graded";

export interface ItemUrl { url: string; expandedUrl: string; unwoundUrl?: string; title?: string; description?: string; domain: string; isMedia: boolean; }
export interface ItemMedia { mediaKey: string; type: "photo" | "video" | "animated_gif"; url?: string; previewUrl?: string; altText?: string; }
export interface Item {
  xId: string; text: string; createdAt: Date; kind: Kind; urls: ItemUrl[]; media: ItemMedia[]; parentId?: string; quotedId?: string; lang?: string;
  publicMetrics?: Record<string, number>; isResearchQuestion: boolean; stage: Stage; stageError?: string; deletedAt?: Date; fetchedAt: Date;
  /** Runs in which enrichment was deferred (Firecrawl quota or failure); after ENRICH_MAX_DEFERRALS the ladder gives up on Firecrawl. */
  enrichDeferrals?: number;
}

export type EnrichSource = "wikipedia" | "oembed" | "arxiv" | "openalex" | "github" | "firecrawl" | "wayback" | "thin" | "none";

export const NormalizedSchema = z.object({
  title: z.string().min(1).max(120),
  summaryEn: z.string().min(1).max(400),
  gist: z.string().min(1).max(600),
  tagsEn: z.array(z.string().min(1).max(40)).max(8),
  language: z.enum(["en", "de", "other"]),
  entities: z.array(z.string()).max(12),
  contentKind: z.enum(["thought", "link", "paper", "video", "code", "image", "music", "humor", "other"]),
});
export type Normalized = z.infer<typeof NormalizedSchema>;

export interface Enrichment {
  xId: string; source: EnrichSource; title?: string; excerpt?: string; ogImage?: string; transcript?: string; imageDescription?: string;
  thumbUrl?: string; originalMediaUrl?: string; thin: boolean; needsContent: boolean; normalized?: Normalized; fetchedAt: Date;
}

export interface VectorDoc { xId: string; embedding: number[]; model: string; dims: number; inputHash: string; }

export const RoleSchema = z.enum(["evidence", "example", "counterexample", "tool", "inspiration", "extension", "tangent", "unrelated"]);
export type Role = z.infer<typeof RoleSchema>;
export const GradeSchema = z.object({
  grade: z.number().int().min(0).max(3),
  role: RoleSchema,
  rationale: z.string().min(1).max(300),
  subQuestionIds: z.array(z.string()).max(2),
});
export type Grade = z.infer<typeof GradeSchema>;

export interface Relation { xId: string; questionId: string; role: Role; grade: number; rationale: string; cosine: number; modelVersion: string; disagreement: boolean; }
export interface Question { _id: string; text: string; parentId: string | null; embedding?: number[]; validFrom: Date; validTo: Date | null; origin: "seed" | "induced" | "curated"; }

export interface LayoutPoint { xId: string; x: number; y: number; clusterId: number; provisional: boolean; }
export interface LayoutLabel { level: number; text: string; x: number; y: number; priority: number; clusterId: number; themeId?: number; }
export interface Layout {
  version: number; createdAt: Date; method: string; status: "draft" | "published"; points: LayoutPoint[]; labels: LayoutLabel[];
  themes: { id: number; label: string; clusterIds: number[] }[];
  clusters: { id: number; label: string; themeId: number; size: number; x: number; y: number }[];
  hulls: { clusterId: number; polygon: [number, number][] }[];
  procrustesResidual: number | null;
}

export interface Manifest { _id: "current"; layoutVersion: number; pointsUrl: string; metaUrl: string; labelsUrl: string; generatedAt: Date; count: number; embeddingModel: string; }
export interface RunDoc { startedAt: Date; finishedAt?: Date; kind: "daily" | "bootstrap" | "reconcile"; counts: Record<string, number>; errors: string[]; notes: string[]; ok: boolean; }
export interface Override {
  type: "pin" | "renameLabel" | "moveLeaf" | "retireQuestion" | "trailEdit"; xId?: string; clusterId?: number; questionId?: string;
  payload: Record<string, unknown>; createdAt: Date;
}
