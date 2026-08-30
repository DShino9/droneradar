"""Generate DroneRadar's icon without any imaging dependency.

Rasterises a radar scope straight into PNG bytes (zlib + CRC), then leaves it
to iconutil to assemble the .icns.

A scope rather than a quadcopter: a four-rotor outline is what every drone app
in the Launchpad already uses, and at 16px it collapses into four grey dots.
A dark circle with one bright wedge sweeping out of it is legible at any size
and is the thing this app actually is.
"""
import math
import os
import struct
import subprocess
import sys
import zlib

BG_TOP = (0x16, 0x2A, 0x44)
BG_BOTTOM = (0x0C, 0x15, 0x24)
ACCENT = (0x4D, 0xA3, 0xFF)
ACCENT_DIM = (0x2F, 0x6F, 0xB8)
SCOPE = (0x04, 0x10, 0x22)
GRID = (0x2C, 0x5B, 0x8E)
EDGE = (0xC9, 0xEC, 0xFF)
RIM = (0x3F, 0x86, 0xCC)
HOT = (0xFF, 0xB4, 0x45)


def smoothstep(edge0, edge1, x):
    t = (x - edge0) / (edge1 - edge0) if edge1 != edge0 else 0.0
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def blend(dst, src, a):
    return tuple(int(round(d + (s - d) * a)) for d, s in zip(dst, src))


def rounded_box_alpha(x, y, size, inset, radius, aa):
    """Coverage of a rounded square, anti-aliased at the edge."""
    half = size / 2.0
    px, py = abs(x - half), abs(y - half)
    limit = half - inset
    dx = px - (limit - radius)
    dy = py - (limit - radius)
    if dx <= 0 and dy <= 0:
        d = max(dx, dy) - radius
    else:
        d = math.hypot(max(dx, 0.0), max(dy, 0.0)) - radius
    return 1.0 - smoothstep(-aa, aa, d)


def ring_alpha(x, y, cx, cy, r, thickness, aa):
    d = abs(math.hypot(x - cx, y - cy) - r) - thickness / 2.0
    return 1.0 - smoothstep(-aa, aa, d)


def disc_alpha(x, y, cx, cy, r, aa):
    return 1.0 - smoothstep(-aa, aa, math.hypot(x - cx, y - cy) - r)


def bar_alpha(x, y, x0, y0, x1, y1, thickness, aa):
    """Coverage of a rounded capsule between two points."""
    vx, vy = x1 - x0, y1 - y0
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else ((x - x0) * vx + (y - y0) * vy) / L2
    t = max(0.0, min(1.0, t))
    d = math.hypot(x - (x0 + t * vx), y - (y0 + t * vy)) - thickness / 2.0
    return 1.0 - smoothstep(-aa, aa, d)


def wedge_alpha(x, y, cx, cy, r, lead_deg, spread_deg):
    """The sweep: brightest at the leading edge, fading back over `spread`."""
    d = math.hypot(x - cx, y - cy)
    if d > r:
        return 0.0
    ang = math.degrees(math.atan2(y - cy, x - cx))
    # Distance behind the leading edge, wrapped into 0-360.
    back = (lead_deg - ang) % 360.0
    if back > spread_deg:
        return 0.0
    # Squared falloff so the leading edge reads as a hard line and the trail
    # dissolves rather than ending on a visible second edge.
    tail = 1.0 - back / spread_deg
    return tail * tail


