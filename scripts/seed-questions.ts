import { loadEnv } from "@/lib/env";
import { getDb, collections, closeDb, ensureIndexes } from "@/lib/db";
import { CORE_QUESTION, SEED_SUBQUESTIONS } from "@/lib/llm/grade";
import { embedTexts } from "@/lib/llm/embed";

async function main() {
  loadEnv();
  const db = await getDb(); await ensureIndexes(db); const { questions } = collections(db);
  const texts = [CORE_QUESTION, ...SEED_SUBQUESTIONS]; const ids = ["core", ...SEED_SUBQUESTIONS.map((_, i) => `seed-${i + 1}`)];
  const existing = new Set((await questions.find({ _id: { $in: ids } }).toArray()).map((q) => q._id));
  const todo = ids.map((id, i) => [id, texts[i]] as const).filter(([id]) => !existing.has(id));
  if (todo.length) {
    const vecs = await embedTexts(todo.map(([, t]) => t));
    await questions.insertMany(todo.map(([id, text], i) => ({ _id: id, text, parentId: id === "core" ? null : "core", embedding: vecs[i], validFrom: new Date(), validTo: null, origin: "seed" as const })));
  }
  console.log(`questions: ${existing.size} existed, ${todo.length} inserted`); await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
