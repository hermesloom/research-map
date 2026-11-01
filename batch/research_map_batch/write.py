import datetime as dt


def assemble_layout(ids, xy, stable_labels, clusters, themes, hulls, residual, prev_version, threshold=0.10, method="umap-warm-procrustes"):
    """Build the layout document. Publishes only if the alignment residual is within the gate; otherwise saves a draft."""
    status = "published" if (residual is None or residual <= threshold) else "draft"
    points = [{"xId": ids[i], "x": float(xy[i, 0]), "y": float(xy[i, 1]), "clusterId": int(stable_labels[i]), "provisional": False} for i in range(len(ids))]
    cl = []
    for k, c in sorted(clusters.items()):
        m = stable_labels == k
        cl.append({**c, "x": float(xy[m, 0].mean()), "y": float(xy[m, 1].mean()), "themeId": c.get("themeId", -1)})
    labels = [{"level": 1, "text": c["label"], "x": c["x"], "y": c["y"], "priority": 100 + c["size"], "clusterId": c["id"]} for c in cl]
    for t in themes:
        mem = [c for c in cl if c["id"] in t["clusterIds"]]
        n = sum(c["size"] for c in mem) or 1
        labels.append({"level": 0, "text": t["label"], "x": sum(c["x"] * c["size"] for c in mem) / n, "y": sum(c["y"] * c["size"] for c in mem) / n, "priority": 1000 + n, "clusterId": -1, "themeId": t["id"]})
    return {
        "version": prev_version + 1, "createdAt": dt.datetime.now(dt.UTC), "method": method, "status": status, "points": points, "labels": labels,
        "themes": [{"id": t["id"], "label": t["label"], "clusterIds": t["clusterIds"]} for t in themes], "clusters": cl, "hulls": hulls, "procrustesResidual": residual,
    }


def write_layout(db, layout):
    """Append the layout version. When published, items that were waiting at `embedded` advance to `placed` so grading can proceed."""
    db.layouts.insert_one(layout)
    if layout["status"] == "published":
        db.items.update_many({"xId": {"$in": [p["xId"] for p in layout["points"]]}, "stage": "embedded"}, {"$set": {"stage": "placed"}})
