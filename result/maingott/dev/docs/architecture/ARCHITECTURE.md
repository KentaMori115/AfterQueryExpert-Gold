# Architecture

## High-level pipeline
```text
MainGott specification
        |
        v
Source Analyzer
        |
        v
Fact Registry
        |
        v
Creative Planner
        |
        v
Storyboard
        |
   +----+----+
   |         |
   v         v
Video     Voice
Assets    Assets
   |         |
   +----+----+
        |
        v
Video Composer
        |
        v
Validator
        |
        v
final.mp4
```

## Package layout
```text
src/maingott_reel/
├── cli.py
├── config.py
├── errors.py
├── logging_config.py
├── audit/
│   ├── gates.py
│   └── auditor.py
├── models/
│   ├── base.py
│   ├── provenance.py
│   ├── validation.py
│   ├── quality.py
│   ├── composition.py
│   ├── source.py
│   ├── creative.py
│   ├── storyboard.py
│   ├── asset.py
│   ├── voice.py
│   ├── brand.py
│   ├── cost.py
│   ├── release.py
│   └── manifest.py
├── source/
│   ├── docx_reader.py
│   ├── fact_registry.py
│   └── analyzer.py
├── creative/
│   ├── planner.py
│   ├── fact_selection.py
│   ├── draft.py
│   ├── claims.py
│   ├── script_generator.py
│   ├── storyboarder.py
│   └── storyboard_generator.py
├── providers/
│   ├── base.py
│   ├── openai_provider.py
│   ├── placeholder_video.py
│   ├── placeholder_voice.py
│   └── fake.py
├── assets/
│   ├── manager.py
│   ├── cache.py
│   ├── identity.py
│   ├── probe.py
│   ├── validation.py
│   └── mp4.py
├── costing.py
├── release/
│   ├── checker.py
│   ├── policy.py
│   ├── approval.py
│   ├── review.py
│   ├── package.py
│   ├── inputs.py
│   ├── brand.py
│   ├── configuration.py
│   ├── compare.py
│   └── reproduce.py
├── audio/
│   ├── voice.py
│   ├── audition.py
│   ├── identity.py
│   ├── validation.py
│   ├── probe.py
│   └── wav.py
├── video/
│   ├── composition.py
│   ├── encoder.py
│   ├── timeline.py
│   ├── captions.py
│   └── validation.py
└── utils/
    ├── ffmpeg.py
    ├── request_log.py
    ├── hashing.py
    ├── jsonio.py
    ├── manifest_store.py
    ├── prompts.py
    └── run_context.py
```

Business logic must not call OpenAI directly. Use provider interfaces.

## Creative planning
The planner never sees the specification. It works from `facts.json`:

```text
facts.json → fact_selection → prompts → TextProvider → draft
          → script_generator → claims validation → creative_brief.json + script.json
```

The model fills in a permissive wire schema (`creative/draft.py`), because
Structured Outputs requires every field to be present and ignores string or
numeric constraints. `creative/script_generator.py` converts that draft into
the strict application models, and `creative/claims.py` then checks it against
the fact registry. A plan that fails validation is retried with the failures
fed back to the model, and rejected if it still fails — it is never repaired.

## Storyboarding
The storyboard stage takes the approved plan and adds only the visual layer:

```text
script.json → beats + scaled timing → prompts → TextProvider → shot draft
            → storyboard_generator → storyboard validation → storyboard.json
```

Timing is computed here, not by the model: the plan's beat estimates are
scaled proportionally so the timeline lands exactly on the target duration.
Voiceover, on-screen captions and fact references are copied from the plan
verbatim, so the storyboard cannot introduce a claim the planner never made —
`spoken_content_unchanged` fails the run if any of them drift.

Shot prompts are written in English for the video model and may not ask for
readable lettering or a logo: captions and the brand mark are added by
deterministic post-production, and generated lettering comes out malformed.

## Asset generation
The storyboard is authoritative. This stage generates exactly what the scenes
declare and changes nothing about them:

```text
storyboard.json → requests (resolved against provider capabilities)
               → cache lookup → VideoProvider → download → validation
               → assets.json + assets/scene_NN/video.mp4
```

Providers advertise a `VideoCapabilities` record — which clip lengths, which
frame sizes, how long a prompt may be. A scene is resolved against it *before*
anything is paid for: the clip length is the shortest supported one that covers
the scene, and the difference is recorded as a `duration_strategy` of
`trim_in_post` for composition to act on. Nothing about the scene is rewritten.

Two hashes govern reuse. `cache_key` covers everything that defines the file —
provider, model, prompt, seconds, size, generation settings — so identical
requests share one generated clip across runs and scenes. `asset_id` adds the
run's source document and the scene, so resuming a run finds the same ids.

Every file is validated before it counts: it exists, it is real media with a
video track, and its duration and dimensions match the request. `ffprobe` does
this when FFmpeg is installed; otherwise the MP4 container is read directly by
`assets/mp4.py`, which verifies structure but not decodability.

## Narration
The approved script is authoritative. The voice stage speaks it and changes
nothing about it:

