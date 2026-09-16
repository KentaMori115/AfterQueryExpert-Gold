# skald

**skald** is an embeddable, garbage-collected bytecode scripting engine written in
Rust. It compiles a small dynamically-typed scripting language to a compact binary
bytecode format, then executes that bytecode on a stack-based virtual machine with a
reference-counted object heap and a tri-color mark-and-sweep garbage collector.

The project is designed to be small and self-contained: the whole engine builds from a
clean checkout with no network access, no system dependencies beyond the Rust standard
library, and no configuration. Every entry point that reads outside data — the lexer,
the chunk loader, the interpreter, the collector, and the JSON codec — is total, so it
answers on any input rather than trusting its caller.

skald began life as a C engine and was ported to Rust module-for-module; the
architecture, bytecode format, and object model are preserved from that lineage, which
is why the codebase reads like a systems-language runtime rather than idiomatic
high-level Rust in its hot paths.

---

## Table of contents

1. Feature overview
2. Architecture
3. Repository layout
4. Building and running
5. The skald language
6. Bytecode format
7. Opcode reference
8. Chunk audit
9. The value model
10. Memory management
11. The virtual machine
12. Embedding skald
13. Standard library reference
14. Data-structure subsystem
15. Utility subsystem
16. JSON subsystem
17. Testing
18. Design notes
19. Frequently asked questions

---

## Feature overview

- Dynamically typed values: null, 64-bit integers, 64-bit floats, and heap objects (strings, arrays, dictionaries, and closures).
- Compact binary bytecode with a versioned header, a constant pool, and a function table, all little-endian.
- Stack-based virtual machine with fixed-size value and call stacks, structured call frames, and 39 opcodes.
- Hybrid memory management: eager reference counting backed by a tri-color mark-and-sweep collector that reclaims cycles.
- A hand-written lexer supporting the full operator set, numeric bases, string and char literals with escapes, and comments.
- A batteries-included standard library: arrays, strings, math, matrices, JSON, hashing, regular expressions, globbing, CSV.
- A rich data-structure toolkit: deque, priority queue, hash set, skip list, B-tree, red-black tree, trie, graph, and more.
- Deterministic, sandbox-safe builds: no clock reads on hot paths, no environment access, no network, no filesystem writes.

---

## Architecture

At a high level, untrusted input flows through the engine in one of two ways: as
source text that is lexed and (in a full deployment) compiled to bytecode, or as
pre-compiled bytecode that is loaded directly. Both converge on the virtual machine,
which manipulates values on the heap under the supervision of the garbage collector.

```
        source bytes                    bytecode bytes
             |                                |
             v                                v
        +---------+                     +-----------+
        |  lexer  |                     |  loader   |   (bytecode.rs)
        +----+----+                     +-----+-----+
             |  tokens                        |  Chunk
             v                                v
        +---------+                     +-----------+
        | compiler| ------------------> |    VM     |   (vm.rs)
        +---------+     bytecode        +-----+-----+
                                              |
                        values / refcounts    v
                                        +-----------+
                                        |   heap    |   (heap.rs)
                                        +-----+-----+
                                              |  tracked objects
                                              v
                                        +-----------+
                                        |    gc     |   (gc.rs)
                                        +-----------+
```

Each box corresponds to a Rust module. The arrows show data flow, not control flow: the
VM calls into the heap on every object operation, and the heap notifies the collector
as objects are created and destroyed.

The subsystems are deliberately decoupled. The lexer knows nothing about the VM; the
loader produces a Chunk that is just data; the heap exposes reference-counting
primitives that the VM drives explicitly. This separation is what lets each piece be
tested on its own.

---

## Repository layout

```
skald/
  Cargo.toml               crate manifest (library + skald binary)
  README.md                this document
  src/
    lib.rs                 crate root; re-exports every subsystem
    value.rs               the tagged Value type
    heap.rs                reference-counted object heap
    gc.rs                  tri-color mark-and-sweep collector
    bytecode.rs            binary chunk format and loader
    verify/                static audit of a loaded chunk
    lexer.rs               tokenizer for the surface language
    vm.rs                  stack-based bytecode interpreter
    json.rs                JSON parser, serializer, validator
    symbol.rs              symbol interning table
    display.rs             human-readable value rendering
    bin/skald.rs           command-line driver
    ds/                    data-structure subsystem
    util/                  hashing, bitsets, sorting, UTF-8, RNG, checksums
    stdlib/                native standard-library functions
  tests/                   integration suites, one per subsystem
  .github/workflows/       build-and-test workflow
```

---

## Building and running

skald builds with a stable Rust toolchain:

```
cargo build --release
cargo test
```

The skald binary is a small driver over the library:

