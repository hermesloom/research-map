import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("env", () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env = { ...saved }; });
  afterEach(() => { process.env = saved; });

  it("parses required vars and applies defaults", async () => {
    process.env.MONGODB_URI = "mongodb://x";
    process.env.OPENAI_API_KEY = "k";
    delete process.env.EMBEDDING_DIMS;
    const { loadEnv } = await import("@/lib/env");
    const env = loadEnv();
    expect(env.EMBEDDING_DIMS).toBe(1024);
    expect(env.MONGODB_DB).toBe("research_map");
    expect(env.OPENAI_TEXT_MODEL).toBe("gpt-5.4-mini");
  });

  it("throws a readable error listing missing vars", async () => {
    delete process.env.MONGODB_URI;
    delete process.env.OPENAI_API_KEY;
    const { loadEnv } = await import("@/lib/env");
    expect(() => loadEnv()).toThrow(/MONGODB_URI/);
  });
});