```text
script.json → request (resolved against provider capabilities)
           → cache lookup → VoiceProvider → measure → validation
           → voice.json + audio/voice.wav
```

`narration_sha256` is the binding: the hash of the exact narration in
`script.json`, carried by the voice record and checked again by composition
and by the audit. A track generated from a different script is refused, never
adapted.

Two hashes govern reuse, as with footage. `cache_key` covers everything that
defines the audio — provider, model, voice, language, format, speaking speed
and voice direction, over whitespace-normalised words — so the same narration
in the same voice is paid for once across every run. `voice_id` adds the run's
source document and storyboard.

Which voice speaks is nobody's decision here. `voice-audition` records several
candidates reading the same extract of approved narration so a person can
listen; the choice is written by hand into `input/brand/voice_profile.json`,
and the release checker requires the track to have been spoken by exactly that
voice.

Delivery is configuration, not code: the versioned prompt in
`prompts/voice/narration.md` steers *how* the words are spoken and is sent as
the provider's `instructions`. It cannot change the words.

### Takes

`VOICE_TAKES` decides how much of the script goes to the provider at once.
`whole`, the default, asks for the Reel in one piece and measures it against
the whole timeline. `scene` asks for each storyboard scene's voiceover on its
own, and measures each take against the seconds that scene actually runs —
which is the only way to notice that a line is still being spoken after its
scene has cut away.

Cutting the script changes three things and nothing else:

- **fitting is per scene.** A take that overruns is answered the way an
  overrunning Reel always was, by re-speaking rather than by rewriting. The
  difference is that one speaking speed is chosen for the whole Reel, the
  slowest that makes every take fit, because a Reel that speeds up for one
  scene and slows down for the next sounds broken even when every scene fits;
- **repeated words are paid for once.** Take audio is content-addressed like
  every other generated asset, so two scenes that say the same thing at the
  same speed share one generated file, in this run and in every later one;
- **the takes are laid onto the storyboard's timeline**, each starting at its
  own scene's start instant, with silence in between. What comes out is a
  single track of exactly the Reel's length, so composition, the audit and the
  release gates read what they always read.

The record follows: `voice.json` still describes one track bound to the whole
approved script, and lists what was spoken for each scene. Its measured speech
metrics describe the words, not the silence between them — counting the gaps
as delivery would describe a speaker nobody recorded.

A fourth thing follows from the first three rather than being a decision of its
own. Because takes are asked for one at a time and cached as they arrive, a
take the provider refuses ends the round where it stands: the scenes after it
are never sent, and the ones before it stay in the cache. The stage reports a
failure with the takes it managed as evidence, and a later attempt at the same
run speaks the remainder. Carrying on past a refusal would buy nothing — the
provider is refusing a voice, a format or a language, and would refuse the next
scene for the same reason — while paying for it once per remaining scene.

The narration is measured from the audio, never from provider metadata, and
compared with the storyboard's timeline. If the same words cannot be heard
inside the Reel, that is reported. The script is never shortened to fit: the
only lever is `VOICE_FIT_STRATEGY=regenerate`, which re-speaks the identical
words once at a supported speaking speed inside configured bounds, and gives
up rather than distorting the delivery.

## Composition
Post-production is deterministic and calls no model. The approved storyboard
supplies the timing and every word on screen:

```text
storyboard.json + assets.json + voice.json + music + logo
      → timeline → normalize → sequence → captions and logo → audio → mux
      → final/maingott_reel.mp4 + composition.json
```

Each pass writes an intermediate under `composition/`, so a finished Reel can
be taken apart. Generated assets are only ever read.

Scenes are scaled to cover the 9:16 canvas and centre-cropped, never stretched;
720x1280 footage becomes 1080x1920 by upscaling, which is recorded per scene.
Clip lengths from Phase 4 are longer than the scenes they serve, so each is
trimmed to its storyboard duration — and a dissolve's overlap is funded out of
that surplus, which is why the finished timeline still lands exactly on the
storyboard's total.

Voice is an input here, never something composition creates. With no
`--voice`, the run's own generated narration is used — and only if its
`narration_sha256` matches the storyboard being composed.

Captions are rendered by Pillow into transparent PNGs and overlaid, rather
than drawn by FFmpeg's text filter: the typography is controllable, Cyrillic
and Latin render identically anywhere the configured font exists, and every
caption is an inspectable file. Their wording is copied from the storyboard.

Everything that decides what the file looks like is hashed into a composition
identity, so an unchanged run reuses its Reel and a changed input never
reuses an obsolete one.

## Final validation
`validate` audits a finished run rather than any single artifact, and
re-derives its answers instead of trusting what each stage recorded — a run
that drifted between stages fails even though every stage passed at the time.

Gates are grouped and graded:

