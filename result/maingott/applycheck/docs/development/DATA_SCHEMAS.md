# Data Schemas

Use Pydantic.

## SourceBlock
`index, line, text, block_type, style, heading_level, section, subsection, page, table_index, row_index`

Blocks are emitted in document order. `line` is the 1-based position of the
block in the flattened document and is what facts reference; `page` is filled
only when the DOCX records rendered page breaks.

## Fact
`id, statement, source_page, source_lines, category, claim_status, source_quote, section, notes`

`statement` is copied verbatim from the specification. `category` is a keyword
heuristic used for grouping. `claim_status` is `target` for anything that reads
as a design target, KPI or acceptance threshold, and `supported` otherwise;
`unsupported` is reserved for claim checking in later stages.

## CreativeBrief
`version, objective, audience, platform, aspect_ratio, target_duration_seconds, language, tone, visual_direction, core_message, supporting_messages, cta, restrictions, source_fact_ids`

## ClaimReference
`claim, kind, source_fact_ids`

`kind` is `factual` or `target`. `source_fact_ids` is never empty: a claim
without a source is invalid by construction.

## ScriptBeat
`id, order, kind, purpose, narration, on_screen_text, visual_direction, estimated_seconds, claims`

`kind` is `framing` (no MainGott claims, no numbers), `factual` or `brand`.
Factual and brand beats must carry at least one claim.

## ScriptPlan
`version, created_at, language, target_duration_seconds, total_estimated_seconds, narration, beats, source_fact_ids, claims, validation, provenance`

`narration`, `source_fact_ids`, `claims` and the total are derived from the
beats, so the artifact cannot disagree with itself.

## PlanProvenance
`planner_version, prompt_version, system_prompt_sha256, user_prompt_sha256, provider, model, generated_at, source_sha256, offered_fact_ids, attempts, input_tokens, output_tokens, target_facts_allowed`

## Scene
`id, beat_id, start_seconds, duration_seconds, purpose, visual_description, video_prompt, voiceover, overlay_text, source_fact_ids, asset_requirements, transition`

`beat_id` ties the scene to the script beat it realises. `voiceover`,
`overlay_text` and `source_fact_ids` are copies of that beat's values.

## AssetRequirement
`asset_type, prompt, duration_seconds, notes`

## Storyboard
`version, created_at, language, target_duration_seconds, total_duration_seconds, narration_sha256, scenes, source_fact_ids, validation, provenance`

The timeline is gapless and sums to the target duration. `narration_sha256`
binds the storyboard to the plan it was built from, so a replanned run cannot
silently keep old scenes.

## Asset
`id, asset_type, status, source, scene_id, beat_id, provider, model, prompt, prompt_hash, prompt_version, cache_key, requested_duration_seconds, generated_duration_seconds, duration_strategy, requested_width, requested_height, path, sha256, size_bytes, actual_duration_seconds, actual_width, actual_height, codec, frame_rate, created_at, attempts, cache_hit, generation_metadata, validation, error`

`requested_*` is what the storyboard asked for, `generated_*` what the provider
was asked to make, and `actual_*` what the finished file turned out to be.
`duration_strategy` records how the three were reconciled.

## AssetCollection
`generation_version, created_at, source_sha256, storyboard_sha256, narration_sha256, provider, model, assets`

The three hashes answer "which storyboard and which prompt produced this file".

## SpeechMetrics
`characters, words, duration_seconds, timeline_seconds`

Measured from the generated audio, not from provider metadata.
`characters_per_second`, `words_per_minute`, `headroom_seconds` and
`fits_timeline` are derived.

## VoiceAsset
`version, id, asset_type, status, source, created_at, provider, model, voice, language, audio_format, speed, instructions, instructions_sha256, cache_key, narration_sha256, narration_characters, storyboard_sha256, target_duration_seconds, path, sha256, size_bytes, duration_seconds, sample_rate, channels, codec, metrics, attempts, cache_hit, development, transformations, generation_metadata, validation, provenance, error`

Persisted as `voice.json`. `narration_sha256` is the hash of the *exact*
approved narration in `script.json` and is what binds the audio to the script:
composition and the audit both refuse a track whose hash does not match.
`transformations` records every deliberate change to the audio — today only a
regeneration at a different speaking speed — and the words are never among
them. `development` marks a placeholder track.

## NarrationTake
`scene_id, text_sha256, cache_key, characters, start_seconds, duration_seconds,
scene_seconds, speed, cache_hit`

One scene's narration inside a track that was spoken scene by scene. A take is
not an asset of its own: the run holds one narration file, and these say which
words were spoken for which scene, where they sit on the timeline, how long
they turned out to be and how fast they were delivered. `speed` is null when
the provider's default was used. `end_seconds`, `headroom_seconds` and
`fits_scene` are derived. `VoiceAsset.takes` is empty for a Reel spoken as one
take, which is what `VOICE_TAKES=whole` does and what happens by default.

## Composition
`version, created_at, run_id, language, target_duration_seconds, timeline_duration_seconds, settings, scenes, captions, audio, logo, font, styles, source_sha256, storyboard_sha256, narration_sha256, assets_sha256, composition_sha256, output_path, output_sha256, output_size_bytes, validation, readiness, development`

`validation` is the pass/fail gate for the file. `readiness` is separate: a
development Reel — silent, or without an approved logo — is a valid file that
must not be published, and `development` says so.

## TimelineScene
`scene_id, beat_id, order, asset_id, source_path, source_duration_seconds, trim_start_seconds, trim_duration_seconds, start_seconds, duration_seconds, transition, transition_seconds, geometry, normalized_path`