def render(size):
    s = float(size)
    aa = s / 512.0 * 1.6
    cx = cy = s / 2.0
    R = s * 0.378                     # scope radius; fills the tile the way
                                      # a macOS icon is expected to
    LEAD = -68.0                      # leading edge, up and to the right
    rows = []

    for y in range(size):
        row = bytearray()
        for x in range(size):
            fx, fy = x + 0.5, y + 0.5
            g = fy / s
            base = tuple(int(round(t + (b - t) * g)) for t, b in zip(BG_TOP, BG_BOTTOM))
            a_bg = rounded_box_alpha(fx, fy, s, s * 0.055, s * 0.215, aa)
            px = base

            # The scope face, a shade darker than the tile it sits on.
            face = disc_alpha(fx, fy, cx, cy, R, aa)
            if face > 0:
                px = blend(px, SCOPE, face)

            # Range rings and cross hairs, dim so the sweep stays the subject.
            grid = 0.0
            for k in (0.36, 0.70):
                grid = max(grid, ring_alpha(fx, fy, cx, cy, R * k, s * 0.010, aa))
            grid = max(grid, bar_alpha(fx, fy, cx - R, cy, cx + R, cy, s * 0.009, aa))
            grid = max(grid, bar_alpha(fx, fy, cx, cy - R, cx, cy + R, s * 0.009, aa))
            if grid > 0:
                px = blend(px, GRID, grid * face)

            # The sweep itself.
            w = wedge_alpha(fx, fy, cx, cy, R, LEAD, 105.0)
            if w > 0:
                px = blend(px, ACCENT, 0.95 * w)

            # Leading edge: a bright spoke from the centre out.
            ex = cx + R * math.cos(math.radians(LEAD))
            ey = cy + R * math.sin(math.radians(LEAD))
            edge = bar_alpha(fx, fy, cx, cy, ex, ey, s * 0.020, aa)
            if edge > 0:
                px = blend(px, EDGE, edge)

            # Contacts. The amber one is the important-news colour the
            # dashboard uses, so the icon and the app agree.
            for bx, by, br, col in (
                (0.638, 0.302, 0.034, HOT),
                (0.372, 0.272, 0.024, ACCENT),
                (0.666, 0.612, 0.026, ACCENT),
                (0.322, 0.578, 0.021, ACCENT_DIM),
            ):
                b_a = disc_alpha(fx, fy, s * bx, s * by, s * br, aa)
                if b_a > 0:
                    px = blend(px, col, b_a)

            # Rim, and a hub where the sweep pivots.
            rim = ring_alpha(fx, fy, cx, cy, R, s * 0.016, aa)
            if rim > 0:
                px = blend(px, RIM, rim)
            hub = disc_alpha(fx, fy, cx, cy, s * 0.026, aa)
            if hub > 0:
                px = blend(px, EDGE, hub)

            row += bytes((px[0], px[1], px[2], int(round(255 * a_bg))))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def write_ico(path, entries):
    """An .ico is a directory of images; PNG-compressed entries are allowed."""
    pngs = []
    for size, rows in entries:
        raw = b"".join(b"\x00" + r for r in rows)

        def chunk(tag, data):
            c = struct.pack(">I", len(data)) + tag + data
            return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(raw, 9))
        png += chunk(b"IEND", b"")
        pngs.append((size, png))

    header = struct.pack("<HHH", 0, 1, len(pngs))
    offset = 6 + 16 * len(pngs)
    dir_entries, blob = b"", b""
    for size, png in pngs:
        # 256 is stored as 0 — the field is a single byte.
        dim = 0 if size >= 256 else size
        dir_entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32,
                                   len(png), offset)
        blob += png
        offset += len(png)
    with open(path, "wb") as f:
        f.write(header + dir_entries + blob)


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    iconset = os.path.join(root, "AppIcon.iconset")
    os.makedirs(iconset, exist_ok=True)

    specs = [(16, "16x16", 1), (32, "16x16", 2), (32, "32x32", 1), (64, "32x32", 2),
             (128, "128x128", 1), (256, "128x128", 2), (256, "256x256", 1),
             (512, "256x256", 2), (512, "512x512", 1), (1024, "512x512", 2)]
    cache = {}
    for px, name, scale in specs:
        if px not in cache:
            cache[px] = render(px)
        suffix = "" if scale == 1 else "@2x"
        write_png(os.path.join(iconset, "icon_%s%s.png" % (name, suffix)), px, cache[px])
        print("  icon_%s%s.png" % (name, suffix))

    # Windows wants the same artwork in an .ico. The format is just a small
    # header followed by whole PNG files, so it can be written here rather than
    # shelling out to a tool that only exists on macOS.
    ico = os.path.join(root, "assets", "AppIcon.ico")
    os.makedirs(os.path.dirname(ico), exist_ok=True)
    write_ico(ico, [(px, cache[px]) for px in (16, 32, 64, 128, 256)])
    print("→", ico)

    out = os.path.join(root, "assets", "AppIcon.icns")
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out], check=True)
    print("→", out)


if __name__ == "__main__":
    sys.exit(main())