| group | asks |
| --- | --- |
| `run` | do the artifacts exist, agree on one source and one narration, and match the storyboard the assets and the Reel were built from? |
| `voice` | does the narration in the Reel speak the approved script, and is it the track the voice stage recorded? |
| `claims` | re-runs the claims policy against `facts.json`, and checks captions and narration are still the approved wording |
| `file` | reads the MP4 back with ffprobe: resolution, portrait, duration in bounds and on the storyboard, frame rate, streams, codecs, and that the file has not changed since it was composed |
| `presentation` | measures the rendered caption images' ink against the safe area, and checks the brand mark is present, on canvas and large enough to read |
| `readiness` | narration, a real voice rather than a placeholder, brand mark, and whether this was a development output |

Blocking failures (`error`) mean the Reel is not valid. Advisory failures
(`warning`) — a missing logo, a silent development track — do not block on
their own, and `--strict` promotes them so a development Reel can never be
reported as acceptable. The verdict is written to `validation.json` and
recorded in the manifest.

## Cost control
Generation is the only part of this pipeline that spends money, so it is the
part that is written down before it happens:

```text
storyboard.json → the same planning the generation stages do
               → cache lookup → pricing table → generation_plan.json
```

`cost-estimate` asks exactly the questions `generate-assets` and
`generate-voice` ask — what does the storyboard need, what is already cached —
and prices the answer. **No price is ever invented.** Costs come from
`input/pricing.json`, a table the project fills in from the provider's own
price list; a model that is not in it produces `COST UNKNOWN`, never a zero.

`MAX_GENERATION_COST` turns that estimate into a stop. Over budget, generation
refuses to start. *Unknown* cost with a budget configured also refuses: a cost
that cannot be established is not an affordable one. `--allow-over-budget` is
the only way past, and it is never implicit.

Every provider request is appended to `logs/provider_requests.jsonl` — what was
asked for, which model, which identity, which hashes, how many attempts, and
whether it was a cache hit, a retry, a rejection or a paid success. No prompt
text, no narration, no credential.

## Release management
Validation answers "is this a valid Reel?". Release asks a narrower question:
*may these exact bytes leave the building?*

```text
validate → release-check → review → approve → release → release-validate
```

The difference between the two is inputs a human signed off on. A Reel made of
placeholder footage, spoken by a voice nobody approved, or stamped with a logo
that is not in the brand registry is a perfectly valid file and an
unacceptable advertisement. Those are **release gates**, in their own group;
Phase 6's quality gates are untouched.

`release-check` has three outcomes, and the difference matters: `PASS` (a
release candidate), `BLOCKED` (valid, but built from something unapproved) and
`FAIL` (the quality gates themselves failed). They map to exit codes 0, 2 and
1.

Approval is a person's statement about one artifact, so it is bound to one:
the `ArtifactFingerprint` hashes the whole chain — specification, plan,
storyboard, footage, narration, composition, the finished file, and the
sanitized production configuration. Change any of them and the approval stops
describing what exists, and says so. It is never updated in place.

Nothing approves itself. `approve` requires a release candidate *and* a
completed human review of that exact file — the judgements a machine cannot
make: does the footage look right, does the narration sound like a person,
does the Reel say what the business wants said.

A release package is a directory that can be audited years later by someone
with no access to this machine:

```text
output/releases/rel-<content hash>/
├── release.json
├── final/maingott_reel.mp4
└── metadata/   manifest, validation, composition, storyboard, plan,
                creative_brief, facts, assets, voice, configuration,
                approval, review, generation_plan, provider_requests
```

The release id is a hash of the content, never a timestamp, so the same
approved Reel always produces the same release. `release-validate` re-hashes
every packaged file and the approval inside it; anything that changed fails.

Two read-only audits round it off: `compare` puts two runs' artifacts side by
side (deterministically — no model, no frames), and `reproduce-check` asks
whether enough is recorded to explain how a Reel was made.

Publishing is not part of this pipeline. Phase 8 ends at an approved,
immutable package.

## Run persistence
Each run:
```text
output/runs/<run_id>/
├── source.json
├── facts.json
├── creative_brief.json
├── script.json
├── storyboard.json
├── assets.json
├── voice.json
├── composition.json
├── validation.json
├── configuration.json
├── generation_plan.json
├── review.json
├── approval.json
├── manifest.json
├── assets/
├── audio/voice.wav
├── logs/run.jsonl
├── logs/provider_requests.jsonl
└── final/maingott_reel.mp4
```

Approved releases live outside the runs, under `output/releases/<release_id>/`,
and are never written twice.

`output/runs/LATEST` holds the id of the most recent run. Commands operate on
that run unless `--run-id` is given.

## The full pipeline
`maingott-reel all` runs analyze → plan → storyboard → generate-assets →
generate-voice → compose → validate in order, and stops at the first stage
that fails: a failed asset never reaches the voice stage, and a Reel that
fails to compose is never audited as if it had.

Two modes never spend anything. `--dry-run` inspects every stage — including
what the voice stage would cost and whether the cache already holds it — and
generates nothing; stages with nothing to inspect because nothing was
generated are reported as skipped rather than as successes. `--offline` runs
the whole chain with the offline providers and produces a complete but
*development* Reel: placeholder footage, a placeholder voice, and a validation
report that says so. `validate --strict` is what separates the two.

Record source hash, prompt versions, models, asset paths/hashes, composition settings and validation results.
