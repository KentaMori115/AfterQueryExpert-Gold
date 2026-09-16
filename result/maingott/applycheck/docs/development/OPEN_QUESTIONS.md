# Open Questions

Do not silently decide these in code.

## Brand
- approved MainGott logo?
- approved font?
- brand colors?
- existing brand guidelines?
- approved voice/language?

## Reel
- exact duration?
- Russian, English or bilingual?
- CTA destination?
- approved music?

## API
- enabled OpenAI models/features?
- preferred video quality?
- approved TTS voice?

## Compliance
- may platform logos be displayed?
- which claims require human approval?

## Output
- target resolution?
- FPS?
- maximum file size?

## Phase 0 assumptions (need confirmation)
These defaults are configurable and were chosen only to unblock the skeleton:
- output resolution `1080x1920` and `30` fps (`VIDEO_WIDTH` / `VIDEO_HEIGHT` / `VIDEO_FPS`)
- narration language defaults to Russian (`Language.RU`)
- `OPENAI_TTS_MODEL` now defaults to `gpt-4o-mini-tts` (see Phase 7 findings)
- the image model id from `.env.example` is still unverified; verify before any
  image generation is added

## Phase 1 findings
- The specification DOCX carries no rendered page breaks, so `source_page` is
  `None` for every fact. Facts are traceable by block `line` instead. If page
  citations are required for approval, supply a PDF export of the source.
- Fact categories are keyword heuristics and target detection is deliberately
  over-inclusive; a human should review `facts.json` before the creative stage.

## Phase 2 findings
- Text model verified against the official documentation (August 2026): the
  Responses API with `text_format=` is the structured-output path, and the
  current text model ids are `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna`.
  The default is now `gpt-5.6-terra`. **Which models this account may use is
  still unconfirmed.**
- No `OPENAI_API_KEY` is configured in this environment, so no real planning
  run has been made yet. Everything so far was validated with the offline
  planner and scripted providers.
- Narration language still defaults to Russian, matching the source. The Reel
  brief is written in English, so a bilingual or English Reel needs a decision
  before the storyboard stage.
- Design-target facts are excluded from planning by default. Confirm whether
  the first Reel may reference any target at all (e.g. the 60-second first
  response) with target-preserving wording.
- Prompts are read from the repository's `prompts/` directory. If the tool is
  ever installed as a wheel, they must be packaged as package data or pointed
  at with `PROMPTS_ROOT`.
- The offline planner reuses fact statements verbatim as narration. It is a
  wiring check, not a creative deliverable; do not ship a `--dry-run` plan.

## Phase 3 findings
- One scene per beat. If a beat ever needs two shots, the storyboard schema
  and the `scenes_match_beats` check both have to change deliberately.
- Scene durations are the plan's beat estimates rescaled onto the target
  duration, and are bounded to 2–12 seconds. Confirm the maximum clip length
  the chosen video model actually supports before Phase 4.
- Shot prompts are English while narration is Russian. That split is
  deliberate (video models are trained on English prompts) but should be
  confirmed alongside the language decision.
- The offline shot provider writes one house-style prompt per beat kind. Like
  the offline planner it is a wiring check, not a creative treatment.
- Transitions are chosen by the model from cut/fade/dissolve. Whether
  post-production should honour them or always cut is still open.

## Phase 4 findings
- **The published video guide and the SDK disagree.** The guide summarised clip
  lengths as 16 or 20 seconds and listed `1080x1920`; the SDK's generated
  parameter types — which come from the OpenAPI spec and are what the API
  actually accepts — allow `seconds` of 4, 8 or 12 and sizes `720x1280`,
  `1280x720`, `1024x1792`, `1792x1024`, with models `sora-2` and `sora-2-pro`.
  The capability table follows the SDK. **Confirm what this account may
  request before spending anything**, and update
  `SORA_CAPABILITIES` if it differs.
- Portrait generation is therefore `720x1280`, not the Reel's `1080x1920`.
  Phase 5 has to upscale. Whether `sora-2-pro` offers a taller native size
  worth the cost is an open question.
