# Generation Workflow

1. Analyze
```bash
maingott-reel analyze
maingott-reel analyze --source path/to/spec.docx   # different source
maingott-reel analyze --force                      # re-extract
```
Writes `source.json`, `facts.json` and `manifest.json` into a new run under
`output/runs/`, and points `output/runs/LATEST` at it. Re-running against an
unchanged document reuses the existing artifacts.

Review `facts.json` before planning: statements are verbatim, `claim_status`
marks design targets, and `source_lines` points back into `source.json`.

2. Plan
```bash
maingott-reel plan --duration 40
maingott-reel plan --dry-run              # offline wiring check, no API call
maingott-reel plan --allow-target-facts   # offer design targets, restricted use
maingott-reel plan --force                # replan this run
```
Reads `facts.json`, never the DOCX. Writes `creative_brief.json` and
`script.json`, and records the model, prompt versions and validation result in
`manifest.json`.

A plan is written only when every deterministic claim check passes. Review the
narration and the cited fact ids before generating any assets.

3. Storyboard
```bash
maingott-reel storyboard
maingott-reel storyboard --dry-run          # offline wiring check
maingott-reel storyboard --duration 35      # rescale the timeline
maingott-reel storyboard --force            # rebuild this run
```
Reads `script.json` and writes `storyboard.json`: one scene per beat, an exact
gapless timeline, an English shot prompt per scene and the footage each scene
requires.

The narration, captions and fact references are copied from the plan — the
storyboard stage cannot change what the Reel says. Review the shot prompts and
the timing here; human approval is recommended before any video generation.

4. Estimate the cost
```bash
maingott-reel cost-estimate            # what a paid run would do, and cost
maingott-reel cost-estimate --offline  # the same for the offline providers
maingott-reel cost-estimate --force    # as if nothing were cached
```
Asks the same questions the generation stages ask — what does the storyboard
need, what is already cached — and prices the answer against
`input/pricing.json`. Writes `generation_plan.json` and generates nothing.

**Prices come from the project, not from this code.** Copy
`input/pricing.example.json` to `input/pricing.json` and fill in numbers you
have checked against the provider's current price list. Anything unpriced is
reported as `COST UNKNOWN` — never as free.

Set `MAX_GENERATION_COST` to turn the estimate into a stop. Generation refuses
to start when the plan is over budget *or* when a budget is configured and the
cost cannot be established. `--allow-over-budget` is the only way past, and it
has to be typed.

5. Generate assets
```bash
maingott-reel generate-assets --dry-run    # plan only; never generates
maingott-reel generate-assets --offline    # placeholder clips, no API calls
maingott-reel generate-assets              # real generation (paid)
maingott-reel generate-assets --force      # ignore cache and previous results
maingott-reel generate-assets --keep-failed  # do not retry earlier failures
maingott-reel generate-assets --allow-over-budget  # spend past the budget
```
**Video generation costs money.** Always look at `--dry-run` first: it shows
the provider, the model, the clip length per scene and how many clips would
actually be generated after the cache is consulted.

Generated clips land in `assets/scene_NN/video.mp4` with a `metadata.json`
beside them, and are recorded in `assets.json`. Files are cached under
`output/assets/cache/`, shared by every run, so re-running generates nothing
that already exists. Failed scenes are retried on the next run; successful ones
are never regenerated.

The command exits non-zero if any scene failed, and says which.

5b. Audition a voice (once, before the first production run)
```bash
maingott-reel voice-audition --dry-run          # what it would cost
maingott-reel voice-audition                    # every voice the provider offers
maingott-reel voice-audition --voice marin --voice cedar
maingott-reel voice-audition --offline          # wiring check, no API calls
```
Records each candidate voice reading the same short extract of the **approved**
narration — whole lines, verbatim, never re-worded — into
`output/auditions/<sample>/`, with `audition.json` recording provider, model,
voice, language, duration and hash for each.

It touches no run artifact and approves nothing. Listen to the samples, then
record your choice by hand in `input/brand/voice_profile.json`. Nothing in this
project may choose or approve a voice.

