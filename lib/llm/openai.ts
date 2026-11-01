import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import { env } from "../env";

let c: OpenAI | null = null;
export function getOpenAI() { return (c ??= new OpenAI({ apiKey: env().OPENAI_API_KEY })); }
export class LLMParseError extends Error {}
export type ResponseInput = Parameters<OpenAI["responses"]["parse"]>[0]["input"];

/** Structured output via the Responses API; validated by zod; throws LLMParseError when the model returned nothing parseable. */
export async function parseStructured<T>(schema: ZodType<T>, name: string, input: ResponseInput, model = env().OPENAI_TEXT_MODEL): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await getOpenAI().responses.parse({ model, input, text: { format: zodTextFormat(schema as any, name) }, reasoning: { effort: "low" } });
  if (!r.output_parsed) throw new LLMParseError(`No parsed output for ${name}: ${r.output_text?.slice(0, 200)}`);
  return r.output_parsed as T;
}
