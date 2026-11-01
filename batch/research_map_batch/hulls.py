from shapely import concave_hull, MultiPoint


def hulls(xy, labels, ratio=0.3):
    """Concave hull polygon per cluster with >= 4 points, for the hover outline on the canvas."""
    out = []
    for k in sorted(set(labels.tolist()) - {-1}):
        pts = xy[labels == k]
        if len(pts) < 4:
            continue
        poly = concave_hull(MultiPoint([tuple(p) for p in pts]), ratio=ratio)
        if poly.geom_type != "Polygon":
            poly = poly.convex_hull
        out.append({"clusterId": int(k), "polygon": [[float(x), float(y)] for x, y in poly.exterior.coords]})
    return out
