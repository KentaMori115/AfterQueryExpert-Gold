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
