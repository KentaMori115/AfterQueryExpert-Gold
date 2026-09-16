import sys, pathlib, random, itertools, json
root = sys.argv[1]
sys.path.insert(0, str(pathlib.Path(root) / "src"))
from veldt import Engine
from veldt.plan.stats import estimate

TABLES = {
 "a": [3, 1, 2, 1, None],
 "b": [2, 5, 2, None, None],
 "c": [1.0, 2, 3.5, 3],
 "d": ["x", "y", "x"],
 "e": [True, False, True],
 "f": [],
}
def mk(batch=1024):
    e = Engine()
    for n, vs in TABLES.items():
        e.register_rows(n, [{"v": x} for x in vs])
    return e

e = mk()
ops = ["UNION", "UNION ALL", "INTERSECT", "INTERSECT ALL", "EXCEPT", "EXCEPT ALL"]
srcs = ["SELECT v FROM a", "SELECT v FROM b", "SELECT v FROM c", "SELECT v FROM f",
        "SELECT v FROM a WHERE v > 1", "SELECT DISTINCT v FROM b",
        "SELECT v FROM a LIMIT 2", "SELECT count(*) AS v FROM a",
        "SELECT v FROM b ORDER BY v"]
tails = ["", " ORDER BY v", " ORDER BY v DESC", " ORDER BY v LIMIT 2",
         " LIMIT 2 OFFSET 1", " ORDER BY v NULLS FIRST"]

random.seed(7)
queries = []
for i in range(220):
    n = random.choice([1, 1, 2, 3])
    q = random.choice(srcs)
    for _ in range(n):
        q += " " + random.choice(ops) + " " + random.choice(srcs)
    q += random.choice(tails)
    queries.append(q)

out = {}
for q in queries:
    key = q
    rec = {}
    for bs in (1, 3, 1024):
        try:
            rec[f"rows{bs}"] = repr(e.sql(q, batch_size=bs).column("v"))
        except Exception as exc:
            rec[f"rows{bs}"] = f"EXC {type(exc).__name__}: {str(exc)[:60]}"
    for opt in (False, True):
        try:
            rec[f"est{int(opt)}"] = estimate(e.plan(q, optimize=opt)).num_rows
        except Exception as exc:
            rec[f"est{int(opt)}"] = f"EXC {type(exc).__name__}"
    try:
        rec["explain"] = e.explain(q, optimized=False)
    except Exception as exc:
        rec["explain"] = f"EXC {type(exc).__name__}"
    try:
        rec["plan_opt"] = repr(e.plan(q, optimize=True))
    except Exception as exc:
        rec["plan_opt"] = f"EXC {type(exc).__name__}"
    out[key] = rec
json.dump(out, open(sys.argv[2], "w"), indent=0, sort_keys=True)
print("queries", len(out))