- No scene length matches a supported clip length, so every clip is generated
  longer than its scene and trimmed in composition. That is recorded per asset
  as `duration_strategy: trim_in_post`. It also means a 40 second Reel costs
  roughly 60 seconds of generation.
- No real generation has been performed: there is still no `OPENAI_API_KEY` in
  this environment. Everything was exercised with the offline provider.
- FFmpeg is not installed here, so `ffprobe` never ran. Asset validation used
  the container reader instead, which cannot prove the video decodes. Install
  FFmpeg before trusting asset validation on real footage.
- The offline provider writes structurally valid but undecodable placeholder
  MP4s. They exist to exercise the pipeline; never ship one.
- Only video assets are generated. A storyboard that declares image, music or
  voice requirements is rejected rather than silently ignored — voice is a
  separate stage, and image support is unbuilt.
- Sora's content rules (no real people, no copyrighted material) may reject a
  shot prompt at generation time. Those failures are recorded per scene, but
  nothing pre-screens prompts against them.

## Phase 5 findings
- **No approved logo exists yet.** `input/brand/` holds only a README, so every
  Reel composed so far is a development output. Composition refuses to invent
  or typeset a substitute; supply `input/brand/logo.png` or pass `--no-logo`.
- **No narration exists yet** either: voice generation is a separate stage that
  is not built. `--silent-voice` composes a development Reel with a silent
  track. A production Reel needs `--voice`.
- Safe-area margins (16% top, 22% bottom, 8% sides) are conservative project
  design values, **not verified platform requirements**. Confirm them against
  Instagram's current interface before publishing.
- Transitions are rendered inside each scene's own time: a fade dips through
  black, a dissolve overlaps using the surplus footage Phase 4 generated. When
  a clip's surplus is smaller than the configured 0.4s the dissolve is
  shortened to fit — S-03 of the current storyboard runs at 0.25s. If a scene
  ever has less than 0.1s of surplus, composition fails rather than silently
  cutting.
- Captions come from the storyboard's `overlay_text` only. Full narration
  subtitles are not generated; that is a creative decision nobody has made.
- Every clip is upscaled from 720x1280 to 1080x1920. It is recorded per scene
  as an upscale, and the footage is not natively 1080p.
- Music is mixed at a fixed -18 dB under narration with a 1.5s fade. There is
  no sidechain ducking yet, and the level has not been checked against a
  loudness target.
- Verification here used a static FFmpeg 8.0.1 build (`static-ffmpeg`, a dev
  dependency) because the machine has no system FFmpeg. Point `FFMPEG_BIN` and
  `FFPROBE_BIN` at a system install for production runs.

## Phase 6 findings
- The audit measures caption ink against the safe area, but those margins are
  still the project's own conservative values, not verified platform
  requirements. That check is only as good as the numbers behind it.
- "Logo is readable" is a geometric check: present, fully on canvas, and at
  least 15% of the frame wide. Whether it *reads* against the footage behind
  it is a human judgement, and nothing here attempts to score image quality.
- A silent development Reel passes every blocking gate. That is deliberate —
  the file is valid — but it means release checks must use `--strict`.
- `maingott-reel all` still stops at `generate-voice`, so `compose` and
  `validate` are run individually. Wiring the full chain belongs to Phase 7,
  once voice generation exists.
- The audit reads `assets.json` and re-hashes every clip. On a real Sora run
  with large files this will be slower than it is with placeholder clips.

## Phase 7 findings
- Speech verified against the official documentation and the installed SDK
  (August 2026): `client.audio.speech.create(...)`, models `gpt-4o-mini-tts`,
  `tts-1` and `tts-1-hd`, `input` capped at 4096 characters, formats mp3 /
  opus / aac / flac / wav / pcm, `speed` 0.25–4.0, and `instructions` on the
  `gpt-4o-mini-tts` family only. **Which models and voices this account may
  use is still unconfirmed.**
- **The published voice list and the SDK's generated literal disagree.** The
  guide documents thirteen voices; the SDK's `Voice` literal names ten,
  omitting `coral`, `fable`, `nova` and `onyx` — though it also accepts any
  string. `OPENAI_VOICES` is the union, so a documented voice is never
  rejected locally. Confirm the list before choosing a production voice.