```
skald run <file.skc>       execute a compiled bytecode chunk
skald lex <file>           tokenize a source file and print a token count
skald json <file>          parse a JSON file and report validity
skald validate <file>      load a chunk and audit its code
```

---

## The skald language

The surface language is a small, C-flavored scripting language. A program is a sequence
of function definitions; execution begins at a designated entry function. The lexer in
lexer.rs recognizes the following lexical elements.

### Comments

```
// line comment
/* block comment, which may /* nest */ arbitrarily */
```

### Identifiers and keywords

Identifiers begin with a letter or underscore and continue with letters, digits, or
underscores. The following words are reserved:

```
let var const fn return if else elif while for in break continue
match case default class extends new self super import from as export
try catch finally throw async await yield null true false and or not is
typeof void instanceof delete sizeof
```

### Numeric literals

Integers may be written in decimal, hexadecimal (0x), binary (0b), or octal (0o), and
may contain underscores as digit separators:

```
42        0xFF      0b1010    0o755     1_000_000
```

Floating-point literals support a fractional part and an exponent:

```
3.14      1e10      1.5e-3    6.022_140e23
```

### String and character literals

Strings may be single-line, triple-quoted multi-line, or raw (no escape processing).
The escape set includes newline, carriage return, tab, backslash, quotes, NUL, and the
hex and Unicode forms xNN, uNNNN, and UNNNNNNNN.

### Operators

skald recognizes the full complement of arithmetic, comparison, logical, bitwise, and
assignment operators, along with compound forms, increment/decrement, ranges, arrows,
and member access. Operator precedence is defined by the lexer's precedence table, from
logical or (loosest) up through multiplicative operators and ranges (tightest).

---

## Bytecode format

A compiled program is a chunk: a little-endian binary blob parsed by chunk_load in
bytecode.rs. The layout is:

```
  offset  size  field
  ------  ----  -----
  0       4     magic bytes S K L D
  4       1     format version (currently 1)
  5       2     number of constants (u16 LE)
  7       2     number of functions (u16 LE)
  9       2     entry function index (u16 LE)
  11      ...   constant pool
  ...     ...   function table
```

### Constant pool

Each constant begins with a one-byte tag:

```
  tag 0  INT     8 bytes, i64 little-endian
  tag 1  FLOAT   8 bytes, IEEE-754 double
  tag 2  STRING  2-byte length (u16 LE) followed by that many raw bytes
  tag 3  NULL    no payload
```

String constants are capped at 4096 bytes by the loader; any longer declaration is
rejected as malformed.

### Function table

Each function descriptor is:

```
  offset  size  field
  ------  ----  -----
  0       2     name constant index (i16, -1 = anonymous)
  2       1     parameter count (u8)
  3       1     local count (u8, excludes parameters)
  4       2     code length (u16 LE)
  6       ...   raw bytecode (code length bytes)
```

The loader validates that parameter counts do not exceed 32 and local counts do not
exceed 64, and that every declared length fits within the remaining input. A chunk with
zero functions, or an entry index outside the function table, is rejected.

---

## Opcode reference

The virtual machine understands the following opcodes. Operands are read from the
instruction stream immediately after the opcode byte.

```
  0x00  NOP           no operation
  0x01  HALT          stop execution
  0x02  PUSH_CONST    u16 const index; push that constant
  0x03  PUSH_INT      i32 immediate; push as an integer
  0x04  PUSH_NULL     push null
  0x05  POP           pop and discard the top of stack
  0x06  DUP           duplicate the top of stack
  0x07  LOAD          u8 local index; push that local
  0x08  STORE         u8 local index; pop into that local
  0x09  NEW_OBJ       u8 kind (0 dict, 1 array, 2 string); push a new object
  0x0A  ARRAY_PUSH    pop value, append to array on top
  0x0B  ARRAY_GET     pop index and array, push element
  0x0C  ARRAY_LEN     replace array on top with its length
  0x0D  DICT_SET      u16 key const; pop value, set into dict on top
  0x0E  DICT_GET      u16 key const; pop dict, push value
  0x0F  CALL          u16 function index, u8 arg count; invoke function
  0x10  RETURN        return the top of stack to the caller
  0x11  NEW_CLOSURE   u16 function index, u8 captured local; push a closure
  0x12  INVOKE        u8 arg count; call a closure on the stack
  0x13  ADD           pop b, a; push a + b
  0x14  SUB           pop b, a; push a - b
  0x15  MUL           pop b, a; push a * b
  0x16  DIV           pop b, a; push a / b
  0x17  MOD           pop b, a; push a % b
  0x18  EQ            pop b, a; push a == b
  0x19  LT            pop b, a; push a < b
  0x1A  LE            pop b, a; push a <= b
  0x1B  NOT           logical negation of the top of stack
  0x1C  NEG           arithmetic negation of the top of stack
  0x1D  JMP           i16 offset; unconditional relative jump
  0x1E  JMP_TRUE      i16 offset; jump if the popped value is truthy
  0x1F  JMP_FALSE     i16 offset; jump if the popped value is falsy
  0x20  JMP_NULL      i16 offset; jump if the popped value is null
  0x21  CONCAT        pop b, a; push the concatenation of two strings
  0x22  PRINT         pop and (in a hosting build) print the top of stack
  0x23  TYPE_OF       replace the top of stack with its type name string
  0x24  INCREF        increment the refcount of the object on top
  0x25  DECREF        pop and decrement the refcount of an object
  0x26  GC            trigger a garbage collection
```

