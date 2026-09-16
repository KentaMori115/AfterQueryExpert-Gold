"""configlayer.query — glob queries over nested configuration.

Layer policies already select keys with dotted-glob patterns
(:class:`configlayer.policy.KeyPattern`); this package turns the same
pattern language into a query engine for any nested mapping.
:func:`select` reports matched nodes in document order, :func:`first`,
:func:`paths` and :func:`values` are conveniences over it, and
:func:`pick` / :func:`prune` build shape-preserving copies containing
only — or everything but — the matched nodes.  A :class:`Query`
compiles a pattern set once for reuse, and :func:`select_origins` runs a
query over a :class:`~configlayer.layers.LayeredConfig`, expanding
matches to leaves and naming the layer that supplied each one.

``db.*`` covers ``db.host`` but not ``db.pool.size``; ``db.**`` covers
both; ``**.password`` covers a password leaf at any depth.  When a match
contains another, only the outermost node is reported.
"""

from configlayer.query.layers import OriginMatch, select_origins
from configlayer.query.match import Match
from configlayer.query.query import Query
from configlayer.query.select import first, paths, select, values
from configlayer.query.transform import pick, prune

__all__ = [
    "Match",
    "OriginMatch",
    "Query",
    "select",
    "select_origins",
    "first",
    "paths",
    "values",
    "pick",
    "prune",
]