6. Generate voice
```bash
maingott-reel generate-voice --dry-run   # plan only; never generates
maingott-reel generate-voice --offline   # placeholder track, no API calls
maingott-reel generate-voice             # real generation (paid)
maingott-reel generate-voice --force     # ignore the cache and any earlier take
maingott-reel generate-voice --allow-over-budget  # spend past the budget
```
**Speech generation costs money.** `--dry-run` shows the provider, model,
voice, language, the narration's hash and size, whether the cache already
holds it, and how many calls would be made — without making any.

Reads the approved narration from `script.json` and speaks it verbatim. The
words are never rewritten, shortened, translated or embellished here; the
voice direction in `prompts/voice/narration.md` steers only delivery.

The track lands in `audio/voice.wav` and is recorded in `voice.json` with
`narration_sha256` — the hash of the exact narration it speaks. Audio is
cached under `output/assets/cache/` alongside footage, so the same narration
in the same voice is paid for once across every run.

Set `VOICE_TAKES=scene` to speak the Reel one scene at a time instead of in a
single piece. Each scene's voiceover becomes its own take, measured against the
seconds that scene runs rather than against the whole Reel, so a line that
overruns is caught here instead of in the finished file. The takes are then
laid onto the storyboard's timeline — each at its own scene's start, silence in
between — and written as one `audio/voice.wav`, exactly as long as the Reel.
Individual takes are kept beside it under `audio/takes/` so a specific line can
be listened to on its own.

Two things follow that are worth knowing before a paid run:

- if any take overruns, `VOICE_FIT_STRATEGY=regenerate` re-speaks **every**
  take once at one shared speed, the slowest that makes all of them fit. That
  is a second call per take. With `fail` the stage stops and names every scene
  whose take overruns, so one re-plan can fix all of them at once;
- scenes that say exactly the same thing are one paid call, not two, in this
  run and in any later one. `cost-estimate` counts it the same way, and lists
  one planned item per take so you can see which scene is being paid for.

To see what a scene-by-scene run really paid for, read the run's request
log rather than `voice.json`: each `audio.speech` record with outcome
`success` is one speech call. Eight scenes with one repeated line show seven
records; a regenerate round adds one more per take, since every take is spoken
again at the shared speed; a rescale adds none.

A refusal lists the overrunning scenes in storyboard order, each with the
seconds its take measured and the seconds its scene runs. Scenes whose takes
fit are not mentioned, so a short list means a local problem and a long one
means the whole plan is talking too fast for the Reel it was given.

### When a take cannot be spoken

An overrun is a fit problem and the whole Reel is measured before the stage
decides what to do about it. A take the provider simply will not speak is a
different matter, and the stage treats it differently: the round stops there.
The scenes after the refused one are never asked for, which is the point — the
same rejection would come back for every one of them, at the same price.

What is left behind is deliberate:

- the takes that were spoken are on disk under `audio/takes/`, one WAV per
  scene, and in the cache under the words and speed they were spoken at;
- `voice.json` holds those takes with the stage marked failed and the
  provider's own message in `error`;
- the request log has one `success` record per take spoken and one `rejected`
  record for the take that ended the round.

Run the stage again after fixing whatever the provider objected to and it
speaks only what is still missing: the refused take, and the scenes that came
after it. Eight scenes refused at the fifth cost four calls the first time and
four the second, not eight and eight. This holds for a regenerate round too — a
round that is stopped part of the way through re-speaking the Reel at the
shared speed resumes at the take it stopped on, since the takes already
re-spoken are cached at that speed like any others.

Two things worth not doing. Do not reach for `--force`: it is there to ignore
what earlier runs left behind, and after a stopped round that is precisely the
work you want to keep. And do not delete `audio/takes/` to get a clean start
unless the audio itself is suspect; the cache, not the directory, is what makes
the second attempt cheap, and the two are cleared together.

A run refused at its fifth scene reads like this end to end, counting only what
was paid for:

| attempt | what happened | speech calls |
| --- | --- | --- |
| first | S-01 to S-04 spoken, S-05 rejected, S-06 to S-08 never sent | 4 success, 1 rejected |
| second | S-01 to S-04 served from the cache, S-05 to S-08 spoken | 4 success |

