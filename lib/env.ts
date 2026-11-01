import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default("research_map"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_TEXT_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_VISION_MODEL: z.string().default("gpt-5.4-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-large"),
  EMBEDDING_DIMS: z.coerce.number().int().positive().default(1024),
  X_USER_ID: z.string().default("1852658982608846848"),
  X_CONSUMER_KEY: z.string().optional(),
  X_CONSUMER_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  OWNER_SECRET: z.string().optional(),
  GITHUB_DISPATCH_TOKEN: z.string().optional(),
  GITHUB_REPO: z.string().default("hermesloom/research-map"),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  RESEARCH_QUESTION_POST_ID: z.string().default("2115703316281778260"),
  RELAYOUT_PROVISIONAL_THRESHOLD: z.coerce.number().default(0.08),
});
export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function loadEnv(): Env {
  const r = schema.safeParse(process.env);
  if (!r.success) {
    const missing = r.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  cached = r.data;
  return r.data;
}
export function env(): Env { return cached ?? loadEnv(); }
