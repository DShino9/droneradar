#!/usr/bin/env python3
"""One collection pass, for a machine with no screen.

DroneRadar.app runs the three collectors on background loops. In GitHub
Actions there is no process to keep alive: the run happens, the files are
written, the runner is destroyed. This is that same work, once, in the
foreground, with the log going to stdout so a failed run reads as a log rather
than an exit code.

Each collector is guarded on its own. A feed being down, or Yahoo changing a
page, should cost that one section — not the run, and not the articles that
were already gathered before it.
"""
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from droneradar import collector  # noqa: E402


def log(msg):
    print("%s  %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


def step(name, fn):
    started = time.time()
    try:
        fn()
        log("%s: 完了 (%.1fs)" % (name, time.time() - started))
        return True
    except Exception:
        log("%s: 失敗 (%.1fs)" % (name, time.time() - started))
        traceback.print_exc()
        return False


def main():
    log("data = %s" % collector.DATA)
    ok = [
        step("記事", lambda: collector.collect_articles(log)),
        step("SNS", collector.collect_social),
        step("株価", collector.collect_stocks),
    ]
    items = collector.load_json("items.json", [])
    social = collector.load_json("social.json", [])
    log("記事 %d件 / SNS %d件" % (len(items), len(social)))

    # A run that gathered nothing at all is a failure worth seeing in the
    # Actions list; a run that lost one of three sections is not, because the
    # published page still updates and the next hour will try again.
    if not any(ok) or not items:
        log("収集できたものがありません")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
