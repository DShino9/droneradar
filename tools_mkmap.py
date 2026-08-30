"""Build a compact Japan prefecture map (SVG paths) from Natural Earth.

Source: ne_10m_admin_1_states_provinces.geojson, filtered to Japan. Natural
Earth is public domain, so nothing has to be credited or reported — unlike the
地球地図日本 data this replaced, which requires attribution for any use and a
usage report to the copyright holder for commercial use.

Prefecture codes come from `iso_3166_2` (JP-01 … JP-47), which matches the JIS
numbering used throughout the app; Japanese names come from `name_ja`.
"""
import json
import math
import os
import sys

SRC = "ne_admin1.geojson"
OUT = os.path.join("droneradar", "web", "japan.json")

WIDTH = 760.0          # target drawing width for the mainland
OKINAWA_CODE = 47
MIN_RING_AREA = 0.9    # drop islands smaller than this, in projected units^2
# Tokyo administers the Izu and Ogasawara chains, which reach past 24°N. Drawn
# to scale they stretch the frame ~200px south for a few specks of land, so the
# mainland map stops here. Okinawa keeps its own inset and is exempt.
MAINLAND_LAT_FLOOR = 30.0
TOLERANCE = 0.55       # Douglas-Peucker tolerance, in projected units


def rings_of(geom):
    t = geom["type"]
    if t == "Polygon":
        return [geom["coordinates"][0]]
    if t == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    raise ValueError(t)


def perpendicular_distance(pt, a, b):
    (x, y), (x1, y1), (x2, y2) = pt, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points, tol):
    """Iterative Douglas-Peucker (recursion blows the stack on 10k-point rings)."""
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
    feats = []
    for f in data["features"]:
        props = f["properties"]
        if (props.get("iso_a2") or props.get("adm0_a3")) not in ("JP", "JPN"):
            continue
        iso = props.get("iso_3166_2") or ""
        if not iso.startswith("JP-"):
            continue
        feats.append(f)
    if len(feats) != 47:
        print("警告: 都道府県が %d 件しか取れていません" % len(feats))

    # Equirectangular projection centred on Japan's mainland.
    lat0 = 37.5
    kx = math.cos(math.radians(lat0))

    projected = {}
    for f in feats:
        props = f["properties"]
        code = int(props["iso_3166_2"].split("-")[1])
        name = props.get("name_ja") or props.get("name")
        polys = []
        for ring in rings_of(f["geometry"]):
            if code != OKINAWA_CODE:
                if max(lat for _, lat in ring) < MAINLAND_LAT_FLOOR:
                    continue
            pts = [(lon * kx, -lat) for lon, lat in ring]
            polys.append(pts)
        if polys:
            projected[code] = {"name": name, "rings": polys}

    # Bounding box of the mainland (Okinawa is drawn separately as an inset).
    # Two passes: the first gives a provisional scale so the island-area filter
    # can run, the second re-fits the box to only the rings we actually draw.
    # Without this, Tokyo's Ogasawara islands stretch the map ~400px southward.
    def bbox(codes, rings_filter=None):
        xs, ys = [], []
        for code in codes:
            for ring in projected[code]["rings"]:
                if rings_filter and not rings_filter(ring):
                    continue
                for x, y in ring:
                    xs.append(x)
                    ys.append(y)
        return min(xs), max(xs), min(ys), max(ys)

    mainland = [c for c in projected if c != OKINAWA_CODE]
    minx, maxx, miny, maxy = bbox(mainland)
    scale = WIDTH / (maxx - minx)
    minx, maxx, miny, maxy = bbox(
        mainland, lambda r: ring_area(r) * scale * scale >= MIN_RING_AREA
    )
    scale = WIDTH / (maxx - minx)
    height = (maxy - miny) * scale

    def place(x, y):
        return ((x - minx) * scale, (y - miny) * scale)

    # Okinawa gets its own transform so it sits in a box at the lower left.
    oxs, oys = [], []
    for ring in projected[OKINAWA_CODE]["rings"]:
        for x, y in ring:
            oxs.append(x)
            oys.append(y)
    o_minx, o_maxx = min(oxs), max(oxs)
    o_miny, o_maxy = min(oys), max(oys)
    o_scale = scale * 0.62
    INSET_W = (o_maxx - o_minx) * o_scale
    INSET_H = (o_maxy - o_miny) * o_scale
    inset_x, inset_y = 6.0, height - INSET_H - 6.0

    def place_okinawa(x, y):
        return (inset_x + (x - o_minx) * o_scale, inset_y + (y - o_miny) * o_scale)

    prefs = []
    total_chars = 0
    for code in sorted(projected):
        p = projected[code]
        tf = place_okinawa if code == OKINAWA_CODE else place
        tol = TOLERANCE * (0.62 if code == OKINAWA_CODE else 1.0)
        parts = []
        best_area, centroid = -1.0, None
        for ring in p["rings"]:
            pts = [tf(x, y) for x, y in ring]
            if ring_area(pts) < MIN_RING_AREA:
                continue
            pts = simplify(pts, tol)
            if len(pts) < 3:
                continue
            # Anchor the marker on the largest landmass, not the area-weighted
            # mean of every ring — otherwise Kagoshima's marker lands out in the
            # Amami islands and Hokkaido's drifts off the main island.
            a = ring_area(pts)
            if a > best_area:
                best_area = a
                centroid = (
                    sum(q[0] for q in pts) / len(pts),
                    sum(q[1] for q in pts) / len(pts),
                )
            d = "M" + " ".join(
                "%.1f %.1f" % (q[0], q[1]) for q in pts
            ) + "Z"
            parts.append(d)
        if not parts:
            continue
        path = "".join(parts)
        total_chars += len(path)
        prefs.append({
            "code": code,
            "name": p["name"],
            "d": path,
            "cx": round(centroid[0], 1),
            "cy": round(centroid[1], 1),
        })

    out = {
        "width": round(WIDTH, 1),
        "height": round(height, 1),
        "inset": {
            "x": round(inset_x - 6, 1),
            "y": round(inset_y - 6, 1),
            "w": round(INSET_W + 12, 1),
            "h": round(INSET_H + 12, 1),
            "label": "沖縄",
        },
        "prefectures": prefs,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("prefectures: %d, path chars: %d, viewBox: %.0f x %.0f"
          % (len(prefs), total_chars, WIDTH, height))


if __name__ == "__main__":
    sys.exit(main())
