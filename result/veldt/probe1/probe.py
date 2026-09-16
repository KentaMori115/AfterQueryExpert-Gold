import sys, pathlib, traceback
root = sys.argv[1]
sys.path.insert(0, str(pathlib.Path(root) / "src"))
from veldt import Engine
from veldt.plan.stats import estimate
from veldt.execution.physical import create_physical_plan

def mk():
    e = Engine()
    e.register_rows("one", [{"x": v} for v in [3, 1, 2, 1]])
    e.register_rows("two", [{"x": v} for v in [2, 5, 2]])
    e.register_rows("nul", [{"x": v} for v in [1, None, 3]])
    e.register_rows("nul2", [{"x": v} for v in [None, 3]])
    return e

def probe(name, fn):
    try:
        print(f"{name:44s} {fn()!r}")
    except Exception as exc:
        print(f"{name:44s} EXC {type(exc).__name__}: {str(exc)[:70]}")

e = mk()
col = lambda q, **k: e.sql(q, **k).column("x")

probe("est_intersect", lambda: estimate(e.plan("SELECT x FROM one INTERSECT SELECT x FROM two", optimize=False)).num_rows)
probe("est_intersect_all", lambda: estimate(e.plan("SELECT x FROM one INTERSECT ALL SELECT x FROM two", optimize=False)).num_rows)
probe("est_except", lambda: estimate(e.plan("SELECT x FROM one EXCEPT SELECT x FROM two", optimize=False)).num_rows)
probe("est_except_all", lambda: estimate(e.plan("SELECT x FROM one EXCEPT ALL SELECT x FROM two", optimize=False)).num_rows)
probe("est_union", lambda: estimate(e.plan("SELECT x FROM one UNION SELECT x FROM two", optimize=False)).num_rows)

def blocking(q):
    op = create_physical_plan(e.plan(q, optimize=False))
    return [(o.name, o.is_blocking) for o in op.walk()]
probe("blocking_intersect", lambda: blocking("SELECT x FROM one INTERSECT SELECT x FROM two"))
probe("blocking_except_all", lambda: blocking("SELECT x FROM one EXCEPT ALL SELECT x FROM two"))

probe("metrics_intersect", lambda: sorted(k for k in e.sql("SELECT x FROM one INTERSECT SELECT x FROM two").metrics if "row" in k or "batch" in k))
probe("metrics_except", lambda: sorted(k for k in e.sql("SELECT x FROM one EXCEPT ALL SELECT x FROM two").metrics if "row" in k or "batch" in k))

probe("order_by_on_first_branch", lambda: col("SELECT x FROM one ORDER BY x UNION SELECT x FROM two"))
probe("limit_on_first_branch", lambda: col("SELECT x FROM one LIMIT 2 UNION ALL SELECT x FROM two"))
probe("nulls_desc_on_chain", lambda: col("SELECT x FROM nul UNION SELECT x FROM two ORDER BY x DESC"))
probe("nulls_asc_on_chain", lambda: col("SELECT x FROM nul UNION SELECT x FROM two ORDER BY x"))
probe("nulls_last_explicit", lambda: col("SELECT x FROM nul UNION SELECT x FROM two ORDER BY x NULLS LAST"))
probe("order_by_expression", lambda: col("SELECT x FROM one UNION SELECT x FROM two ORDER BY x * -1"))
probe("intersect_null_all", lambda: col("SELECT x FROM nul INTERSECT ALL SELECT x FROM nul2"))
probe("explain_chain", lambda: e.explain("SELECT x FROM one INTERSECT SELECT x FROM two EXCEPT SELECT x FROM nul"))
probe("deep_chain", lambda: col("SELECT x FROM one UNION ALL SELECT x FROM two INTERSECT ALL SELECT x FROM one EXCEPT ALL SELECT x FROM two"))
probe("distinct_branch", lambda: col("SELECT DISTINCT x FROM one INTERSECT ALL SELECT x FROM two"))
probe("agg_branch", lambda: [r for r in e.sql("SELECT count(*) AS x FROM one INTERSECT SELECT count(*) AS x FROM two").to_rows()])
probe("empty_left", lambda: col("SELECT x FROM one WHERE x > 99 EXCEPT ALL SELECT x FROM two"))
probe("cli_explain_named", lambda: "Intersect" in e.explain("SELECT x FROM one INTERSECT SELECT x FROM two"))
probe("plan_summary", lambda: __import__("veldt.plan.printer", fromlist=["plan_summary"]).plan_summary(e.plan("SELECT x FROM one EXCEPT ALL SELECT x FROM two", optimize=False)))
