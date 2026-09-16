# Advertising Claims Policy

Every factual marketing statement must be supported by the MainGott specification.

## Allowed
- MainGott is positioned as a Sales & Operations OS.
- MainGott combines AI, CRM, automation, integrations, analytics, web development and operational management.
- The platform is designed around minimizing the customer path to purchase.
- The specification includes website, Telegram, MAX, VK, YouTube, Instagram and FarPost contours.
- Bitrix24 is the main system for client/deal data.
- The AI architecture includes RAG, memory, guardrails and evaluation.

## Target values
Numbers described as design targets must not be presented as achieved results.

Example:
Do not convert a target response time into `We already respond in 60 seconds`.

## Forbidden unless separately approved
- invented customers
- invented revenue
- invented ROI
- invented conversion rates
- invented user counts
- `best`, `number one`, `guaranteed`
- unsupported performance claims
- unsupported autonomous AI claims
- bypassing platform restrictions

## Required metadata
Each factual scene claim should contain `source_fact_ids`.
Unsupported claims must be rejected.

## How this is enforced
The planner (Phase 2) applies these rules mechanically in
`src/maingott_reel/creative/claims.py`, after the model has answered:

| Rule | Check |
| --- | --- |
| every factual claim is sourced | `claims_have_sources`, `beats_cite_facts` |
| referenced facts exist | `facts_exist` |
| unsupported facts are never used | `no_unsupported_facts` |
| only facts offered to the planner may be cited | `facts_were_offered` |
| design targets stay targets | `target_facts_not_presented_as_achieved` |
| a plan rests on real facts | `fact_coverage` |
| no superlatives or absolute claims | `no_unsupported_superlatives` |
| no team members | `no_team_members` |
| no leftover placeholders | `no_placeholder_text` |
| duration, beat count, speakable narration | `duration_within_bounds`, `beat_count`, `speech_rate` |

Design-target facts are withheld from the planner entirely unless a run passes
`--allow-target-facts`. When they are allowed, a claim citing one must be
declared as a target and worded so it still reads as intent.

The storyboard stage (Phase 3) is checked separately in the same module:
`spoken_content_unchanged` proves the narration, captions and fact references
still match the approved plan, and `no_text_in_footage` keeps readable
lettering and logos out of generated video.

The voice stage (Phase 7) speaks the approved narration and nothing else. It
has no way to reword it: the provider is handed `script.json`'s narration
verbatim, the voice direction steers delivery only, and the audio carries
`narration_sha256` — the hash of the exact text it spoke. Composition refuses
a track whose hash does not match the storyboard it is mixing. If the approved
words cannot be spoken inside the Reel's timeline, the stage fails and says
so; the script is never shortened to make it fit.

`maingott-reel validate` runs the same claim checks again against the finished
Reel, so a claim cannot be approved at planning time and then quietly change:
the captions must still be the approved wording, the narration must still be
the approved narration, the narration that was *spoken* must be that same
approved text, and every cited fact must still exist.

The wording lists are guardrails, not a substitute for human review of
`creative_brief.json`, `script.json` and `storyboard.json`.
