`generate-voice` speaks whole approved script as one track, measured against
whole Reel, so a line running past its own scene stays invisible until
somebody watches the result. Cut narration to scenes instead.

Add `VOICE_TAKES`, either `whole` (still default) or
`scene`. In `scene` mode speak each storyboard scene's `voiceover` as its own
take. Release configuration records it like every other setting.

Every take has to be heard inside its own scene, measured from audio rather
than character counts, with same tolerance timeline check already allows.
When one is not, stop and name every overrunning scene.
When a take overruns and `VOICE_FIT_STRATEGY=regenerate`, re-speak every take
once at one shared speed: slowest that makes all of them fit, because
a Reel must not change pace between scenes. Should it fall outside
`VOICE_MIN_SPEED`..`VOICE_MAX_SPEED`, stop and say so. Words never change.

A take that cannot be spoken stops the round. Later scenes stay unspoken, and
another attempt at that run speaks only what is still missing. Inside one
run identical words at same speed are generated once, and `--force` does not
change that. `cost-estimate` reports one planned item per take, naming its
scene, counting one call per take it would still generate.

Takes land on storyboard timeline: each starts at its scene's start instant,
silence fills what is left, finished file runs exactly storyboard's
length. Rescale a storyboard and narration has to be laid down again.
`voice.json` stays one track for whole approved script, so `narration_sha256`
is still hash of plan's narration. Carry `takes` beside it, one entry per
spoken take in scene order, each with `scene_id`, `start_seconds`,
`duration_seconds` and `speed`, null where provider default was used. Recorded
speech metrics describe words spoken, never silence.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
