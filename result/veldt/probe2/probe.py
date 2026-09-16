import sys, pathlib
root = sys.argv[1]
sys.path.insert(0, str(pathlib.Path(root) / "src"))
from veldt import Engine
from veldt.plan.stats import estimate

def mk():
    e = Engine()
    e.register_rows("one", [{"x": v} for v in [3, 1, 2, 1]])
    e.register_rows("two", [{"x": v} for v in [2, 5, 2]])
    e.register_rows("five", [{"x": v} for v in [1, 2, 3, 4, 5]])
    e.register_rows("single", [{"x": v} for v in [9]])
    e.register_rows("nul", [{"x": v} for v in [1, None, 3]])
    e.register_rows("nul2", [{"x": v} for v in [None, 3]])
    e.register_rows("named", [{"y": v} for v in [1, 2, 3]])
    return e

e = mk()
def probe(name, fn):
    try:
        print(f"{name}\t{fn()!r}")
    except Exception as exc:
        print(f"{name}\tEXC {type(exc).__name__}: {str(exc)[:90]}")

col = lambda q, **k: e.sql(q, **k).column("x")
est = lambda q: estimate(e.plan(q, optimize=False)).num_rows
esto = lambda q: estimate(e.plan(q, optimize=True)).num_rows
pl = lambda q, o=True: repr(e.plan(q, optimize=o))
ex = lambda q, o=True: e.explain(q, optimized=o)

# --- estimate on unknown-stat branches -------------------------------------
probe("est_int_unknown_right", lambda: est("SELECT x FROM five INTERSECT SELECT x FROM two GROUP BY x"))
probe("est_exc_over_join", lambda: est("SELECT a.x FROM five a, two b EXCEPT SELECT x FROM two"))
probe("est_int_over_limit", lambda: est("SELECT x FROM five INTERSECT ALL SELECT x FROM two LIMIT 1"))
probe("est_exc_of_distinct", lambda: est("SELECT DISTINCT x FROM five EXCEPT ALL SELECT x FROM two"))
probe("est_exc_all_nested_exc", lambda: est("SELECT x FROM five EXCEPT ALL SELECT x FROM single EXCEPT ALL SELECT x FROM two"))
probe("est_int_all_chain", lambda: est("SELECT x FROM five INTERSECT ALL SELECT x FROM one INTERSECT ALL SELECT x FROM two"))
probe("est_filtered_branch", lambda: est("SELECT x FROM five WHERE x > 2 INTERSECT ALL SELECT x FROM two"))
probe("est_optimized_exc", lambda: esto("SELECT x FROM five EXCEPT SELECT x FROM single"))

# --- optimizer: predicate pushdown through set ops -------------------------
probe("push_filter_intersect_plan", lambda: pl("SELECT x FROM (SELECT x FROM one INTERSECT ALL SELECT x FROM two) t WHERE x > 1"))
probe("push_filter_except_plan", lambda: pl("SELECT x FROM (SELECT x FROM one EXCEPT ALL SELECT x FROM two) t WHERE x > 1"))
probe("push_filter_union_plan", lambda: pl("SELECT x FROM (SELECT x FROM one UNION ALL SELECT x FROM two) t WHERE x > 1"))
probe("push_filter_intersect_rows", lambda: col("SELECT x FROM (SELECT x FROM one INTERSECT ALL SELECT x FROM two) t WHERE x > 1"))
probe("push_filter_except_rows", lambda: col("SELECT x FROM (SELECT x FROM one EXCEPT ALL SELECT x FROM two) t WHERE x > 1"))

# --- optimizer: distinct elimination ---------------------------------------
probe("distinct_over_intersect", lambda: pl("SELECT DISTINCT x FROM (SELECT x FROM one INTERSECT SELECT x FROM two) t"))
probe("distinct_over_except", lambda: pl("SELECT DISTINCT x FROM (SELECT x FROM one EXCEPT SELECT x FROM two) t"))
probe("distinct_over_intersect_all", lambda: pl("SELECT DISTINCT x FROM (SELECT x FROM one INTERSECT ALL SELECT x FROM two) t"))
probe("distinct_over_union", lambda: pl("SELECT DISTINCT x FROM (SELECT x FROM one UNION SELECT x FROM two) t"))

