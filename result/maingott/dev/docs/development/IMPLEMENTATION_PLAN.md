# Implementation Plan

Implement in vertical slices.

## Phase 0 — Skeleton
Package, settings, CLI, logging, models, tests.

## Phase 1 — Source analyzer
Read DOCX, extract text, preserve page/line context where available, hash source, create fact registry.

## Phase 2 — Creative planner
Use structured model output. Generate a 30–45s plan with source fact IDs and reject unsupported claims.

## Phase 3 — Storyboard
Create timed scenes with visual prompts, voiceover, overlays and asset requirements.

## Phase 4 — Asset generation
Implement isolated OpenAI adapters for image/video/audio. Cache results and make failed assets resumable.

## Phase 5 — Composition
Use FFmpeg for:
- portrait normalization
- scene sequencing
- logo overlay
- captions
- voice
- music
- audio mixing
- final MP4

## Phase 6 — Validation
Check:
- duration
- portrait resolution
- FPS
- audio/video streams
- placeholders
- unsupported claims
- safe areas
- file integrity

## Phase 7 — End-to-end
Implement:
`maingott-reel all --duration 40`

## Phase 8 — Hardening
Add dry-run, resume, cost estimates, structured logs, run comparison and approval gates.

## Phase 9 — Scene takes
Cut the narration to the storyboard when `VOICE_TAKES=scene`:

- speak each scene's voiceover as its own take, one provider call per distinct
  text at a given speed, shared across scenes and across runs through the cache;
- measure every take from the audio that came back and hold it against its own
  scene with the timeline tolerance, naming every scene that overruns;
- on overrun with `regenerate`, re-speak all takes at one shared speed inside
  `VOICE_MIN_SPEED`..`VOICE_MAX_SPEED`, refusing when no such speed exists;
- lay the takes onto the storyboard timeline into one full-length track and
  record them in `voice.json` beside the unchanged narration hash;
- teach `cost-estimate` to plan and price one item per take.
- stop the round at the first take the provider will not speak, keeping what
  was already spoken so a later attempt at the same run pays only for the rest.

Do not implement the whole project in one pass.
