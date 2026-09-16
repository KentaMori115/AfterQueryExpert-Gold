`chunk_load` proves an image's shape and stops: the code a descriptor carries
goes unread. Add a `skald::verify` module holding `chunk_verify(&Chunk) ->
Vec<Flaw>`, `Flaw` and `FlawKind`. A `Flaw` names `func`, the `offset` of an
opcode byte, and a `kind`: `Opcode`, `Truncated`, `Constant`, `Local`,
`Function`, `Arity`, `Jump`, `Depth`. Report by function, then offset.

Walk a body from its first byte, over the widths the interpreter reads. A byte
that is no opcode is `Opcode`, operands past the end are `Truncated`; either
ends that body, so what came before still reports, its stack unread.

Otherwise one flaw per instruction, first in that list which holds. `Constant`
for an index past the pool, or a dictionary key on a non-string. `Local` for a
slot at or past what the frame holds. A frame holds parameters plus locals,
and one more when some `NEW_CLOSURE` names it, since a capture takes slot
zero. `Function` past the function table, `Arity` where the callee declares
otherwise. `Jump` for an offset, counted from the instruction after it,
landing where none begins.

`Depth` is the value stack: read every function alone from empty, carrying
depths along every edge; each opcode takes and leaves what the opcode
reference documents. Returning drains the stack: whatever the caller held is
gone, and depth after a call or invocation is one. An invocation reads a slot
beneath its arguments. One depth flaw a body, at the lowest offset that is
wrong: paths meeting holding different amounts, a read under empty, a push
past 512.

Where depths settle, follow what slots hold: one holds a known closure when
every path made it over the same function. An `INVOKE` passing what that
function never declared is `Arity`.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