Eight takes, eight paid calls, one rejected one in between: no take is spoken
twice, and the four the first attempt managed are the four the second one does
not have to buy. A stage that carried on past the refusal, or one that started
the second attempt from nothing, would spend twelve calls on the same Reel.

Note that the second attempt is an ordinary `generate-voice`. Nothing marks it
as a retry, no flag asks for the resume, and the same command run a third time
makes no calls at all, because by then every take is cached. This is also why
the run directory is worth keeping after a refusal rather than deleting it and
starting over.

When the shared speed a regenerate round would need falls outside
`VOICE_MIN_SPEED`..`VOICE_MAX_SPEED`, the stage stops before spending anything
and names the speed it wanted along with the scene that forced it. Three ways
out, in the order worth trying:

1. give that scene more seconds in the storyboard, so the words fit at a speed
   the window allows;
2. shorten the beat's narration in the approved script and re-run `approve`;
3. widen `VOICE_MAX_SPEED`, accepting that every scene, not only the tight one,
   will be delivered at that pace.

A scene-by-scene run of the shipped eight-beat plan against the offline
provider lays out like this:

| scene | starts | scene runs | spoken | headroom |
| --- | --- | --- | --- | --- |
| S-01 | 0s | 4s | 1.733s | +2.267s |
| S-02 | 4s | 4s | 1.933s | +2.067s |
| S-03 | 8s | 5s | 2.6s | +2.4s |
| S-04 | 13s | 5s | 2.867s | +2.133s |
| S-05 | 18s | 5s | 1.8s | +3.2s |
| S-06 | 23s | 6s | 2.533s | +3.467s |
| S-07 | 29s | 5s | 2.333s | +2.667s |
| S-08 | 34s | 6s | 2.267s | +3.733s |

Eight takes, 18.066s of words inside a 40s track, delivered at 15.39 characters
per second. Nothing overruns, so nothing is re-spoken and every take keeps the
provider's own pace. Note what the measured rate is taken over: the words, not
the 22 seconds of silence between them. Divide the same script by the whole
track and the delivery reads as half the speed of the voice that recorded it,
which is the wrong answer to give a reviewer asking whether the narration
sounds rushed.

After generation the audio is measured and compared with the storyboard's
timeline. If the same words cannot be heard inside the Reel the stage fails
and says by how much. The script is never trimmed to fit; set
`VOICE_FIT_STRATEGY=regenerate` to re-speak the identical words once at a
supported speaking speed within `VOICE_MIN_SPEED`/`VOICE_MAX_SPEED`, and the
change is recorded in `voice.json`.

7. Compose
```bash
maingott-reel compose                                      # uses the run's narration
maingott-reel compose --dry-run --silent-voice --no-logo   # plan only
maingott-reel compose --voice narration.wav                # externally approved track
maingott-reel compose --voice narration.wav --music bed.m4a
maingott-reel compose --silent-voice --no-logo             # development Reel
maingott-reel compose --force                              # recompose
```
Requires FFmpeg. Reads `storyboard.json`, `assets.json` and the run's
`voice.json`, writes `composition.json` and `final/maingott_reel.mp4`, and
keeps every intermediate under `composition/`.

Narration and an approved logo are **required** unless they are explicitly
waived with `--silent-voice` / `--no-logo`. With no `--voice`, the run's own
generated narration is used — and only if it speaks this storyboard's script;
a track from a different script is refused rather than mixed in. A waived Reel
is labelled a development output and must not be published.

Composition is reused when nothing that defines the file has changed. Change
the storyboard, a clip, the narration, the music, the logo, the font or a
setting and it recomposes.

8. Validate
```bash
maingott-reel validate            # blocking gates only
maingott-reel validate --strict   # advisory warnings fail too
```
Audits the whole run: the artifacts agree with each other, the claims still
hold against `facts.json`, the narration in the Reel is the approved script
spoken by the track the voice stage recorded, the finished MP4 is what it
claims to be, the captions sit inside the safe area, and the brand mark is
readable. Writes
`validation.json` and records the verdict in the manifest.

Exit code is non-zero when a blocking gate fails — and, with `--strict`, when
anything at all fails, so a development Reel cannot pass a release check.

