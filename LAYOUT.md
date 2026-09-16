# Where things go

```
bin/gold_bot.py          the platform client
snapshots/               incoming zips, kept as they arrived
docs/                    the platform's own rules
.claude/skills/          create-repo, create-task, find-commit, fix, task-review
original_test.sh         the frozen verifier frame
result/<repo-name>/
    repo/                the unpacked codebase (configlayer: NOT present yet)
    data.txt             repository url and metadata
    STATUS.md            build log
    tasks/<task-name>/   one task bundle
```

## This seat

Auth for this seat is **not** the default file. `gold_bot.py` reads `$GOLD_AUTH`
first, so every command here runs as:

```sh
export GOLD_AUTH=~/.config/gold/auth-dragan.json
python3 bin/gold_bot.py <command>
```

`~/.config/gold/auth.json` is the alexandra seat and `auth-alexsey.json` the
alexsey seat. Refresh tokens rotate on every mint and are written back, so the
three files must never be crossed and no two clients may run against one token.

Account: dimon.paukow@gmail.com, uid nZUFEoNQTnY70dqJmJ9YCesQrCs1, trial phase
`working`. Thresholds from `gold.me`: solution 459 lines / 4 files, held-out
596 lines / 2 files, instruction **100 to 300 words**, f2p 8 (aim 20), p2p 50,
0.9 to 7.5 solution lines per instruction word.
