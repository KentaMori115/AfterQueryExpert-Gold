`chunk_load` proves an image's shape and stops: code inside a function
descriptor is a byte string it never opens. Add `verify` beside it, where
`chunk_verify(&Chunk) -> Vec<Flaw>` reads that code. A `Flaw` names `func`, the
`offset` of an opcode byte, and a `kind`, one `FlawKind` of `Opcode`,
`Truncated`, `Constant`, `Local`, `Function`, `Arity`, `Jump`, `Depth`. Report them by
function, then by offset.

Walk a body forward from its first byte, over the operand widths the
interpreter reads. A byte that is no opcode is `Opcode`, operands running past
the end are `Truncated`, either ends that body: what follows is not known
code, and its stack goes unread.

Otherwise one flaw per instruction, first of these that holds. `Opcode` again
for a `NEW_OBJ` kind above 2. `Constant` for an index past the pool, or a
dictionary key naming a non-string constant. `Local` for a slot at or past what
the frame holds: parameters plus locals, and one more for any function a
`NEW_CLOSURE` names. `Function` for an index past the function table, `Arity`
for a call passing what the callee does not declare. `Jump` for an offset,
counted from the instruction after the jump, landing where none begins. Body length is a landing place, since falling off the end
returns.

`Depth` is the value stack. Read every function on its own, entered empty,
carrying depths along every edge; each opcode takes and leaves what the opcode
reference documents. Returning drains the stack, so depth after a call is one,
and an invocation reads a slot beneath its arguments. Report the lowest offset
where paths meet holding different amounts, or a body reads under empty or
pushes past 512.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
