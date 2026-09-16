Findings say what is wrong, never where: `Finding.source` and `SourceRef` exist, nothing fills them.

Load and compile findings about an authored node carry `source`. `path`: as given for one file, posix separators; workspace-relative inside a workspace. `line` and `column` are 1-based, at the node's first character: `{` for a JSON object, first key for a block YAML mapping, the quote for a quoted scalar; an anchor names its node, which opens after it. A node reached through an alias, with everything inside it, points at that `*alias`, the outermost when aliases nest.

Which node:
- bad values point at that value: `duration`, `at`, `after`, `on`, coordinates, `capacity`, `maximum_speed`, `version`, `trigger`, each `uses` item, `resource`, `move`, `from`, `to`, `initial_state`;
- unknown field points at its key, missing field at mapping lacking it, duplicate cue id at the second `id` value, conflicting entry across files at its later key, bad identifier at the resource key or cue `id` value, incomplete move (CF5004) at its `action` mapping;
- trigger cycle points at the smallest witness cue's `after`, self dependency at its `after`, reservation conflict at resource key, CF3006 at the `cues` value, null without a `cues` key; parse error where the parser stopped.

Workspaces: nodes point into their own file; lists concatenate manifest first, then `sources` in order, whose problems point at that entry. Nothing authored: `source` null.

JSON gets real positions, number tokens stay text.

Assertions get checked while compiling, at `expression`: syntax CF6002, unknown cue, attribute, resource or undeclared state CF6003; compile fails.

`cueforge compile --format json` findings gain rehearsal JSON's `source` object, present only with a node. Rehearsal output and digests stay byte-identical.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
