`chunk_load` proves an image's shape and stops: code inside a function
descriptor is a byte string it never opens. Add `verify` beside it, where
`chunk_verify(&Chunk) -> Vec<Flaw>` reads it. A `Flaw` names `func`, the
`offset` of an opcode byte, and a `kind`, one `FlawKind` of `Opcode`,
`Truncated`, `Constant`, `Local`, `Function`, `Arity`, `Jump`, `Depth`. Report
them by function, then by offset.

Walk a body from its first byte, over the operand widths the interpreter
reads. A byte that is no opcode is `Opcode`, operands past the end are
`Truncated`, either ends that body, and its stack goes unread.

Otherwise one flaw per instruction, first of these that holds. `Opcode` again
above `NEW_OBJ` kind 2. `Constant` past the pool, or a dictionary key on a
non-string constant. `Local` at or past what the frame holds: parameters plus
locals, one more for any function a `NEW_CLOSURE` names. `Function` past
the function table, `Arity` where a callee declares otherwise. `Jump` counted
from the instruction after it, landing where none begins. Body length lands,
since falling off the end returns.

`Depth` is the value stack. Read every function alone, entered empty, carrying
depths along every edge; each opcode takes and leaves what the opcode reference
documents. Returning drains the stack, so depth after a call is one,
and an invocation reads a slot beneath its arguments. Report the lowest offset where paths meet
holding different amounts, or a body reads under empty or pushes past 512.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
