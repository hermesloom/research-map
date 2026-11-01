import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../env";
import { parseStructured } from "../llm/openai";
import { putPublic } from "../blob";

export const VisionSchema = z.object({
  transcript: z.string().max(4000),
  kind: z.enum(["screenshot_text", "photo", "diagram", "meme", "ui", "document", "other"]),
  description: z.string().max(400),
  title: z.string().max(100),
});
export type Vision = z.infer<typeof VisionSchema>;
export const VISION_PROMPT = "First transcribe ALL legible text in the image verbatim (keep the original language; use line breaks). Then classify the image kind, write a one-sentence neutral description in English, and a short title (max 8 words). If there is no text, transcript is an empty string.";

export async function describeImage(imageUrl: string, deps = { parse: parseStructured, fetchImpl: fetch, put: putPublic }) {
  const res = await deps.fetchImpl(imageUrl); if (!res.ok) throw new Error(`image ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer()); const ct = res.headers.get("content-type") ?? "image/jpeg"; const ext = ct.includes("png") ? "png" : "jpg";
  const sha = createHash("sha1").update(buf).digest("hex");
  const originalMediaUrl = await deps.put(`media/${sha}.${ext}`, buf, ct);
  const thumbUrl = await deps.put(`thumbs/${sha}.${ext}`, buf, ct); // v1 ships the original as thumbnail (recorded simplification)
  const vision = await deps.parse(VisionSchema, "vision", [{ role: "user", content: [
    { type: "input_text", text: VISION_PROMPT },
    { type: "input_image", image_url: `data:${ct};base64,${buf.toString("base64")}`, detail: "high" },
  ] }], env().OPENAI_VISION_MODEL);
  return { vision, thumbUrl, originalMediaUrl };
}
