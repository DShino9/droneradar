"""Build a compact world map (SVG paths per country) from Natural Earth data.

Reads ne_110m_admin_0_countries.geojson and writes droneradar/web/world.json:
country paths keyed by ISO 3166-1 alpha-2, plus the Japanese country name that
Natural Earth already carries in NAME_JA.
"""
import json
import math
import os
import sys

SRC = "world.geojson"
OUT = os.path.join("droneradar", "web", "world.json")

WIDTH = 900.0
# Crop to the inhabited window: the full 360x140 frame spent about a third of
# its width on empty Pacific and polar ice.
LAT_MAX, LAT_MIN = 74.0, -48.0
LON_MIN, LON_MAX = -132.0, 168.0
MIN_RING_AREA = 1.4              # drop islands smaller than this (projected units²)
TOLERANCE = 0.75


def rings_of(geom):
    t = geom["type"]
    if t == "Polygon":
        return [geom["coordinates"][0]]
    if t == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    return []


def perpendicular_distance(pt, a, b):
    (x, y), (x1, y1), (x2, y2) = pt, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points, tol):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        best_d, best_i = -1.0, -1
        a, b = points[lo], points[hi]
        for i in range(lo + 1, hi):
            d = perpendicular_distance(points[i], a, b)
            if d > best_d:
                best_d, best_i = d, i
        if best_d > tol:
            keep[best_i] = True
            stack.append((lo, best_i))
            stack.append((best_i, hi))
    return [p for p, k in zip(points, keep) if k]


def ring_area(ring):
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    scale = WIDTH / (LON_MAX - LON_MIN)
    height = (LAT_MAX - LAT_MIN) * scale

    def project(lon, lat):
        # Equirectangular, clamped to the window. At dashboard size the
        # distortion is unimportant and the lookup stays trivially invertible.
        lat = max(LAT_MIN, min(LAT_MAX, lat))
        lon = max(LON_MIN, min(LON_MAX, lon))
        return ((lon - LON_MIN) * scale, (LAT_MAX - lat) * scale)

    countries = []
    total = 0
    for f in data["features"]:
        props = f["properties"]
        iso = (props.get("ISO_A2") or "").strip()
        if not iso or iso == "-99":
            iso = (props.get("ISO_A2_EH") or "").strip()
        if not iso or iso == "-99":
            continue
        name_ja = (props.get("NAME_JA") or props.get("NAME") or "").strip()
        name_en = (props.get("NAME_EN") or props.get("NAME") or "").strip()

        parts = []
        best_area, centroid = -1.0, None
        for ring in rings_of(f["geometry"]):
            pts = [project(lon, lat) for lon, lat in ring]
            if ring_area(pts) < MIN_RING_AREA:
                continue
            pts = simplify(pts, TOLERANCE)
            if len(pts) < 3:
                continue
            a = ring_area(pts)
            if a > best_area:
                best_area = a
                centroid = (sum(p[0] for p in pts) / len(pts),
                            sum(p[1] for p in pts) / len(pts))
            parts.append("M" + " ".join("%.1f %.1f" % p for p in pts) + "Z")
        if not parts:
            continue
        d = "".join(parts)
        total += len(d)
        countries.append({
            "iso": iso, "ja": name_ja, "en": name_en, "d": d,
            "cx": round(centroid[0], 1), "cy": round(centroid[1], 1),
        })

    out = {"width": round(WIDTH, 1), "height": round(height, 1), "countries": countries}
    json.dump(out, open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print("countries: %d, path chars: %d, viewBox: %.0f x %.0f"
          % (len(countries), total, WIDTH, height))
    print("→", OUT)


if __name__ == "__main__":
    sys.exit(main())