# --- projection pushdown ----------------------------------------------------
probe("projection_prune_intersect", lambda: pl("SELECT x FROM one INTERSECT ALL SELECT x FROM two"))

# --- limits -----------------------------------------------------------------
probe("limit_over_intersect", lambda: pl("SELECT x FROM one INTERSECT ALL SELECT x FROM two LIMIT 1"))
probe("offset_chain", lambda: col("SELECT x FROM five EXCEPT ALL SELECT x FROM single ORDER BY x LIMIT 2 OFFSET 1"))

# --- schema / naming --------------------------------------------------------
probe("schema_names_mismatch", lambda: [c.name for c in e.plan("SELECT x FROM one INTERSECT SELECT y FROM named").schema.columns])
probe("schema_nullable", lambda: [(c.name, c.data_type, getattr(c, 'nullable', None)) for c in e.plan("SELECT x FROM nul EXCEPT SELECT x FROM two").schema.columns])
probe("mixed_type_union_schema", lambda: [(c.name, str(c.data_type)) for c in e.plan("SELECT x FROM one INTERSECT SELECT x FROM five").schema.columns])

# --- explain / printer ------------------------------------------------------
probe("explain_nested", lambda: ex("SELECT x FROM one INTERSECT SELECT x FROM two EXCEPT SELECT x FROM five", o=False))
probe("explain_optimized", lambda: ex("SELECT x FROM one EXCEPT ALL SELECT x FROM two"))
probe("explain_schema", lambda: e.explain("SELECT x FROM one INTERSECT ALL SELECT x FROM two", optimized=False, show_schema=True))
probe("plan_summary", lambda: __import__("veldt.plan.printer", fromlist=["plan_summary"]).plan_summary(e.plan("SELECT x FROM one EXCEPT ALL SELECT x FROM two", optimize=False)))

# --- blocking / physical ----------------------------------------------------
def blocking(q):
    from veldt.execution.physical import create_physical_plan
    op = create_physical_plan(e.plan(q, optimize=False))
    return [(o.name, o.is_blocking) for o in op.walk()]
probe("blocking_intersect", lambda: blocking("SELECT x FROM one INTERSECT SELECT x FROM two"))
probe("blocking_except_all", lambda: blocking("SELECT x FROM one EXCEPT ALL SELECT x FROM two"))
probe("blocking_union_all", lambda: blocking("SELECT x FROM one UNION ALL SELECT x FROM two"))

# --- metrics ----------------------------------------------------------------
probe("metrics_intersect", lambda: sorted(e.sql("SELECT x FROM one INTERSECT SELECT x FROM two").metrics.items()))
probe("metrics_except", lambda: sorted(e.sql("SELECT x FROM one EXCEPT ALL SELECT x FROM two").metrics.items()))

# --- values / errors --------------------------------------------------------
probe("null_pairing_int_all", lambda: col("SELECT x FROM nul INTERSECT ALL SELECT x FROM nul2"))
probe("null_pairing_exc_all", lambda: col("SELECT x FROM nul EXCEPT ALL SELECT x FROM nul2"))
probe("type_pairing", lambda: col("SELECT x FROM one INTERSECT ALL SELECT x FROM five"))
probe("width_mismatch", lambda: e.plan("SELECT x, x FROM one INTERSECT SELECT x FROM two"))
probe("batch1_exc_all", lambda: col("SELECT x FROM one EXCEPT ALL SELECT x FROM two", batch_size=1))
probe("batch1_int_all", lambda: col("SELECT x FROM one INTERSECT ALL SELECT x FROM two", batch_size=1))
probe("precedence", lambda: col("SELECT x FROM one UNION SELECT x FROM two INTERSECT SELECT x FROM five"))
probe("left_assoc", lambda: col("SELECT x FROM one EXCEPT SELECT x FROM two UNION SELECT x FROM single"))
probe("order_by_chain", lambda: col("SELECT x FROM one INTERSECT ALL SELECT x FROM two ORDER BY x DESC"))
probe("cli", lambda: __import__("subprocess").run([sys.executable, "-m", "veldt.cli", "--help"], capture_output=True, text=True, cwd=root).returncode)
