# Source locations

Every finding raised while loading or compiling a production says where in
the authored text the problem sits. `Finding.source` is a `SourceRef` with
`path`, `line` and `column`; it is `None` for findings that are not about an
authored node.

## Path

| Production given as | `path` |
|---|---|
| one file | the path as given, `\` turned into `/`, any leading `./` dropped |
| a workspace directory | the file's path relative to the workspace root, `/` separated |

The manifest itself is `cueforge.yaml` (or `.yml`, `.json`); a source file
listed as `cues/lighting.yaml` keeps that name.

## Line and column

Both are 1-based. They mark the first character of the node as it is written:

| Node | Points at |
|---|---|
| JSON object or array | the `{` or `[` |
| YAML block mapping | its first key |
| YAML block sequence | the first `-` |
| YAML flow mapping or sequence | the `{` or `[` |
| quoted scalar | the opening quote |
| plain scalar or JSON token | its first character |
| anchored node (`&name` in front) | its content: the anchor names the node, the node opens after it |

Line endings are normalised before parsing, so `\r\n` files count the same
lines and columns as `\n` files. Columns count characters, not bytes, and a
JSON escape such as `é` occupies the six characters it is written with.

## Anchors and aliases

An anchor is a name, not text: `&lead` on a line of its own leaves the cue
mapping opening at its first key, `&t {at: 0}` opens at the `{`, and
`&ref "ghost"` opens at the quote.

A node reached through an alias points at the `*alias`, and so does
everything inside it: keys, values, the lot. The finding names the place the
author wrote the reuse, because the anchored text is right where it was
written and the reuse is what put it here. When an alias sits inside another
alias, the outermost one is the place the author wrote, so that is where the
finding points. Every reuse gets its own finding, each at its own alias.

A worked example, with the finding each line draws when `at` must be a
whole number of milliseconds:

```yaml
cues:
  - id: a
    department: lx
    trigger: {at: &x 1.5}      # a.at points at "1.5", line 4 column 22
  - id: b
    department: lx
    trigger: &tr {at: *x}      # b.at points at "*x", line 7 column 23
  - id: c
    department: lx
    trigger: *tr               # c.at points at "*tr", line 10 column 14
```

The first cue wrote the value, so its finding points at the value; the
anchor `&x` in front of it is not part of the node. The second cue reused
the value by alias, and its finding points at that alias rather than back at
line 4. The third cue reused a mapping that itself holds an alias, and its
finding points at `*tr`, the outermost reuse, not at the `*x` inside it.

Keys are treated the same way. An unknown field inside an aliased mapping
points at the alias, because the key is not written where the alias is.

```yaml
cues:
  - &lead
    id: lead
    department: lx
    trigger: &t {at: 0, bogus: 1}   # cues.0.trigger.bogus: the "bogus" key
  - *lead                           # cues.1.trigger.bogus: the "*lead"
```

The anchored cue opens at `id`, its first key, not at `&lead`; the second
cue is a duplicate of the first and its `CF1001` points at `*lead` too, the
second `id` value having been reached through that alias.

## Which node

A finding about a **value** points at that value: `duration`, `offset`, `at`,
event times, location coordinates, `capacity`, `maximum_speed`, `version`,
`time_unit`, `after`, `on`, each `uses` entry, the `resource` of a `requires`
entry, the `resource`, `move`, `from` and `to` of an `action`, and
`initial_state` (both for a resource whose initial state is undeclared and
for a performer whose `initial_mark` is unknown).

| Finding | Points at |
|---|---|
| unknown field (CF1009) | the key that names it |
| missing field (CF1010) | the mapping that lacks it |
| duplicate cue id (CF1001) | the second cue's `id` value |
| duplicate map entry across files (CF1001) | the key in the later file |
| conflicting top-level field across files (CF1001) | the key in the later file |
| invalid identifier (CF1007) | the key of the entry, or the value of a cue's `id` |
| trigger with two kinds, or none (CF1005) | the `trigger` mapping |
| trigger cycle (CF3002) | the `after` of the smallest cue id in the witness |
| self dependency (CF3003), missing dependency (CF3001) | the `after` |
| invalid trigger (CF3004) | the `trigger` mapping |
| reservation conflict (CF4001, CF4002) | the resource's key |
| no cues (CF3006) | the `cues` value; `None` when the file has no `cues` key |
| move without `from`/`to`/`maximum_speed` (CF5004) | the `action` mapping |
| move longer than `duration` (CF5001) | the `duration` |
| assertion problems (CF6002, CF6003) | the `expression` |
| `sources` entry escaping the root, missing, or not a string | that entry in the manifest |
| parse error (CF1005) | where the parser stopped |

Findings about the workspace as a whole (no sources found, an empty
document), about interventions, about the run store, and every finding a
rehearsal raises keep `source` as `None`.

## Assertions are checked when compiling

`compile_production` parses every assertion and checks its subjects. A
syntax error is CF6002; a cue, attribute (`started`, `visible`, `completed`,
`failed`), resource or state the production does not declare is CF6003. Both
are errors, so the compile fails and the finding points at the `expression`.

## Nothing enters a digest

Positions describe the text, not the show. They never take part in the
compiled digest, the rehearsal digest or any canonical rehearsal report, so a
comment line added above a cue moves every `line` and changes no digest.
`docs/determinism.md` still holds: comments and key order are not semantic.

## Sorting

`sort_findings` already orders by severity, then source path, line and
column, then code. A finding with a source therefore sorts after a finding
without one of the same severity, and two findings in one file come out in
text order.

## Multi-file workspaces

Positions follow the node into the file that holds it. Lists concatenate the
manifest's own entries first, then each source in `sources` order, so the
merged `cues[3]` may live in the second source file. Map entries keep the
position they had in their file.

## Worked example

```yaml
version: 1
production: harbor
time_unit: ms
resources:
  lamp: {kind: light}
cues:
  - id: lx_1
    department: lighting
    trigger: {after: lx_0, offset: 2.5}
    uses: [lamp, haze]
```

`compile_production` returns three findings, in text order:

| Finding | `source` |
|---|---|
| CF2007, `lx_1.offset` is not an integer | line 9, column 36, the `2` of `2.5` |
| CF1002, `lx_1` refers to missing cue `lx_0` | line 9, column 22, the `l` of `lx_0` |
| CF4004, `lx_1` uses unknown resource `haze` | line 10, column 18, the `h` of `haze` |

Write the same production as JSON and the findings keep their codes and
messages; only `path`, `line` and `column` follow the JSON text.