## CaptionCue
`id, scene_id, text, role, start_seconds, end_seconds, image_path`

`text` is copied verbatim from the storyboard's `overlay_text`.

## AudioPlan
`voice_path, voice_sha256, voice_duration_seconds, voice_asset_id, voice_provider, voice_model, voice_name, voice_narration_sha256, voice_is_development, music_path, music_sha256, voice_gain_db, music_gain_db, music_fade_seconds, sample_rate, channels, silent`

The `voice_*` provenance fields are filled when the narration came from the
voice stage, so a finished Reel records which approved narration was spoken
and what produced it. A track supplied with `--voice` carries the path and the
hash only.

## CompositionSettings
`width, height, fps, video_codec, video_preset, video_crf, pixel_format, audio_codec, audio_bitrate, crop_policy, transition_seconds, min_transition_seconds, caption_lead_in_seconds, caption_lead_out_seconds, safe_area, logo_width_ratio`

## PricingTable
`version, currency, source, verified_at, video{model: ModelPrice}, voice{model: ModelPrice}`

Read from `input/pricing.json`. `ModelPrice` is
`per_second_usd, per_1k_characters_usd, notes`, and every price is optional:
an unpriced model produces an unknown cost, never a zero. `source` and
`verified_at` record who checked the numbers against the provider.

## CostLine / CostReport
`kind, provider, model, calls, units, unit, unit_price_usd, cost_usd, detail`

`CostReport` holds the lines plus `budget_usd`, `pricing_source` and
`pricing_path`. `known` is false when any payable line could not be priced,
and an unknown report has **no total**.

## GenerationPlan
`version, run_id, created_at, dry_run, offline, configuration_sha256, items, cost`

Persisted as `generation_plan.json` before any paid generation. Each
`PlannedGeneration` is `kind, identity, scene_id, provider, model, seconds,
width, height, characters, cache_state`.

## ProviderRequestRecord
`timestamp, run_id, provider, model, operation, outcome, identity, scene_id, prompt_sha256, narration_sha256, seconds, width, height, voice, language, speed, characters, attempt, max_attempts, paid, detail, metadata`

One line per request in `logs/provider_requests.jsonl`. `outcome` is
`cache_hit`, `success`, `retried`, `failed` or `rejected`; a cache hit is never
`paid`. Free-text detail is redacted on the way in, and no prompt, narration or
credential is ever recorded.

## BrandAsset / BrandRegistry
`asset_id, asset_type, path, sha256, version, approved, approved_by, approved_at, width, height, transparency, notes`

Read from `input/brand/brand.json`, never written by this project. An asset
counts as approved only when `approved` is true, `approved_by` names somebody,
and the file still hashes to `sha256`.

## VoiceProfile
`version, provider, model, voice, language, speed, approved, approved_by, approved_at, approval_notes`

Read from `input/brand/voice_profile.json`. The release checker requires it,
requires `approved`, and requires the voice actually used to match it exactly.

## ArtifactFingerprint
`source_sha256, plan_sha256, storyboard_sha256, assets_sha256, voice_sha256, narration_sha256, composition_sha256, final_sha256, configuration_sha256`

The identity of one Reel's content, end to end. `identity` is the hash of all
of it and `release_id` is `rel-<first 16 hex>`. An approval is bound to this,
so any change anywhere in the chain invalidates it.

## ConfigurationSnapshot
`pipeline_version, composition_version, planner_version, storyboard_version, asset_generation_version, voice_version, prompt_versions, text_*, video_*, voice_*, language, target_duration_seconds, duration_bounds, width, height, fps, video_codec, video_crf, video_preset, audio_codec, audio_bitrate, transition_seconds, music_gain_db, allow_target_facts`

Persisted as `configuration.json`. Only settings that change the output are
included — no secrets, no paths, no log level — so an unrelated environment
change never invalidates an approval.

## ReviewItem / ReviewChecklist
`id, question, category, confirmed, confirmed_by, confirmed_at, note`

Persisted as `review.json`, bound to `final_sha256`. Nothing in this project
may confirm an item; a re-composed Reel starts the review again.

## ApprovalRecord
`version, run_id, release_version, status, approved_by, approved_at, notes, fingerprint, review_sha256`

Persisted as `approval.json`. `status` is `approved` or `rejected`.
`covers(fingerprint)` is what makes it usable; it is never updated in place.

## ReleaseManifest
`package_version, release_id, release_version, run_id, created_at, fingerprint, approval_sha256, approved_by, approved_at, configuration, text_provider, video_provider, video_model, voice_provider, voice_model, voice_name, development, duration_seconds, width, height, files`

Persisted as `release.json` inside `output/releases/<release_id>/`. Each
`ReleaseFile` is `name, path, sha256, size_bytes`. A development Reel can never
be packaged, and `release_id` must match the fingerprint it claims to describe.

## QualityGate
`name, group, passed, severity, detail`

`group` is `run`, `claims`, `voice`, `file`, `presentation`, `readiness` or
`release`. `severity` is `error` (blocks acceptance) or `warning` (advisory).
The `release` group is produced by `release-check` only; `validate` never emits
it, so the Phase 6 gates are unchanged.

## QualityReport
`version, created_at, run_id, gates`

Persisted as `validation.json`. `passed` means every blocking gate passed;
`production_ready` means nothing failed at all.

## RunManifest
`run_id, created_at, source_hash, prompt_version, models, files, stages, composition, validation, quality, release_state, estimated_cost`

`release_state` is `draft`, `validated`, `release_candidate`, `approved` or
`rejected`, and is recorded by `release-check`.
