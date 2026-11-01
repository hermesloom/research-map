import { describe, it, expect } from "vitest";
import { describeImage, VISION_PROMPT } from "@/lib/enrich/vision";

describe("describeImage", () => {
  it("downloads, uploads, and asks the model with the image as data url", async () => {
    process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k";
    const puts: string[] = []; let gotInput: any;
    const deps = {
      fetchImpl: (async () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0x00]), { headers: { "content-type": "image/jpeg" } })) as any,
      put: async (p: string) => { puts.push(p); return `https://blob/${p}`; },
      parse: async (_s: any, _n: string, input: any) => { gotInput = input; return { transcript: "Hello", kind: "screenshot_text", description: "A screenshot", title: "Hello" }; },
    };
    const r = await describeImage("https://pbs.twimg.com/media/abc.jpg", deps as any);
    expect(puts[0]).toMatch(/^media\/[0-9a-f]{40}\.jpg$/); expect(puts[1]).toMatch(/^thumbs\//);
    expect(r.vision.transcript).toBe("Hello"); expect(r.thumbUrl).toContain("thumbs/");
    const img = gotInput[0].content.find((c: any) => c.type === "input_image");
    expect(img.image_url.startsWith("data:image/jpeg;base64,")).toBe(true); expect(img.detail).toBe("high");
    expect(gotInput[0].content[0].text).toBe(VISION_PROMPT);
  });
});