9. Full pipeline
```bash
maingott-reel all --duration 40             # real generation (paid)
maingott-reel all --duration 40 --dry-run   # inspect every stage, spend nothing
maingott-reel all --duration 40 --offline   # development Reel, spend nothing
maingott-reel all --duration 40 --music bed.m4a --no-logo
```
Runs analyze → plan → storyboard → generate-assets → generate-voice → compose
→ validate, stopping at the first stage that fails. A failed asset never
reaches the voice stage, and a Reel that fails to compose is never audited as
if it had.

`--dry-run` makes no paid call anywhere. On a run that has generated nothing
yet there is no footage to compose and nothing to audit, and those stages are
reported as skipped — not as successes.

`--offline` runs the whole chain with the offline providers: placeholder
footage, a placeholder voice, and an approved logo only if one exists. The
result is a complete but **development** Reel. Check it with:

```bash
maingott-reel validate --strict
```

which fails for exactly that reason. Nothing produced by `--offline` may be
published.

Every provider request is appended to `logs/provider_requests.jsonl`: what was
asked for, which model, which hashes, how many attempts, and whether it was a
cache hit, a retry, a rejection or a paid success. No prompt text, no
narration and no credential is recorded.

10. Release-check
```bash
maingott-reel release-check
```
Asks whether these exact bytes may be released. Runs the Phase 6 audit, then
the production questions it deliberately does not ask: is this real generated
footage, a real voice, the *approved* voice, an approved brand mark, a
complete pipeline run?

Exit codes:

| code | meaning |
| --- | --- |
| 0 | **PASS** — a release candidate; a human may now review and approve it |
| 1 | **FAIL** — a blocking quality gate failed; this is not a valid Reel |
| 2 | **BLOCKED** — a valid Reel built from something nobody approved |

Approval requires an approved logo in `input/brand/brand.json` and an approved
voice in `input/brand/voice_profile.json`. Copy the `.example.json` files
beside them. Presence is not approval: an asset counts only when a human set
`approved: true` and the file still matches the recorded hash.

11. Human review
```bash
maingott-reel review                                   # show the checklist
maingott-reel review --confirm visual_quality --by NAME
maingott-reel review --confirm all --by NAME --note "Checked on a phone."
```
Thirteen judgements no machine can make: does the footage look right, are the
captions readable in motion, does the narration sound like a person, is the
brand mark correct, does the Reel say what the business wants said. Nothing in
this project may tick them. The checklist is bound to the exact file — recompose
and the review starts again.

12. Approve
```bash
maingott-reel approve --by NAME --version v1.0.0 --note "..."
maingott-reel approve --by NAME --reject --note "The footage is wrong."
```
Refuses unless `release-check` passes *and* the human review of this exact
file is complete. Writes `approval.json`, bound to the whole content
fingerprint — specification, plan, storyboard, footage, narration,
composition, finished file and production configuration. Change any of them and
the approval no longer applies; it is never updated in place, and the Reel has
to be approved again.

13. Release
```bash
maingott-reel release
maingott-reel release-validate
maingott-reel release-validate --release-id rel-0123456789abcdef
```
Writes `output/releases/<release_id>/` — the Reel, the approval, and every
artifact that explains how it came to exist, each with its hash in
`release.json`. The release id is a hash of the content, not a timestamp, so
the same approved Reel always produces the same release. Original run
artifacts are only ever read.

`release-validate` re-hashes every packaged file and the approval inside it.
Anything that changed fails.

14. Audits
```bash
maingott-reel compare RUN_A RUN_B
maingott-reel reproduce-check
maingott-reel reproduce-check --release-id rel-0123456789abcdef
```
`compare` puts two runs' artifacts side by side — plan, narration, scenes,
timings, assets, voice, composition, final file. Deterministic: no model, no
frames, no opinion about which is better.

`reproduce-check` asks whether enough is recorded to explain a Reel later —
source, prompts and their versions, provider metadata, clips, narration,
configuration. It regenerates nothing.

Publishing is not part of this pipeline. The workflow ends at an approved,
immutable release package.

Initial releases must not auto-publish to social platforms.
