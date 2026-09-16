# OpenAI Integration

OpenAI is a provider, not the application architecture.

Keep OpenAI-specific code under `src/maingott_reel/providers/`.

Logical capabilities:
- text/structured planning
- image generation
- video generation
- voice/audio generation

Provider interfaces should resemble:
```python
class TextProvider: ...


class ImageProvider: ...


class VideoProvider: ...


class VoiceProvider: ...
```

Verify current official OpenAI documentation before implementing endpoint calls. Do not rely on old tutorials or undocumented parameters.

## Verified capabilities (re-checked 2026-08-21)

| capability | verified value | source |
| --- | --- | --- |
| video models | `sora-2`, `sora-2-pro`, plus dated snapshots | API reference + SDK 3.3.0 |
| video `seconds` | `4`, `8`, `12` (default 4) | API reference + SDK 3.3.0 |
| video `size` | `720x1280`, `1280x720`, `1024x1792`, `1792x1024` | API reference + SDK 3.3.0 |
| speech models | `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` (+ snapshot) | API reference |
| speech voices | 13 built-in, incl. `marin`, `cedar` | API reference |
| speech formats | mp3, opus, aac, flac, wav, pcm | API reference |
| speech `speed` | 0.25–4.0, default 1.0 | API reference |
| speech `instructions` | not supported on `tts-1`/`tts-1-hd` | API reference |
| speech input limit | 4096 characters | API reference |
| sora-2 price | $0.10 per generated second (720p) | pricing page |
| gpt-4o-mini-tts price | $0.60 per 1M text input tokens | pricing page |

**The prose video guide and the API reference disagree, and the reference
wins.** The guide describes 16/20 second generations at 1920x1080 and 1080x1920
— those belong to the Sora product and its extension flow (up to 120 s), not to
`POST /v1/videos`. The endpoint reference, generated from the OpenAPI spec,
and the installed SDK's generated types agree exactly with each other on
4/8/12 seconds and the four sizes above. `SORA_CAPABILITIES` encodes the
reference, which is why portrait footage is generated at 720x1280 and upscaled
in post.

Speech is billed **per token**, not per character. This project does not ship a
tokenizer, so it prices narration at one token per character — a ceiling for
any tokenizer — and labels the result as an upper bound rather than a figure.

Handle authentication errors, rate limits, transient failures, malformed outputs, timeouts and provider failures.

Record model, duration, resolution, generation count and usage/cost metadata where available.

Never expose secrets in logs, prompts or generated files.

## Speech requests in scene mode

With `VOICE_TAKES=scene` the voice stage sends one speech request per distinct
take rather than one per Reel. The text of a request is the voiceover of a
single storyboard scene, the `speed` parameter is the shared speed of the
current round (omitted for the provider default), and every other parameter
(model, voice, format, instructions, language) is the same for every take in
the run. Two scenes with identical words at the same speed share one request;
the second is served from the local cache, in this run and in later ones.

A regenerate round therefore costs one request per take that is not already
cached at the new speed. `cost-estimate` counts requests the same way, so the
number it prints is the number of calls the stage would still make.

### A refused request ends the round

Requests go out one at a time, in storyboard order, and the round stops at the
first one the provider will not answer. The scenes after it are never sent, so
a voice the account cannot use, or a format it does not offer, costs one
rejected request rather than one per scene. The run's request log shows the
successes that came before it and the rejection that ended it, in that order.

Each answered request is written to the cache as it arrives, not at the end of
the round, which is what makes a stopped round worth resuming: the next attempt
finds those takes already there and sends requests only for the scenes that
were never reached. Nothing distinguishes a resumed attempt from a first one in
the code that talks to the provider — it asks for what is not cached, and after
a stopped round that happens to be the tail of the Reel.
