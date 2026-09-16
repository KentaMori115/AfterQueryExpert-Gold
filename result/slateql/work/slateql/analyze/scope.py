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
from ..plan.expressions import Column
from ..types.schema import Field, Schema
from ..util.text import suggest

__all__ = ["Scope", "OutputScope"]


class Scope:
    """Resolves column references against a relation schema."""

    __slots__ = ("_schema", "_aliases")

    def __init__(self, schema: Schema) -> None:
        self._schema = schema
        self._aliases = _distinct_qualifiers(schema)

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
        return Scope(schema)

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
