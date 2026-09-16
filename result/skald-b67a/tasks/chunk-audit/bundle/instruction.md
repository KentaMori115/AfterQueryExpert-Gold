`chunk_load` proves an image's shape and stops: the code a descriptor carries
goes unread. Add a `skald::verify` module holding `chunk_verify(&Chunk) ->
Vec<Flaw>`, `Flaw` and `FlawKind`. A `Flaw` names `func`, the `offset` of an
opcode byte, and a `kind`: `Opcode`, `Truncated`, `Constant`, `Local`,
`Function`, `Arity`, `Jump`, `Depth`. Report by function, then offset.

Walk a body over the widths the interpreter reads. A byte that is no opcode is
`Opcode`, operands past the end are `Truncated`; either ends that body, whose
stack goes unread.

Otherwise one flaw per instruction, first that holds, `Depth` last of all.
`Constant` for an index past the pool, or a dictionary key on a non-string.
`Local` for a slot at or past what the frame holds. A frame holds parameters
plus locals, plus one for the capture when some `NEW_CLOSURE` names it.
`Function` past the function table, `Arity` where the callee declares
otherwise. `Jump` for an offset, counted from the instruction after it,
landing where none begins. A body's end, one past its last byte, is a place to
land.

`Depth` is the value stack, one for the whole program. A function is entered
holding what a call to it left once its arguments come off; nothing reaching
it means empty, and two calls arriving at different depths is a flaw at its
first byte. Inside a body carry depths along every edge; each opcode takes and
leaves what the opcode reference documents. Returning drains the stack, so
depth after a call is one. An invocation reads a slot beneath its arguments
and settles nothing about its target. Report the lowest offset where paths
meet holding different amounts, or a body reads under empty or pushes past
512.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
