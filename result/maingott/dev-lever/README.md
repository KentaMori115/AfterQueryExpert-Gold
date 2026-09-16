# MainGott Reel Generator

AI-assisted production pipeline for MainGott advertising Reels.

Pipeline:

`Source specification → business facts → creative brief → script → storyboard → assets → voice → deterministic composition → validation → release check → human approval → immutable release package`

Publishing is deliberately not part of it.

Composition requires FFmpeg and a Unicode font with Cyrillic (DejaVu Sans,
Noto Sans or Liberation Sans are found automatically).

```bash
maingott-reel all --duration 40             # the whole pipeline (paid)
maingott-reel all --duration 40 --dry-run   # inspect every stage, spend nothing
maingott-reel all --duration 40 --offline   # a development Reel, spend nothing
maingott-reel validate --strict             # is it fit to publish?
maingott-reel cost-estimate                 # what would a paid run cost?
maingott-reel release-check                 # may these exact bytes be released?
maingott-reel review --confirm all --by NAME
maingott-reel approve --by NAME --version v1.0.0
maingott-reel release                       # immutable package
```

Narration is spoken as one take by default. `VOICE_TAKES=scene` speaks each
storyboard scene separately and fits each line to its own scene, which is what
you want once the timing matters more than the recording session does.
Each take is checked against its own scene, an overrun names every scene
that spills, and `VOICE_FIT_STRATEGY=regenerate` re-speaks the whole Reel at
one shared speed inside `VOICE_MIN_SPEED`..`VOICE_MAX_SPEED`.

Every paid stage takes `--dry-run` and `--offline`, both of which work without
an API key. A Reel built offline is a development output and `validate
--strict` says so.

## First target
- Instagram
- 9:16
- 30–45 seconds
- default 40 seconds
- approximately 8 scenes
- premium B2B technology style

## Setup
1. Python 3.12+
2. FFmpeg + ffprobe
3. OpenAI API key
4. Put `MainGott_Technical_Specification_ru.docx` in `input/source/`
5. Put approved logo assets in `input/brand/`, and record their approval in
   `input/brand/brand.json` (see `brand.example.json`)
6. Follow `docs/operations/SETUP.md`

See `docs/operations/GENERATION_WORKFLOW.md` for the stage-by-stage workflow.


## CopyRights

This is personal project that was written from zero.
Owner: Muhammad Azmi
Email: redacted@example.com
