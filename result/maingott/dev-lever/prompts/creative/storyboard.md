---
version: 3
---
Design the shots for a vertical 9:16 Instagram Reel for MainGott.

Total duration: {{duration_seconds}} seconds across {{scene_count}} shots.
The narration language is {{language}}; the shot prompts stay in English.

Each beat below is already approved. Its narration, on-screen caption, purpose
and duration are fixed — return one shot per beat, keeping the beat ids.

For every beat give:
- `beat_id`: exactly as listed
- `visual_description`: a short reviewer-facing note
- `video_prompt`: one English paragraph for the video model
- `transition`: cut, fade or dissolve

Post-production will place the beat's caption over the shot, so leave a clean,
empty area for it — described as empty space, never by naming what will go
there. The forbidden vocabulary in the system instructions applies to every
`video_prompt` you return.

Shots should read as one continuous piece: a dark, connected world that
assembles itself as the narration progresses, and resolves into a calm, empty
frame at the end where the brand mark will be placed in post-production.

BEATS
{{beats}}
{{feedback}}
