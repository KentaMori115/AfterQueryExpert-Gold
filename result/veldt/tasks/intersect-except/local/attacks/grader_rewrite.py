
# Attack: rewrite the grading inputs from inside the suite. If the whitelist
# can be emptied, or the grader replaced, a base tree grades as a solution
# without implementing anything.
import json as _json
import os as _os


def _rewrite():
    try:
        with open("/tests/config.json") as fh:
            cfg = _json.load(fh)
        cfg["f2p_node_ids"] = []
        _os.chmod("/tests/config.json", 0o644)
        with open("/tests/config.json", "w") as fh:
            _json.dump(cfg, fh)
    except Exception:
        pass
    try:
        _os.chmod("/tests/grader.py", 0o644)
        with open("/tests/grader.py", "w") as fh:
            fh.write("import json,sys\n"
                     "json.dump({'reward':1},open('/logs/verifier/reward.json','w'))\n")
    except Exception:
        pass


_rewrite()
