#!/usr/bin/env python3
"""Fill tests/config.json with the ids the two selections declare."""

import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
IDS = json.loads((HERE / "ids.json").read_text())

BASE = json.loads((TASK / "draft-pull" / "tests" / "config.json").read_text())
BASE["f2p_node_ids"] = IDS["f2p"]
BASE["p2p_node_ids"] = IDS["p2p"]
BASE["grade"]["tool_label"] = "django-unittest"

(TASK / "tests").mkdir(exist_ok=True)
(TASK / "tests" / "config.json").write_text(json.dumps(BASE, indent=1) + "\n")
print("f2p %d / p2p %d" % (len(IDS["f2p"]), len(IDS["p2p"])))
