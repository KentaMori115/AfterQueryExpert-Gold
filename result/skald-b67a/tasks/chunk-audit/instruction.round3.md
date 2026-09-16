`chunk_load` proves an image's shape and stops: the code a descriptor carries
is never opened. Add a `skald::verify` module holding
`chunk_verify(&Chunk) -> Vec<Flaw>`, `Flaw` and `FlawKind`. A `Flaw`
names `func`, the `offset` of an opcode byte, and a `kind`: `Opcode`,
`Truncated`, `Constant`, `Local`, `Function`, `Arity`, `Jump`, `Depth`. Report
by function, then offset.

Walk a body from its first byte, over the widths the interpreter reads. A byte
that is no opcode is `Opcode`, operands past the end are `Truncated`; either
ends that body, and its stack goes unread.

Otherwise one flaw per instruction, first that holds. `Constant` for an index
past the pool, or a dictionary key naming a non-string constant. `Local` for a
slot at or past what the frame holds. A frame holds parameters plus locals,
and one slot more when some `NEW_CLOSURE` names that function, since a
captured value takes slot zero. `Function` past the function table, `Arity`
where the callee declares otherwise. `Jump` for an offset, counted from the
instruction after it, landing where none begins. Body length lands, since
falling off the end returns.

`Depth` is the value stack. Read every function alone, entered empty, carrying
depths along every edge; each opcode takes and leaves what the opcode
reference documents. Returning drains the stack, so depth after a call is one,
and an invocation reads a slot beneath its arguments. Report the lowest offset
where paths meet holding different amounts, or a body reads under empty or
pushes past 512.

Where depths settle, follow what slots hold: one holds a known closure when
every path made it over the same function. An `INVOKE` passing what that
function does not declare is `Arity`.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
