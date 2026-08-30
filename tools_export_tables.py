"""Export the tuned data tables to JSON.

The desktop build stays on Python; the mobile build will be TypeScript. What
must not be duplicated is the *data* — the 87 sources, the gazetteer, and the
classification term lists. Those were arrived at by watching real articles land
in the wrong row, and a second implementation guessing at them would bring back
every misclassification we already fixed.

So Python remains the single source of truth and this writes the tables out for
the other implementation to read. Run it before packaging; `--check` verifies
the committed JSON still matches the Python and is meant for a build step.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.join(HERE, "droneradar", "tables")

from droneradar import collector, geo, sources           # noqa: E402

TERMS = [
    ("drone", "DRONE_TERMS"), ("military", "MILITARY_TERMS"),
    ("event", "EVENT_TERMS"), ("aam", "AAM_TERMS"),
    ("security", "SECURITY_TERMS"), ("disaster", "DISASTER_TERMS"),
    ("survey", "SURVEY_TERMS"), ("industry", "INDUSTRY_TERMS"),
    ("video_noise", "VIDEO_NOISE"), ("video_good", "VIDEO_GOOD"),
    ("video_not_drone", "VIDEO_NOT_DRONE"), ("video_droney", "VIDEO_DRONEY"),
]


def tables():
    return {
        "terms.json": {k: getattr(collector, v) for k, v in TERMS},
        "sources.json": {
            "categories": sources.CATEGORIES,
            "sources": sources.DEFAULT_SOURCES,
            "social": sources.DEFAULT_SOCIAL,
            "stocks": sources.DEFAULT_STOCKS,
        },
        "geo.json": {
            "prefectures": geo.PREFECTURES,
            "places": geo._PLACES,
            "countries": geo.COUNTRIES,
            "bare_safe": geo._BARE_SAFE,
            "national": geo.NATIONAL_TERMS,
            "flagship": geo.FLAGSHIP_TERMS,
            "overseas": geo._OVERSEAS_RE.pattern,
        },
    }


def main():
    check = "--check" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    stale = []
    for name, data in tables().items():
        text = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=False)
        path = os.path.join(OUT, name)
        if check:
            current = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
            if current != text:
                stale.append(name)
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        n = sum(len(v) for v in data.values()) if all(
            isinstance(v, (list, dict)) for v in data.values()) else len(data)
        print("  %-14s %5d件  %5.1f KB" % (name, n, len(text.encode()) / 1024))
    if check:
        if stale:
            print("古くなっています: %s" % ", ".join(stale), file=sys.stderr)
            print("tools_export_tables.py を実行してください", file=sys.stderr)
            return 1
        print("データ表は最新です")
    return 0


if __name__ == "__main__":
    sys.exit(main())
