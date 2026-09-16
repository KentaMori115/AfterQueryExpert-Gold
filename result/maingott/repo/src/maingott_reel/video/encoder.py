"""The FFmpeg pipeline that renders a timeline into a Reel.

Rendering happens in explicit passes, each writing an intermediate file under
``composition/`` so a finished Reel can be taken apart and inspected:

1. ``normalized/`` — one clip per scene, trimmed to its timeline slot, scaled
   to cover the canvas, centre-cropped, at the target frame rate;
2. ``video/sequence.mp4`` — the scenes joined, cut by cut and dissolve by
   dissolve;
3. ``captions/`` — one transparent PNG per caption, plus the logo;
4. ``video/overlaid.mp4`` — captions and logo laid over the sequence;
5. ``audio/mix.m4a`` — narration and music mixed to the timeline's length;
6. ``final/maingott_reel.mp4`` — video and audio muxed together.

Generated assets are only ever read. Nothing here modifies them.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from maingott_reel.errors import CompositionError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    AudioPlan,
    CaptionCue,
    CompositionSettings,
    LogoPlan,
    SceneTransition,
    TimelineScene,
)
from maingott_reel.utils.ffmpeg import FFmpeg, FFmpegError

logger = get_logger("video.encoder")


@dataclass(frozen=True)
class CompositionPaths:
    """Where each pass writes its output."""

    root: Path

    @property
    def normalized(self) -> Path:
        return self.root / "normalized"

    @property
    def video(self) -> Path:
        return self.root / "video"

    @property
    def captions(self) -> Path:
        return self.root / "captions"

    @property
    def audio(self) -> Path:
        return self.root / "audio"

    @property
    def sequence(self) -> Path:
        return self.video / "sequence.mp4"

    @property
    def overlaid(self) -> Path:
        return self.video / "overlaid.mp4"

    @property
    def mix(self) -> Path:
        return self.audio / "mix.m4a"

    def create(self) -> None:
        """Create the working directories."""
        for directory in (self.normalized, self.video, self.captions, self.audio):
            directory.mkdir(parents=True, exist_ok=True)


def _video_codec_args(settings: CompositionSettings) -> list[str]:
    """Encoder arguments shared by every video pass."""
    return [
        "-c:v",
        settings.video_codec,
        "-preset",
        settings.video_preset,
        "-crf",
        str(settings.video_crf),
        "-pix_fmt",
        settings.pixel_format,
        "-r",
        str(settings.fps),
        "-an",
    ]


def normalize_scene(
    scene: TimelineScene,
    previous: TimelineScene | None,
    settings: CompositionSettings,
    paths: CompositionPaths,
    ffmpeg: FFmpeg,
) -> Path:
    """Render one scene's clip onto the canvas, trimmed to its slot.

    Fades declared by the storyboard are drawn here, inside the scene's own
    time, so no scene loses screen time to a transition.
    """
    geometry = scene.geometry
    filters = [
        f"trim=start={scene.trim_start_seconds}:duration={scene.trim_duration_seconds}",
        "setpts=PTS-STARTPTS",
        f"scale={geometry.scaled_width}:{geometry.scaled_height}:flags=lanczos",
        f"crop={geometry.output_width}:{geometry.output_height}:{geometry.crop_x}:{geometry.crop_y}",
        f"fps={settings.fps}",
        "setsar=1",
        f"format={settings.pixel_format}",
    ]

    fade = settings.transition_seconds
    if previous is not None and previous.transition is SceneTransition.FADE:
        filters.append(f"fade=t=in:st=0:d={fade}")
    if scene.transition is SceneTransition.FADE:
        start = max(scene.trim_duration_seconds - fade, 0.0)
        filters.append(f"fade=t=out:st={round(start, 3)}:d={fade}")

    destination = paths.normalized / f"{scene.scene_id.lower().replace('-', '_')}.mp4"
    ffmpeg.encode(
        inputs=[scene.source_path],
        output=destination,
        filter_complex=f"[0:v]{','.join(filters)}[v]",
        maps=["[v]"],
        codec_args=_video_codec_args(settings),
        label=f"normalize {scene.scene_id}",
    )
    return destination


def build_sequence(
    scenes: list[TimelineScene],
    settings: CompositionSettings,
    paths: CompositionPaths,
    ffmpeg: FFmpeg,
) -> Path:
    """Join the normalized scenes into one continuous timeline.

    Cuts are joins; dissolves are cross-fades whose overlap was already paid
    for out of surplus footage, so the result is exactly as long as the
    storyboard says.

    Raises:
        CompositionError: a scene was not normalized first.
    """
    inputs: list[Path] = []
    for scene in scenes:
        if scene.normalized_path is None or not scene.normalized_path.is_file():
            raise CompositionError(f"Scene {scene.scene_id} has not been normalized.")
        inputs.append(scene.normalized_path)

    if len(scenes) == 1:
        return _copy_stream(inputs[0], paths.sequence, settings, ffmpeg)

    # xfade insists that both of its inputs share a time base and frame rate,
    # so every clip is put on the same footing before the chain is built.
    steps: list[str] = [
        f"[{index}:v]fps={settings.fps},settb=AVTB,setpts=PTS-STARTPTS,"
        f"format={settings.pixel_format}[c{index}]"
        for index in range(len(scenes))
    ]
    label = "c0"
    for index in range(1, len(scenes)):
        previous = scenes[index - 1]
        output = f"s{index}"
        if previous.transition is SceneTransition.DISSOLVE:
            steps.append(
                f"[{label}][c{index}]xfade=transition=fade:"
                f"duration={previous.transition_seconds}:"
                f"offset={scenes[index].start_seconds}[{output}]"
            )
        else:
            steps.append(f"[{label}][c{index}]concat=n=2:v=1:a=0[{output}]")
        label = output

    ffmpeg.encode(
        inputs=inputs,
        output=paths.sequence,
        filter_complex=";".join(steps),
        maps=[f"[{label}]"],
        codec_args=_video_codec_args(settings),
        label="sequence",
    )
    return paths.sequence


def _copy_stream(
    source: Path, destination: Path, settings: CompositionSettings, ffmpeg: FFmpeg
) -> Path:
    """Re-encode a single clip into the sequence position."""
    ffmpeg.encode(
        inputs=[source],
        output=destination,
        codec_args=_video_codec_args(settings),
        label="sequence",
    )
    return destination


def overlay_text_and_logo(
    sequence: Path,
    captions: list[CaptionCue],
    logo: LogoPlan | None,
    settings: CompositionSettings,
    paths: CompositionPaths,
    ffmpeg: FFmpeg,
) -> Path:
    """Lay the captions and the approved logo over the sequence.

    Raises:
        CompositionError: a caption image is missing.
    """
    overlays: list[tuple[Path, str, str, float, float]] = []
    for cue in captions:
        if cue.image_path is None or not cue.image_path.is_file():
            raise CompositionError(f"Caption {cue.id} has not been rendered.")
        overlays.append((cue.image_path, "0", "0", cue.start_seconds, cue.end_seconds))
    if logo is not None:
        overlays.append(
            (
                logo.path,
                str(logo.position_x),
                str(logo.position_y),
                logo.start_seconds,
                logo.end_seconds,
            )
        )

    if not overlays:
        return sequence

    steps: list[str] = []
    label = "0:v"
    for index, (_, x, y, start, end) in enumerate(overlays, start=1):
        output = f"o{index}"
        steps.append(
            f"[{label}][{index}:v]overlay={x}:{y}:enable='between(t,{start},{end})'[{output}]"
        )
        label = output

    ffmpeg.encode(
        inputs=[sequence, *[item[0] for item in overlays]],
        output=paths.overlaid,
        filter_complex=";".join(steps),
        maps=[f"[{label}]"],
        codec_args=_video_codec_args(settings),
        label="overlay",
    )
    return paths.overlaid


def build_audio(
    audio: AudioPlan,
    duration_seconds: float,
    settings: CompositionSettings,
    paths: CompositionPaths,
    ffmpeg: FFmpeg,
) -> Path:
    """Mix the soundtrack to exactly the timeline's length.

    Narration plays at its own level; music sits under it at a fixed offset
    and fades in and out. Nothing here can make the Reel longer: every source
    is padded or trimmed to the timeline.
    """
    rate, channels = audio.sample_rate, audio.channels
    layout = "stereo" if channels == 2 else "mono"
    duration = round(duration_seconds, 3)

    if audio.silent or audio.voice_path is None:
        ffmpeg.encode(
            inputs=[Path(f"anullsrc=r={rate}:cl={layout}")],
            output=paths.mix,
            extra_input_args=[["-f", "lavfi"]],
            codec_args=[
                "-t",
                str(duration),
                "-c:a",
                settings.audio_codec,
                "-b:a",
                settings.audio_bitrate,
            ],
            label="silent audio",
        )
        return paths.mix

    voice_chain = (
        f"[0:a]aformat=sample_rates={rate}:channel_layouts={layout},"
        f"volume={audio.voice_gain_db}dB,"
        f"apad,atrim=duration={duration},asetpts=PTS-STARTPTS[voice]"
    )
    if not audio.has_music:
        ffmpeg.encode(
            inputs=[audio.voice_path],
            output=paths.mix,
            filter_complex=voice_chain,
            maps=["[voice]"],
            codec_args=[
                "-t",
                str(duration),
                "-c:a",
                settings.audio_codec,
                "-b:a",
                settings.audio_bitrate,
            ],
            label="voice audio",
        )
        return paths.mix

    assert audio.music_path is not None  # narrowed by has_music
    fade = audio.music_fade_seconds
    music_chain = (
        f"[1:a]aformat=sample_rates={rate}:channel_layouts={layout},"
        f"volume={audio.music_gain_db}dB,"
        f"apad,atrim=duration={duration},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d={fade},"
        f"afade=t=out:st={max(duration - fade, 0)}:d={fade}[music]"
    )
    mix = "[voice][music]amix=inputs=2:duration=first:normalize=0[mixed]"
    ffmpeg.encode(
        inputs=[audio.voice_path, audio.music_path],
        output=paths.mix,
        filter_complex=";".join([voice_chain, music_chain, mix]),
        maps=["[mixed]"],
        codec_args=[
            "-t",
            str(duration),
            "-c:a",
            settings.audio_codec,
            "-b:a",
            settings.audio_bitrate,
        ],
        label="audio mix",
    )
    return paths.mix


def mux(
    video: Path,
    audio: Path,
    destination: Path,
    duration_seconds: float,
    settings: CompositionSettings,
    ffmpeg: FFmpeg,
) -> Path:
    """Put the finished picture and sound together.

    The video is copied rather than re-encoded — it is already final — and the
    output is pinned to the timeline's length so a long audio file cannot
    stretch the Reel.
    """
    ffmpeg.encode(
        inputs=[video, audio],
        output=destination,
        maps=["0:v:0", "1:a:0"],
        codec_args=[
            "-c:v",
            "copy",
            "-c:a",
            "copy",
            "-t",
            str(round(duration_seconds, 3)),
            "-movflags",
            "+faststart",
        ],
        label="mux",
    )
    return destination


def require_ffmpeg(ffmpeg: FFmpeg) -> str:
    """Return the FFmpeg version, or explain that it is missing.

    Raises:
        CompositionError: FFmpeg is not installed.
    """
    try:
        return ffmpeg.version()
    except FFmpegError as error:
        raise CompositionError(f"FFmpeg is required to compose the Reel: {error}") from error
