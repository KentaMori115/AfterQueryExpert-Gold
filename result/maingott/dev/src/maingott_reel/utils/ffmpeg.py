"""Running FFmpeg.

Every invocation goes through here so that commands are built as argument
lists (never shell strings), failures carry FFmpeg's own diagnostics, and the
exact command line can be recorded for reproduction.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from maingott_reel.logging_config import get_logger

logger = get_logger("utils.ffmpeg")

#: Generous ceiling for one encode of a 40 second Reel.
DEFAULT_TIMEOUT_SECONDS = 1800


class FFmpegError(RuntimeError):
    """An FFmpeg invocation failed."""

    def __init__(self, message: str, command: list[str], stderr: str = "") -> None:
        self.command = command
        self.stderr = stderr
        super().__init__(message)


@dataclass(frozen=True)
class FFmpegResult:
    """The outcome of one invocation."""

    command: list[str]
    returncode: int
    stdout: str
    stderr: str


class FFmpeg:
    """Thin, safe wrapper around the ``ffmpeg`` binary."""

    def __init__(
        self, binary: str = "ffmpeg", timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS
    ) -> None:
        """Store the binary to call."""
        self._binary = binary
        self._timeout = timeout_seconds

    @property
    def binary(self) -> str:
        """The configured binary."""
        return self._binary

    def is_available(self) -> bool:
        """Whether the binary can be found."""
        return shutil.which(self._binary) is not None or Path(self._binary).is_file()

    def version(self) -> str:
        """Return the first line of ``ffmpeg -version``.

        Raises:
            FFmpegError: the binary is missing or failed.
        """
        result = self.run(["-version"], label="version")
        return result.stdout.splitlines()[0] if result.stdout else ""

    def run(self, arguments: list[str], label: str = "ffmpeg") -> FFmpegResult:
        """Run FFmpeg with ``arguments``.

        Args:
            arguments: argument list, without the binary itself.
            label: what this step is, used in logs and error messages.

        Raises:
            FFmpegError: the binary is missing, timed out, or exited non-zero.
        """
        command = [self._binary, *arguments]
        logger.debug("running ffmpeg", extra={"step": label, "arguments": len(arguments)})
        try:
            completed = subprocess.run(  # arguments are a list; no shell involved
                command,
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=False,
            )
        except FileNotFoundError as error:
            raise FFmpegError(
                f"{self._binary} is not installed. FFmpeg is required for composition.",
                command,
            ) from error
        except subprocess.TimeoutExpired as error:
            raise FFmpegError(
                f"{self._binary} timed out after {self._timeout}s during '{label}'.", command
            ) from error

        if completed.returncode != 0:
            tail = "\n".join(completed.stderr.strip().splitlines()[-12:])
            raise FFmpegError(
                f"FFmpeg failed during '{label}' (exit {completed.returncode}):\n{tail}",
                command,
                completed.stderr,
            )
        return FFmpegResult(
            command=command,
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )

    def encode(
        self,
        inputs: list[Path],
        output: Path,
        filter_complex: str | None = None,
        maps: list[str] | None = None,
        extra_input_args: list[list[str]] | None = None,
        codec_args: list[str] | None = None,
        label: str = "encode",
    ) -> Path:
        """Run one encoding step and return the output path.

        The output is written to a temporary file first and moved into place,
        so a failed step never leaves a half-written artifact behind.

        Raises:
            FFmpegError: the invocation failed.
        """
        output.parent.mkdir(parents=True, exist_ok=True)
        # Keep the real extension: FFmpeg picks its muxer from the suffix.
        partial = output.with_name(f".{output.stem}.part{output.suffix}")
        arguments: list[str] = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
        for index, source in enumerate(inputs):
            if extra_input_args and index < len(extra_input_args):
                arguments.extend(extra_input_args[index])
            arguments.extend(["-i", str(source)])
        if filter_complex:
            arguments.extend(["-filter_complex", filter_complex])
        for mapping in maps or []:
            arguments.extend(["-map", mapping])
        arguments.extend(codec_args or [])
        arguments.append(str(partial))

        try:
            self.run(arguments, label=label)
        except FFmpegError:
            partial.unlink(missing_ok=True)
            raise
        if not partial.is_file() or partial.stat().st_size == 0:
            partial.unlink(missing_ok=True)
            raise FFmpegError(f"FFmpeg produced no output during '{label}'.", arguments)
        partial.replace(output)
        return output