Unknown opcodes cause the VM to stop with a bad-opcode status rather than executing
undefined behavior.

---

## Chunk audit

Loading a chunk proves its shape, not its contents. `chunk_load` reads the
header, the pool and one descriptor per function, and stops there: the code
those descriptors carry is a byte string it never opens. So an image that loads
can still hold a byte that is not an opcode, a jump landing between two
instructions, a call passing three arguments to a function taking two, or a
body whose stack depth depends on which branch ran. The interpreter meets those
one at a time, on whichever path execution takes, and answers with a status
that says what went wrong but not where.

`verify::chunk_verify` reads the image ahead of time instead:

```
use skald::bytecode::chunk_load;
use skald::verify::chunk_verify;

let chunk = chunk_load(&bytes).expect("loads");
for flaw in chunk_verify(&chunk) {
    println!("function {} at {}: {:?}", flaw.func, flaw.offset, flaw.kind);
}
```

Every flaw names a function, the offset of an opcode byte inside it, and one of
eight kinds:

```
  Opcode      a byte that is not an opcode at all
  Truncated   operands running past the end of the code
  Constant    a constant index past the pool, or a dict key that is not a string
  Local       a local slot at or past the count the frame will hold
  Function    a function index past the function table
  Arity       a call passing arguments the callee does not declare
  Jump        a target outside the body, or between two instructions
  Depth       the value stack under- or overflows, or two paths disagree
```

A body is read from its first byte forward, so an unknown or truncated
instruction ends the walk there: nothing after it is known to be code. Every
other check reads one decoded instruction, and reports at most the first thing
wrong with it, in the order above.

The stack reading is the part that cannot be done a body at a time. There is
one value stack for the whole program: entering a function takes its arguments
off whatever the caller was holding and leaves the rest where it sits, so a
callee begins as deep as its caller left it. Working that out means reading the
callers first, and what they leave depends on reading their callers, so the
audit settles the starting depths by iteration and then reads each body from
the depth it found. A function no reachable call names is read from an empty
stack, which is how the interpreter enters the entry function and the only
reading available for one nothing arrives at. Two calls arriving at different
depths is itself worth reporting: the body is then correct for one caller and
wrong for the other.

Inside a body, depths travel along every edge, which is how a branch that
leaves one value and a branch that leaves two are caught meeting. A call is a
special case in both directions: returning from a frame drains the value stack
and pushes the result, so whatever the caller had is gone and the depth after
any call is one.

A short flawed image and what comes back:

```
  offset  bytes             what it is
  ------  ----------------  -------------------------------------------
  0       04                PUSH_NULL
  1       1F 01 00          JMP_FALSE, over one byte
  4       C3                a byte no opcode uses
  5       01                HALT
```

```
  0 4 opcode      the byte the walk stopped at
```

The jump is fine: it lands on the halt, which begins an instruction. The byte
before it is not, and the walk ends there, so the stack is never read.

The audit is advisory. Nothing in the loader or the interpreter consults it,
and a chunk it finds nothing wrong with is not thereby safe: type errors,
division by zero and runaway recursion are all run-time facts. What it removes
is the class of faults that are visible in the image itself.

Nor does it read past what a chunk records. An invocation's target is a value
rather than an operand, so a function reached only through a closure has no
call the audit can read a starting depth from, and it is read from empty like
any other function nothing arrives at. A body that is only correct given a
caller the audit cannot see is reported, which is one reason the report is
advice rather than a gate.

---

## The value model

A Value (see value.rs) is a tagged union of four cases:

```
  Null            the absence of a value
  Int(i64)        a 64-bit signed integer
  Float(f64)      a 64-bit IEEE-754 float
  Obj(pointer)    a reference to a heap object
```

Values are Copy: passing one around copies the tag and payload. For object values the
payload is a pointer, so copying a value does not copy the underlying object and does
not by itself adjust its reference count; ownership is tracked explicitly by the VM and
the heap's incref/decref routines.

