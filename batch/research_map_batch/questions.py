import datetime as dt
import numpy as np
from pydantic import BaseModel


class Proposed(BaseModel):
    questions: list[str]


def regrow(db, llm, embed, min_support=5, dedupe_cos=0.9):
    """Induce child questions under each active seed from the rationales of grade>=2 posts. Never deletes; versions by validTo."""
    active = list(db.questions.find({"validTo": None}))
    seeds = [q for q in active if q.get("parentId") == "core"]
    inserted = 0
    for s in seeds:
        rels = list(db.relations.find({"questionId": s["_id"], "grade": {"$gte": 2}}, {"rationale": 1}))
        if len(rels) < min_support:
            continue
        prompt = (
            f"Parent research sub-question: {s['text']}\n\nHere are {len(rels)} one-line rationales of posts that address it:\n"
            + "\n".join(f"- {r['rationale'][:200]}" for r in rels[:80])
            + f"\n\nPropose at most 3 more specific child questions, each clearly supported by at least {min_support} of the rationales. Return only questions that add a genuinely new angle. Empty list is fine."
        )
        props = llm(prompt, Proposed).questions[:3]
        if not props:
            continue
        vecs = np.asarray(embed(props))
        existing = np.asarray([q["embedding"] for q in active if q.get("embedding")])
        for text, v in zip(props, vecs):
            v = v / np.linalg.norm(v)
            if len(existing) and (existing / np.linalg.norm(existing, axis=1, keepdims=True) @ v).max() >= dedupe_cos:
                continue
            qid = f"ind-{s['_id']}-{int(dt.datetime.now(dt.UTC).timestamp())}-{inserted}"
            db.questions.insert_one({"_id": qid, "text": text, "parentId": s["_id"], "embedding": v.tolist(), "validFrom": dt.datetime.now(dt.UTC), "validTo": None, "origin": "induced"})
            existing = np.vstack([existing, v]) if len(existing) else v[None]
            inserted += 1
    return inserted
