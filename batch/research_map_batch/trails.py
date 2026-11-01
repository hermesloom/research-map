def rebuild_trails(db):
    """One generated trail per active sub-question: grade>=2 posts in chronological order (notes empty in v1)."""
    n = 0
    for q in db.questions.find({"validTo": None, "parentId": {"$ne": None}}):
        xids = [r["xId"] for r in db.relations.find({"questionId": q["_id"], "grade": {"$gte": 2}}, {"xId": 1})]
        items = sorted(db.items.find({"xId": {"$in": xids}, "deletedAt": {"$exists": False}}, {"xId": 1, "createdAt": 1}), key=lambda i: i["createdAt"])
        if len(items) < 2:
            continue
        db.trails.replace_one(
            {"_id": f"q:{q['_id']}"},
            {"_id": f"q:{q['_id']}", "questionId": q["_id"], "name": q["text"], "steps": [{"xId": it["xId"], "note": "", "position": i} for i, it in enumerate(items)], "authority": "generated"},
            upsert=True,
        )
        n += 1
    return n