Numeric coercion rules: integer/float mixed arithmetic promotes to float; equality
compares across the integer/float boundary by value. Truthiness treats null, integer
zero, and float zero as false and everything else as true.

Heap objects come in four kinds, each with a common header (an object-type tag and a
reference count) followed by kind-specific fields:

- String: a length-prefixed byte buffer.
- Array: a growable vector of values.
- Dict: a separately-chained hash map from byte-string keys to values.
- Closure: a function index plus a single captured value.

---

## Memory management

skald uses reference counting as its primary reclamation strategy. Every object is
created with a reference count of one. The VM increments the count when a value is
pushed onto the stack or stored into a local, and decrements it when a value is popped
or overwritten. When a count reaches zero the object's storage is released immediately,
and any values it contained are themselves decremented.

Reference counting alone cannot reclaim cycles. To handle this, skald also runs a
tri-color mark-and-sweep collector (gc.rs).

### The collector

Every tracked object is enrolled in a doubly-linked list of collector nodes. Roots (the
VM's value stack and the locals of every active call frame) are registered with the
collector through a root-scanner callback. A collection proceeds in phases:

1. Paint white. Every tracked object is marked white (unreached).
2. Gray the roots. Each root object is marked gray and pushed onto a work queue.
3. Trace. Objects are popped from the gray queue, marked black, and their children
   grayed, until the queue is empty.
4. Sweep. Every object still white is unreachable and is freed.

The collector supports an incremental mode, in which the gray queue is drained a bounded
number of steps at a time, interleaved with the mutator, and a write barrier re-grays
black objects that acquire new white children mid-cycle. A configurable byte threshold
triggers automatic collection as allocation pressure grows.

### Interaction between the two strategies

The reference counter and the collector share the same objects. The reference counter
reclaims the common case promptly; the collector is a backstop for cycles. The two must
agree on ownership, which is why object destruction notifies the collector to untrack
the object, and why collector teardown routes object destruction back through the
reference-counting path.

---

## The virtual machine

The VM (vm.rs) is a straightforward stack machine. Its state consists of a value stack
of up to 512 slots, a call stack of up to 64 frames, a pointer to the loaded chunk, a
status code, and a handle to the garbage collector.

Each call frame holds the index of its function, an instruction pointer, a local-slot
count, and up to 96 local slots (parameters, declared locals, and an optional captured
upvalue). Calling a function pushes a frame and moves arguments from the caller's stack
into the callee's locals; returning pops the frame, releases its locals, and hands the
return value back to the caller.

The dispatch loop reads one opcode at a time and switches on it. Arithmetic opcodes pop
their operands, compute a result, release the operands, and push the result. Object
opcodes construct or mutate heap objects, tracking each new object with the collector
and balancing reference counts as values move on and off the stack. Control-flow
opcodes adjust the instruction pointer by a signed offset.

When the VM finishes, cleanup clears the stack and locals, runs a final collection, and
tears down the collector.

---

## Embedding skald

The top-level entry point is vm::vm_exec, which takes a byte slice, loads it as a chunk,
runs it, and tears down the VM:

```
use skald::vm::vm_exec;
let status = vm_exec(&bytecode);
```

Lower-level access is available for hosts that want to inspect intermediate state:
bytecode::chunk_load returns a parsed Chunk; Vm::init constructs a VM over a chunk;
Vm::run executes it; Vm::cleanup releases it. The heap and collector APIs are public so
that a host can build objects and drive collection directly.

---

## Standard library reference

The stdlib subsystem provides native functions and helpers. The reference below is
generated from the actual public signatures.

### stdlib::array

```
  length(argv: &[Value])
  is_empty(argv: &[Value])
  get(argv: &[Value])
  push(argv: &[Value])
  pop(argv: &[Value])
  reverse(argv: &[Value])
  concat(argv: &[Value])
  slice(argv: &[Value])
  index_of(argv: &[Value])
  includes(argv: &[Value])
  sum(argv: &[Value])
  from_range(argv: &[Value])
  min(argv: &[Value])
  max(argv: &[Value])
```

### stdlib::base32

```
  encode(data: &[u8])
  decode(text: &[u8])
```

### stdlib::buffer

```
  new()
  len(&self)
  is_empty(&self)
  as_bytes(&self)
  take(self)
  u8(&mut self, v: u8)
  u16_le(&mut self, v: u16)
  u16_be(&mut self, v: u16)
  u32_le(&mut self, v: u32)
  u32_be(&mut self, v: u32)
  u64_le(&mut self, v: u64)
  u64_be(&mut self, v: u64)
  f64_le(&mut self, v: f64)
  bytes(&mut self, data: &[u8])
  varint(&mut self, mut v: u64)
  new(buf: &'a [u8])
  pos(&self)
  remaining(&self)
  at_end(&self)
  u8(&mut self)
  u16_le(&mut self)
  u16_be(&mut self)
  u32_le(&mut self)
  u32_be(&mut self)
  u64_le(&mut self)
  f64_le(&mut self)
  take(&mut self, n: usize)
  varint(&mut self)
```

### stdlib::crypto

```
  sha256(data: &[u8])
  sha256_hex(data: &[u8])
  base64_encode(data: &[u8])
  base64_decode(text: &[u8])
  crc32(data: &[u8])
```

### stdlib::csv

```
  parse(data: &[u8])
  write(rows: &[Vec<Vec<u8>>])
  max_columns(rows: &[Vec<Vec<u8>>])
```

### stdlib::datetime

```
  is_leap_year(year: i64)
  days_in_month(year: i64, month: u32)
  from_timestamp(mut ts: i64)
  to_timestamp(dt: DateTime)
  weekday(ts: i64)
  format_iso(dt: DateTime)
  day_of_year(dt: DateTime)
```

### stdlib::fmt

```
  to_radix(mut v: u64, base: u32)
  i64_to_radix(v: i64, base: u32)
  from_radix(text: &[u8], base: u32)
  pad_left(s: &[u8], width: usize, pad: u8)
  pad_right(s: &[u8], width: usize, pad: u8)
  group_thousands(s: &[u8], sep: u8)
```

### stdlib::glob

```
  matches(pattern: &[u8], text: &[u8])
```

### stdlib::io

```
  split_lines(data: &[u8])
  join_lines(lines: &[Vec<u8>])
  count_lines(data: &[u8])
  new(data: &'a [u8])
  at_end(&self)
  next_line(&mut self)
  indent(text: &[u8], n: usize)
```

### stdlib::math

```
  abs(argv: &[Value])
  ceil(argv: &[Value])
  floor(argv: &[Value])
  round(argv: &[Value])
  trunc(argv: &[Value])
  sign(argv: &[Value])
  min(argv: &[Value])
  max(argv: &[Value])
  clamp(argv: &[Value])
  sqrt(argv: &[Value])
  cbrt(argv: &[Value])
  pow(argv: &[Value])
  exp(argv: &[Value])
  exp2(argv: &[Value])
  log(argv: &[Value])
  log2(argv: &[Value])
  log10(argv: &[Value])
  log_base(argv: &[Value])
  sin(argv: &[Value])
  cos(argv: &[Value])
  tan(argv: &[Value])
  asin(argv: &[Value])
  acos(argv: &[Value])
  atan(argv: &[Value])
  atan2(argv: &[Value])
  hypot(argv: &[Value])
  degrees(argv: &[Value])
  radians(argv: &[Value])
  gcd(argv: &[Value])
  lcm(argv: &[Value])
  factorial(argv: &[Value])
  is_prime(argv: &[Value])
  next_prime(argv: &[Value])
  fibonacci(argv: &[Value])
  choose(argv: &[Value])
  imod(argv: &[Value])
  bit_count(argv: &[Value])
  leading_zeros(argv: &[Value])
  trailing_zeros(argv: &[Value])
  isnan(argv: &[Value])
  isinf(argv: &[Value])
  isfinite(argv: &[Value])
  pi(_argv: &[Value])
  e(_argv: &[Value])
  phi(_argv: &[Value])
  tau(_argv: &[Value])
  lerp(argv: &[Value])
  smoothstep(argv: &[Value])
  int_sqrt(argv: &[Value])
  divisors(argv: &[Value])
  primes_up_to(argv: &[Value])
  exp10(argv: &[Value])
  sinh(argv: &[Value])
  cosh(argv: &[Value])
  tanh(argv: &[Value])
  asinh(argv: &[Value])
  acosh(argv: &[Value])
  atanh(argv: &[Value])
  int_log2(argv: &[Value])
  permutations(argv: &[Value])
  is_perfect(argv: &[Value])
  divmod(argv: &[Value])
  cubic_bezier_t(argv: &[Value])
  hypot3(argv: &[Value])
```

### stdlib::matrix

```
  new(rows: usize, cols: usize)
  identity(n: usize)
  from_rows(rows: &[Vec<f64>])
  get(&self, i: usize, j: usize)
  set(&mut self, i: usize, j: usize, v: f64)
  add(&self, other: &Matrix)
  sub(&self, other: &Matrix)
  mul(&self, other: &Matrix)
  scale(&self, s: f64)
  transpose(&self)
  trace(&self)
  det(&self)
```

### stdlib::os

```
  join(a: &[u8], b: &[u8])
  basename(path: &[u8])
  dirname(path: &[u8])
  extension(path: &[u8])
  stem(path: &[u8])
  is_absolute(path: &[u8])
  components(path: &[u8])
  normalize(path: &[u8])
```

### stdlib::regex

```
  compile(pattern: &[u8])
  is_match(&self, text: &[u8])
  match_at(&self, text: &[u8], start: usize)
```

### stdlib::string

```
  byte_length(argv: &[Value])
  length(argv: &[Value])
  upper(argv: &[Value])
  lower(argv: &[Value])
  trim(argv: &[Value])
  reverse(argv: &[Value])
  concat(argv: &[Value])
  repeat(argv: &[Value])
  contains(argv: &[Value])
  starts_with(argv: &[Value])
  ends_with(argv: &[Value])
  index_of(argv: &[Value])
  to_int(argv: &[Value])
  to_float(argv: &[Value])
  from_int(argv: &[Value])
  encode_hex(argv: &[Value])
  is_digit(argv: &[Value])
  is_alpha(argv: &[Value])
  compare(argv: &[Value])
  split(argv: &[Value])
```

### stdlib::text

```
  title_case(s: &[u8])
  swap_case(s: &[u8])
  pad_left(s: &[u8], width: usize, pad: u8)
  pad_right(s: &[u8], width: usize, pad: u8)
  center(s: &[u8], width: usize, pad: u8)
  count_occurrences(hay: &[u8], needle: &[u8])
  replace_all(hay: &[u8], needle: &[u8], replacement: &[u8])
  trim_chars(s: &[u8], chars: &[u8])
  join(parts: &[Vec<u8>], sep: &[u8])
  edit_distance(a: &[u8], b: &[u8])
```

---

## Data-structure subsystem

The ds subsystem is a collection of standalone containers, each in its own module. They
store either opaque u64 tokens (standing in for host pointers) or integer keys and
values, and none of them depend on the object heap, which makes them easy to test in
isolation.

### ds::btree

```
  new()
  size(&self)
  is_empty(&self)
  lookup(&self, key: i64)
  contains(&self, key: i64)
  insert(&mut self, key: i64, val: u64)
  in_order(&self)
  range(&self, lo: i64, hi: i64)
```

### ds::deque

```
  new(initial_cap: usize)
  len(&self)
  is_empty(&self)
  clear(&mut self)
  push_front(&mut self, elem: u64)
  push_back(&mut self, elem: u64)
  pop_front(&mut self)
  pop_back(&mut self)
  peek_front(&self)
  peek_back(&self)
  get(&self, idx: usize)
  set(&mut self, idx: usize, elem: u64)
  rotate_left(&mut self, n: usize)
  rotate_right(&mut self, n: usize)
  to_vec(&self)
```

### ds::fenwick

```
  new(n: usize)
  len(&self)
  is_empty(&self)
  add(&mut self, i: usize, delta: i64)
  prefix_sum(&self, i: usize)
  range_sum(&self, lo: usize, hi: usize)
```

### ds::graph

```
  new(num_vertices: usize, directed: bool)
  num_vertices(&self)
  add_vertex(&mut self)
  add_edge(&mut self, from: usize, to: usize, weight: i64)
  degree(&self, v: usize)
  neighbors(&self, v: usize)
  bfs(&self, start: usize)
  dfs(&self, start: usize)
  dijkstra(&self, src: usize)
  topo_sort(&self)
  connected_components(&self)
```

### ds::interval

```
  new()
  len(&self)
  is_empty(&self)
  insert(&mut self, lo: i64, hi: i64, data: u64)
  stab(&self, point: i64)
  overlaps(&self, lo: i64, hi: i64)
```

### ds::lru

```
  new(capacity: usize)
  len(&self)
  is_empty(&self)
  hits(&self)
  misses(&self)
  get(&mut self, key: &[u8])
  put(&mut self, key: &[u8], value: u64)
  contains(&self, key: &[u8])
  clear(&mut self)
```

### ds::pqueue

```
  new(initial_cap: usize)
  size(&self)
  is_empty(&self)
  push(&mut self, data: u64, priority: i64)
  pop(&mut self)
  peek(&self)
  update_priority(&mut self, target: u64, new_priority: i64)
  contains(&self, target: u64)
  to_sorted_vec(&self)
```

### ds::rbtree

```
  new()
  size(&self)
  is_empty(&self)
  insert(&mut self, key: i64, val: u64)
  lookup(&self, key: i64)
  contains(&self, key: i64)
  min_key(&self)
  max_key(&self)
  in_order(&self)
```

### ds::set

```
  new(initial_cap: usize)
  size(&self)
  is_empty(&self)
  load_factor(&self)
  contains(&self, key: &[u8])
  insert(&mut self, key: &[u8])
  remove(&mut self, key: &[u8])
  clear(&mut self)
  resize(&mut self, new_cap: usize)
  iter(&self)
```

### ds::skiplist

```
  new()
  size(&self)
  is_empty(&self)
  insert(&mut self, key: &[u8], value: u64)
  lookup(&self, key: &[u8])
  contains(&self, key: &[u8])
  floor_key(&self, query: &[u8])
  nth(&self, n: usize)
```

### ds::trie

```
  new()
  len(&self)
  is_empty(&self)
  insert(&mut self, key: &[u8], value: u64)
  get(&self, key: &[u8])
  contains(&self, key: &[u8])
  has_prefix(&self, prefix: &[u8])
  keys_with_prefix(&self, prefix: &[u8])
```

### ds::unionfind

```
  new(n: usize)
  len(&self)
  is_empty(&self)
  components(&self)
  find(&mut self, x: usize)
  union(&mut self, a: usize, b: usize)
  connected(&mut self, a: usize, b: usize)
```

---

## Utility subsystem

The util subsystem holds pure, allocation-light helpers used throughout the engine:
hash functions, bitsets, sorting and searching, UTF-8 handling, string building, arena
allocation, deterministic random-number generation, and checksums.

### util::arena

```
  new(initial_block_size: usize)
  alloc(&mut self, size: usize)
  alloc_zeroed(&mut self, size: usize)
  push_align(&mut self, size: usize, align: usize)
  strdup(&mut self, s: &[u8])
  write(&mut self, r: ArenaRef, data: &[u8])
  read(&self, r: ArenaRef)
  checkpoint(&self)
  restore(&mut self, cp: ArenaCheckpoint)
  reset(&mut self)
  usage(&self)
  capacity(&self)
  num_blocks(&self)
```

### util::bitset

```
  new(num_bits: usize)
  clone_from(src: &Bitset)
  resize(&mut self, new_bits: usize)
  num_bits(&self)
  set(&mut self, idx: usize)
  clear(&mut self, idx: usize)
  toggle(&mut self, idx: usize)
  get(&self, idx: usize)
  set_range(&mut self, start: usize, end: usize)
  clear_range(&mut self, start: usize, end: usize)
  toggle_range(&mut self, start: usize, end: usize)
  and_into(a: &Bitset, b: &Bitset, out: &mut Bitset)
  or_into(a: &Bitset, b: &Bitset, out: &mut Bitset)
  xor_into(a: &Bitset, b: &Bitset, out: &mut Bitset)
  not_into(a: &Bitset, out: &mut Bitset)
  popcount(&self)
  find_first_set(&self)
  find_next_set(&self, from: usize)
  find_first_clear(&self)
  is_subset(&self, b: &Bitset)
  equals(&self, b: &Bitset)
  to_string(&self)
  new(num_bits: usize)
  set(&mut self, idx: usize)
  clear(&mut self, idx: usize)
  toggle(&mut self, idx: usize)
  get(&self, idx: usize)
  popcount(&self)
  find_first_set(&self)
```

### util::checksum

```
  adler32(data: &[u8])
  fletcher16(data: &[u8])
  fletcher32(data: &[u8])
  luhn_valid(digits: &[u8])
```

### util::hash

```
  fnv1a_32(data: &[u8])
  fnv1a_64(data: &[u8])
  djb2(data: &[u8])
  sdbm(data: &[u8])
  murmur3_32(data: &[u8], seed: u32)
  crc32(data: &[u8])
  xxhash32(data: &[u8], seed: u32)
  combine(h1: u64, h2: u64)
  hash_string(s: &[u8])
  hash_int64(v: i64)
  siphash_2_4(data: &[u8], key: [u64; 2])
```

### util::random

```
  new(seed: u64)
  next_u64(&mut self)
  new(seed: u64)
  next_u64(&mut self)
  below(&mut self, bound: u64)
  next_f64(&mut self)
  shuffle(&mut self, items: &mut [u32])
```

### util::sort

```
  is_sorted(a: &[i64])
  insertion_sort(a: &mut [i64])
  quicksort(a: &mut [i64])
  merge_sort(a: &mut [i64])
  heap_sort(a: &mut [i64])
  binary_search(a: &[i64], target: i64)
  lower_bound(a: &[i64], target: i64)
```

### util::strbuf

```
  new(initial_cap: usize)
  len(&self)
  cap(&self)
  is_empty(&self)
  clear(&mut self)
  append_char(&mut self, c: u8)
  append_bytes(&mut self, s: &[u8])
  append_str(&mut self, s: &str)
  append_int(&mut self, v: i64)
  append_uint(&mut self, v: u64)
  append_float(&mut self, v: f64, precision: usize)
  prepend_str(&mut self, s: &str)
  insert(&mut self, pos: usize, s: &[u8])
  erase(&mut self, pos: usize, len: usize)
  replace_all(&mut self, needle: &[u8], replacement: &[u8])
  trim(&mut self)
  trim_left(&mut self)
  trim_right(&mut self)
  to_upper(&mut self)
  to_lower(&mut self)
  reverse(&mut self)
  as_bytes(&self)
  to_vec(&self)
  clone_buf(&self)
  cmp(&self, other: &StrBuf)
  reserve(&mut self, new_cap: usize)
```

### util::utf8

```
  decode_at(bytes: &[u8], i: usize)
  encode(cp: u32, out: &mut [u8; 4])
  validate(bytes: &[u8])
  char_count(bytes: &[u8])
  to_codepoints(bytes: &[u8])
  encoded_len(cp: u32)
```

---

## JSON subsystem

json.rs is a complete JSON implementation: a recursive-descent parser that builds heap
value trees, a serializer with compact and pretty-printed modes, a tree-free validator,
and a minifier. The parser enforces a maximum nesting depth of 256, handles full string
escapes including surrogate pairs, and rejects trailing content after a complete
document. Numbers become integers where they are integral and floats otherwise.

The validator reuses the same tokenization logic but discards values as it goes, so a
document can be checked for well-formedness without allocating a value tree.

---

## Testing

The suites under tests/ cover the engine one subsystem at a time. integration.rs takes
the safe, self-contained modules: every data structure, the utility helpers, and the
cryptographic routines against published known-answer vectors. gc_lifetime.rs drives the
reference-counted heap and the collector through rooting, cycles, incremental stepping
and multi-context reclamation. bytecode_loader.rs and vm_execution.rs work the binary
format and the interpreter, including every truncation and single-byte mutation of a
well-formed image. text_formats.rs round-trips JSON and pushes the tokenizer through
source it cannot read. The remaining files cover the varint codec, the ring buffer, the
Bloom filter, the metrics registry and the diagnostics report. Run everything with
cargo test.

---

## Design notes

Why reference counting and tracing? Reference counting gives prompt, predictable
reclamation for the overwhelmingly common acyclic case, which keeps peak memory low and
avoids long pauses. Tracing is retained purely to collect cycles, which reference
counting cannot. The combination is a pragmatic middle ground for a scripting runtime.

Why a stack machine? A stack-based bytecode is compact and simple to generate and to
interpret. It keeps the instruction encoding small, which in turn keeps compiled chunks
small.

Why raw pointers in the hot path? The engine was ported from C, where objects are
referenced by raw pointer and lifetimes are managed by hand through reference counting.
Preserving that model keeps the port faithful and the object representation compact, at
the cost of concentrating the unsafe reasoning in the heap and collector modules.

Why is the chunk audit advisory rather than a gate? Refusing to run an image
the audit dislikes would make the engine less useful, not safer: the audit
reads every path a body has, including ones execution never takes, and it reads
a function nothing calls as if it were entered with an empty stack, which is a
convention rather than a fact. An embedder that wants a gate can make one out of it in a
line. Wiring it into the loader would take that choice away, and would put a
whole-image analysis in front of every chunk that loads.

Why so many self-contained utilities? A scripting engine needs a broad standard library.
Implementing these directly, rather than pulling in dependencies, keeps the build
hermetic, deterministic, and free of network access, which is a hard requirement
wherever the engine is embedded.

---

## Frequently asked questions

Is skald production-ready? No. It is a compact, self-contained engine intended for
experimentation and teaching. It prioritizes clarity and hermeticity over raw
performance or completeness.

Does the build touch the network? No. There are no remote dependencies, no downloads,
and no registry access beyond what an offline cargo build requires.

Can I run untrusted bytecode safely? The loader validates structural bounds, and the VM
rejects malformed opcodes and out-of-range indices, but skald is a research engine and
makes no formal sandboxing guarantees. Treat a chunk from an untrusted source the way
you would treat any other untrusted input.

What character encoding do strings use? Strings are byte buffers. Most of the string
library treats them as UTF-8 where it matters, but the underlying storage is raw bytes,
so arbitrary binary data round-trips cleanly.

How do I add a new opcode? Add a constant in bytecode.rs, handle it in the VM's dispatch
loop in vm.rs, and, if it constructs objects, remember to track them with the collector
and balance their reference counts as they move on and off the stack.

How do I add a standard-library function? Implement it in the appropriate stdlib module
with the native-function signature, taking a slice of argument values and returning a
value. Host-side helpers that do not need the value protocol can use any signature.

