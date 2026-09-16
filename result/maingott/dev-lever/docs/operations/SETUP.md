# Local Setup

## Prerequisites
- Python 3.12+
- FFmpeg
- ffprobe
- OpenAI API key

## Install
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e ".[dev]"
```

Windows PowerShell:
```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -e ".[dev]"
```

## Environment
Copy `.env.example` to `.env` and set:
`OPENAI_API_KEY=...`

Never commit `.env`.

Narration defaults to the `gpt-4o-mini-tts` voice `marin`, in the language the
approved plan is written in, as lossless WAV. Change the model, voice, format
or speaking speed with `OPENAI_TTS_MODEL`, `VOICE_NAME`, `VOICE_FORMAT` and
`VOICE_SPEED`; steer the delivery with `VOICE_INSTRUCTIONS` (which overrides
`prompts/voice/narration.md`) — it can only change *how* the approved words
are spoken, never what they are.

`VOICE_LANGUAGE` is a guard, not a translator: set it and the voice stage
refuses to run if the approved plan is in another language.

`VOICE_TAKES` decides how the narration is cut. `whole`, the default, speaks
the approved script as one recording and measures it against the whole Reel.
`scene` speaks every storyboard scene as its own take and measures each one
against the seconds its scene runs, so a line that would spill into the next
scene is caught before the Reel is composed. Both settings are part of the
release configuration, so two runs that differ only in how they were cut are
reported as differently configured rather than as drift.

`VOICE_MIN_SPEED` and `VOICE_MAX_SPEED` (0.25 to 4.0, floor not above ceiling)
bound the speaking speed a `regenerate` round may pick. In `scene` mode the
round speaks every take at one shared speed, the slowest that fits all of them;
if that speed falls outside the window the stage stops and reports it instead
of rushing the Reel or quietly dropping the line.

## Source
Put:
`input/source/MainGott_Technical_Specification_ru.docx`

## Brand
Put approved logo/assets in:
`input/brand/`

## Fonts
Captions are drawn with a Unicode font that carries Cyrillic. DejaVu Sans,
Noto Sans or Liberation Sans are found automatically; set `CAPTION_FONT` to
use a specific file.

## Approval of brand assets and voice
Presence is not approval. A logo counts only when a human listed it in
`input/brand/brand.json` with `approved: true`, and the file still matches the
recorded hash; the same is true of the narration voice in
`input/brand/voice_profile.json`. Copy the two `.example.json` files beside
them and fill them in — `release-check` refuses to call a Reel releasable
otherwise, and nothing in this project can approve them for you.

## Pricing
Copy `input/pricing.example.json` to `input/pricing.json` and fill in prices
you have checked against the provider's current price list. This project never
invents a price: an unpriced model is reported as `COST UNKNOWN`.

Set `MAX_GENERATION_COST` to a number to cap what a single generation command
may spend. With a budget configured, an unknown cost also stops generation —
a cost that cannot be established is not an affordable one. `--allow-over-budget`
is the only way past it.

## Retries
Paid retries are bounded on three levels, all configurable:
`OPENAI_MAX_RETRIES` (1–10) caps transport-level retries of a single call,
`VIDEO_MAX_ATTEMPTS` and `VOICE_MAX_ATTEMPTS` (1–5) cap how many times a clip
or a narration take is regenerated after a transient failure, and a rejected
request is never retried at all. Every attempt is logged and appended to the
run's `logs/provider_requests.jsonl` as `retried`, `failed`, `rejected`,
`cache_hit` or `success`, so a retry storm is visible rather than silent.

## Cost safety
Nothing is generated without asking. Every paid stage takes `--dry-run`, which
reports what would be generated and what the cache already holds:

```bash
maingott-reel cost-estimate
maingott-reel generate-assets --dry-run
maingott-reel generate-voice --dry-run
maingott-reel all --duration 40 --dry-run
```

`--offline` runs the same stages against the built-in placeholder providers.
Both work without an API key; real generation without one fails clearly and
never falls back to a placeholder.

## Verify
```bash
ffmpeg -version
ffprobe -version
ruff check .
ruff format --check .
pytest
mypy src
maingott-reel config
```

`maingott-reel config` prints the effective configuration without secrets. No
command ever writes a key into an artifact, a log line or an error message;
`tests/test_secrets.py` is the regression test for that.

FFmpeg is required for composition and is what validates generated assets. Without it, asset validation falls back to reading the MP4 container
directly, which checks structure but not decodability — install FFmpeg before
generating anything you intend to ship.
