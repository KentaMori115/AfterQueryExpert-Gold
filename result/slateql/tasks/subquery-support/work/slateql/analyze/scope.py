"""Name resolution for the binder.

A :class:`Scope` wraps the schema produced by everything below the clause being
bound.  It answers two questions: what does this identifier refer to, and what
does ``*`` expand to.  Both are answered against fields rather than against
tables, so a scope works the same whether it came from one scan or a five-way
join.
"""

from __future__ import annotations

from typing import Optional, Sequence

from ..errors import AmbiguousColumnError, BindingError, UnknownColumnError
from ..plan.expressions import Column, Expr, OuterRef
from ..types.schema import Field, Schema
from ..util.text import suggest

__all__ = ["Scope", "OutputScope", "Correlation"]


class Correlation:
    """The link from a subquery's scopes to the query enclosing it.

    Every scope created while binding one subquery shares one of these.  A
    name that no scope of the subquery can resolve is looked up in ``outer``
    instead, and the expression that resolves it there is recorded as a
    *binding*: the enclosing query evaluates the bindings against its own row
    and the subquery reads them back through :class:`OuterRef` slots.  Equal
    bindings share a slot.  ``outer`` may itself belong to a subquery, in
    which case the lookup chains outward and the recorded binding is an
    :class:`OuterRef` of the enclosing subquery.
    """

    __slots__ = ("outer", "_bindings")

    def __init__(self, outer: "Scope") -> None:
        self.outer = outer
        self._bindings: list[Expr] = []

    @property
    def bindings(self) -> tuple[Expr, ...]:
        return tuple(self._bindings)

    def resolve(self, name: str, qualifier: Optional[str]) -> OuterRef:
        """Resolve a reference in the enclosing query and hand back its slot."""

        expression = self.outer.lookup(name, qualifier)
        for index, existing in enumerate(self._bindings):
            if existing == expression:
                return OuterRef(index=index, dtype=expression.dtype, name=_label(name, qualifier))
        self._bindings.append(expression)
        return OuterRef(
            index=len(self._bindings) - 1,
            dtype=expression.dtype,
            name=_label(name, qualifier),
        )


def _label(name: str, qualifier: Optional[str]) -> str:
    return f"{qualifier}.{name}" if qualifier else name


class Scope:
    """Resolves column references against a relation schema.

    A scope inside a subquery also carries the :class:`Correlation` that
    leads to the enclosing query, so that :meth:`lookup` can fall back to
    the enclosing FROM clauses when a name is not visible locally.
    """

    __slots__ = ("_schema", "_aliases", "correlation")

    def __init__(self, schema: Schema, correlation: Optional[Correlation] = None) -> None:
        self._schema = schema
        self._aliases = _distinct_qualifiers(schema)
        self.correlation = correlation

    def lookup(self, name: str, qualifier: Optional[str] = None) -> Expr:
        """Resolve a reference here first, then in the enclosing queries.

        An unqualified name binds in the innermost scope that has it.  A
        qualified name binds in the innermost scope that declares the
        qualifier, and an unknown column under a known qualifier is an error
        there rather than a reason to look further out.
        """

        if qualifier is not None:
            if qualifier in self._aliases:
                return self.resolve(name, qualifier)
        else:
            try:
                return self.resolve(name)
            except AmbiguousColumnError:
                raise
            except UnknownColumnError:
                if self.correlation is None:
                    raise
        if self.correlation is None:
            return self.resolve(name, qualifier)
        try:
            return self.correlation.resolve(name, qualifier)
        except (UnknownColumnError, BindingError):
            # Report against the innermost scope, whose suggestions are the
            # ones a reader expects.
            return self.resolve(name, qualifier)

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def relations(self) -> list[str]:
        """Every relation alias visible in this scope, in first-seen order."""

        return list(self._aliases)

    def resolve(self, name: str, qualifier: Optional[str] = None) -> Column:
        """Resolve a reference to a typed :class:`Column`."""

        if qualifier is not None and qualifier not in self._aliases:
            hints = suggest(qualifier, self._aliases)
            raise BindingError(
                f"unknown table alias: {qualifier}",
                hint=("did you mean " + ", ".join(hints) + "?")
                if hints
                else ("visible relations: " + ", ".join(self._aliases))
                if self._aliases
                else None,
            )
        index = self._schema.index_of(name, qualifier)
        field = self._schema[index]
        return Column(name=field.name, dtype=field.dtype, qualifier=field.qualifier)

    def try_resolve(self, name: str, qualifier: Optional[str] = None) -> Optional[Column]:
        try:
            return self.resolve(name, qualifier)
        except (UnknownColumnError, AmbiguousColumnError, BindingError):
            return None

    def expand_star(self, qualifier: Optional[str] = None) -> list[Column]:
        """Expand ``*`` or ``alias.*`` into concrete column references."""

        if qualifier is None:
            fields: Sequence[Field] = self._schema.fields
        else:
            if qualifier not in self._aliases:
                raise BindingError(
                    f"unknown table alias in {qualifier}.*: {qualifier}",
                    hint=("visible relations: " + ", ".join(self._aliases))
                    if self._aliases
                    else None,
                )
            indices = self._schema.indices_for_qualifier(qualifier)
            fields = [self._schema[index] for index in indices]
        if not fields:
            raise BindingError("* expanded to no columns")
        return [
            Column(name=field.name, dtype=field.dtype, qualifier=field.qualifier)
            for field in fields
        ]

    def with_schema(self, schema: Schema) -> "Scope":
        return Scope(schema, self.correlation)

    def __len__(self) -> int:
        return len(self._schema)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Scope({', '.join(self._schema.qualified_names)})"


class OutputScope(Scope):
    """A scope that also knows the select-list aliases of the current query.

    ORDER BY is allowed to reference a projection alias, and to reference a
    select-list position by ordinal.  Both live here rather than in the plain
    scope so that WHERE cannot accidentally see them.
    """

    __slots__ = ("_aliases_by_name", "_ordinals")

    def __init__(
        self,
        schema: Schema,
        aliases: dict[str, Column],
        ordinals: Sequence[Column],
    ) -> None:
        super().__init__(schema)
        self._aliases_by_name = dict(aliases)
        self._ordinals = list(ordinals)

    def alias(self, name: str) -> Optional[Column]:
        return self._aliases_by_name.get(name)

    def ordinal(self, position: int) -> Column:
        """Resolve a 1-based select-list position."""

        if position < 1 or position > len(self._ordinals):
            raise BindingError(
                f"ORDER BY position {position} is out of range",
                hint=f"the select list has {len(self._ordinals)} items",
            )
        return self._ordinals[position - 1]

    @property
    def alias_names(self) -> list[str]:
        return sorted(self._aliases_by_name)


def _distinct_qualifiers(schema: Schema) -> list[str]:
    seen: list[str] = []
    for field in schema:
        if field.qualifier and field.qualifier not in seen:
            seen.append(field.qualifier)
    return seen