- The default voice is `marin`, chosen because the guide recommends
  `marin`/`cedar` for quality. **Nobody has approved a MainGott voice.** It is
  configuration (`VOICE_NAME`), and the choice should be made by a human who
  has listened to the options in Russian.
- The documentation says the speech models follow Whisper's language coverage
  — Russian included — but that the voices are "optimized for English". How
  the chosen voice actually sounds reading Russian is unverified and cannot be
  checked mechanically.
- The documented `speed` parameter is not stated to be unsupported on
  `gpt-4o-mini-tts`, so the capability table allows it. If the API rejects it
  for that model, `VOICE_FIT_STRATEGY=regenerate` will fail there and the
  strategy has to fall back to `fail`.
- **Still no `OPENAI_API_KEY` in this environment, so no real speech has been
  generated and no paid call has ever been made.** Everything was exercised
  with the offline provider, whose track is a quiet tone of the right length —
  useful for timing, worthless as narration.
- Whether the narration fits the Reel is only known after generation, because
  only the audio can be measured. The planner's `speech_rate` check is an
  estimate at 15 characters per second for Russian; the real rate depends on
  the voice. A first real run may well overrun 40 seconds.
- The fitting regeneration is bounded to 0.9–1.2× speed by default and costs a
  second generation when it triggers. Confirm whether re-speaking faster is
  acceptable at all, or whether an overrun should always send the script back
  to planning.
- Narration can be generated as one continuous take for the whole Reel, or
  scene by scene with `VOICE_TAKES=scene`. Cutting at the storyboard's own
  scene boundaries makes each line land on its own scene without needing the
  word-level timing the speech API does not return. What it cannot do is place
  words *inside* a scene: a take starts when its scene starts, and any slack
  is silence at the end.
- A shared speaking speed keeps the Reel's pace even, and it is chosen by the
  tightest scene. One badly sized line therefore speeds up the whole Reel.
  Whether that is better than re-planning the line is a creative judgement
  nobody has made yet; the stage reports the change rather than hiding it.
- Nothing measures whether the silence between takes sounds like a pause or
  like a gap. That is a listening question, and it belongs in the human
  review.
- `voice.json` records the whole narration text in `instructions`-free form
  only as a hash; the words themselves live in `script.json`. Anyone auditing
  what was said reads the plan, not the audio record.
- An externally approved track passed with `--voice` cannot be checked against
  the script — nothing can prove a WAV says what it should. The audit reports
  that plainly rather than implying it verified something.
- Music is still unapproved and no track exists, so every Reel so far is
  narration over silence.

## Phase 8 findings
- **No provider prices are configured, so every cost is `COST UNKNOWN`.** This
  project will not write a number it has not verified: fill in
  `input/pricing.json` from the provider's current price list, with who checked
  it and when. Until then `MAX_GENERATION_COST` can only block, not budget.
- `MAX_GENERATION_COST` is unset by default, which means no budget and
  therefore no protection beyond `--dry-run` and `--offline`. Decide a real
  ceiling before the first paid run.
- **There is still no approved MainGott logo and no approved voice.**
  `input/brand/` holds only the README and the two example registries, so every
  run is `BLOCKED` from release — correctly. Approval is a human act recorded
  in `brand.json` and `voice_profile.json`; nothing here can do it.
- The release checker verifies that the *approved* voice was used by comparing
  provider, model, voice and language against the profile. It cannot verify
  that the audio actually sounds like that voice — that is one of the human
  review items.
- Release versions are chosen by a person (`--version`, default
  `RELEASE_VERSION`). There is no automatic semantic bump: two different
  contents may carry the same version if a human says so, and the release *id*
  is the content hash either way. Whether releases should be versioned by
  content instead is an open decision.
- An approval is invalidated by any change to the production configuration
  snapshot. That snapshot deliberately excludes paths and log level, but it
  does include the text and video model ids — so upgrading a model invalidates
  every existing approval, which is intended but worth knowing.
- The human review is all-or-nothing: thirteen items, all required before
  approval. There is no partial sign-off and no separate reviewer/approver
  enforcement — the same person can confirm the review and approve. If
  segregation of duties matters, it has to be added.
