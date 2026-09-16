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

Do not implement the whole project in one pass.
