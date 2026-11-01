import os
import numpy as np
from pymongo import MongoClient

EXCLUDED = ["replyToOther", "retweet"]


def connect():
    return MongoClient(os.environ["MONGODB_URI"])[os.environ.get("MONGODB_DB", "research_map")]


def load_vectors(db):
    """ids (sorted numerically) and embedding matrix for canvas-eligible items that have a vector."""
    ok = {d["xId"] for d in db.items.find({"stage": {"$in": ["embedded", "placed", "graded"]}, "kind": {"$nin": EXCLUDED}, "deletedAt": {"$exists": False}}, {"xId": 1})}
    rows = [r for r in db.vectors.find({}, {"xId": 1, "embedding": 1}) if r["xId"] in ok]
    rows.sort(key=lambda r: int(r["xId"]))
    return [r["xId"] for r in rows], np.array([r["embedding"] for r in rows], dtype=np.float32)


def load_published_layout(db):
    return db.layouts.find_one({"status": "published"}, sort=[("version", -1)])


def load_relations_core(db):
    return {r["xId"]: r for r in db.relations.find({"questionId": "core"}, {"xId": 1, "grade": 1, "role": 1, "rationale": 1})}


def load_normalized(db):
    items = {i["xId"]: i for i in db.items.find({"kind": {"$nin": EXCLUDED}}, {"xId": 1, "createdAt": 1, "kind": 1, "text": 1})}
    out = {}
    for e in db.enrichment.find({"normalized": {"$exists": True}}, {"xId": 1, "normalized": 1}):
        if e["xId"] in items:
            out[e["xId"]] = {**e["normalized"], "createdAt": items[e["xId"]]["createdAt"], "kind": items[e["xId"]]["kind"]}
    return out