- `--allow-over-budget` exists and is documented. It is the one place where a
  human can knowingly spend more than the configured ceiling; there is no
  automatic path past it.
- The provider request log records identities and hashes, never prompts or
  narration. If a future audit needs to know *exactly* what text was sent, it
  has to read `storyboard.json` and `script.json` alongside the log.
- A release package copies its metadata rather than hard-linking it, so a
  release costs roughly the size of the finished Reel again. With real Sora
  footage the runs themselves will be far larger than the releases.
- Nothing in this phase publishes, uploads, schedules or measures anything,
  and no social-media credential exists anywhere in the project.
- Still **no `OPENAI_API_KEY` in this environment, and no paid API call has
  ever been made** by any phase of this project.

## Phase 9 findings — pre-flight (2026-08-21)

Nothing has been generated against the real providers yet. These are the
findings from preparing to.

### Resolved
- **The Sora parameter discrepancy is settled.** The endpoint reference
  (generated from the OpenAPI spec) and the installed SDK 3.3.0 agree exactly:
  `seconds` ∈ 4/8/12, `size` ∈ 720x1280 / 1280x720 / 1024x1792 / 1792x1024.
  The prose guide's 16/20 s at 1080x1920 describes the Sora product and its
  extension flow, not `POST /v1/videos`. `SORA_CAPABILITIES` was already
  correct; portrait footage stays 720x1280 upscaled in post. Re-checked
  2026-08-21.
- Speech capabilities re-verified unchanged: 13 voices, 4096 input characters,
  speed 0.25–4.0, `instructions` on the `gpt-4o-mini-tts` family only.
- Prices are published and now configured: sora-2 $0.10 per generated second
  (720p), gpt-4o-mini-tts $0.60 per 1M input tokens.

### Found by real use
- **The shipped registry templates could not be copied.** `brand.json`,
  `voice_profile.json` and `pricing.json` all carried a `note` key that
  `extra="forbid"` rejected, so a copied template loaded as *nothing* and was
  reported as "no registry" — indistinguishable from never having created one.
  Fixed: the three models accept a `note`, and a malformed file now raises
  instead of being silently treated as absent.
- **Speech is billed per token, not per character**, which the pricing model
  could not express. A token count needs a tokenizer this project does not
  ship, so narration is priced at one token per character — a true ceiling for
  any tokenizer — and every such figure is labelled "at most". For 529
  characters of Russian the real cost will be roughly a third of the bound.
- **Text generation is not priced at all.** `PricingTable` covers video and
  voice only, so `plan` and `storyboard` against the real text model are
  invisible to `cost-estimate` and to the budget. They are cents, but they are
  unaccounted cents.

### Blocking the pilot
- **No budget is configured.** `MAX_GENERATION_COST` is empty, and Phase 9
  requires an explicit ceiling before any paid generation.
- **The logo is supplied but not approved.** `input/brand/logo.png`
  (1007x190, RGBA, sha256 `613511501fba72af`) is now registered in
  `brand.json` with its real hash — deliberately as `approved: false`, because
  an approval has to name a person and nothing here may invent one.
- **No voice has been auditioned or approved.** `voice_profile.json` still
  names `marin` from the template with `approved: false`. `voice-audition`
  now exists to record candidates for a human to judge.
- **The current run's script is offline-planner output.** Its narration is raw
  specification fragments including bullet characters — "Сайт • Telegram • MAX
  • VK • VK Видео • YouTube" — which is a wiring artifact, not an
  advertisement, and would be unspeakable read aloud. A production pilot has
  to re-run `plan` and `storyboard` against the real text model first. This
  was always documented, but it is easy to miss that the composed 40-second
  development Reel is built on it.

### Estimated pilot cost (verified prices, nothing spent)
8 clips totalling 56 generated seconds at $0.10/s = **$5.60**, plus 529
characters of narration at ≤ $0.0004. Text planning is unpriced. Re-running
`plan`/`storyboard` changes the shot prompts, so the video estimate applies to
whatever storyboard is finally approved, not to this one.
