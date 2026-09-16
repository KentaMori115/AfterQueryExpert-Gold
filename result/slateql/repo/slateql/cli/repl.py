"""An interactive read-eval-print loop.

Statements are accumulated until a semicolon is seen, so multi-line queries
work.  Backslash commands mirror the psql conventions that most people already
have in their fingers.
"""

from __future__ import annotations

import sys
from typing import Optional, TextIO

from ..errors import SlateQLError
from ..session import Session
from ..util.text import plural
from .formatter import FORMATS, format_result

__all__ = ["Repl", "run_repl"]

_BANNER = "SlateQL interactive shell -- type \\h for help, \\q to quit"

_HELP = """\
\\h            show this help
\\q            quit
\\d            list registered tables
\\d <table>    describe one table
\\f [pattern]  list functions
\\format <fmt> switch output format ({formats})
\\timing       toggle statement timing
Anything else is executed as SQL; end a statement with ';'.
"""


class Repl:
    """The interactive shell."""

    def __init__(
        self,
        session: Session,
        *,
        stdin: Optional[TextIO] = None,
        stdout: Optional[TextIO] = None,
    ) -> None:
        self.session = session
        self.stdin = stdin or sys.stdin
        self.stdout = stdout or sys.stdout
        self.output_format = "table"
        self.show_timing = False
        self._buffer: list[str] = []

    # -- output helpers --------------------------------------------------

    def write(self, text: str = "") -> None:
        print(text, file=self.stdout)

    def prompt(self) -> str:
        return "... " if self._buffer else "slateql> "

    # -- main loop -------------------------------------------------------

    def run(self) -> int:
        self.write(_BANNER)
        while True:
            try:
                line = self._read_line()
            except EOFError:
                self.write()
                return 0
            except KeyboardInterrupt:
                self._buffer.clear()
                self.write("^C")
                continue
            if line is None:
                return 0
            stripped = line.strip()
            if not stripped and not self._buffer:
                continue
            if not self._buffer and stripped.startswith("\\"):
                if self._handle_meta(stripped) is False:
                    return 0
                continue
            self._buffer.append(line)
            joined = "\n".join(self._buffer).strip()
            if not joined.endswith(";"):
                continue
            self._buffer.clear()
            self._execute(joined.rstrip(";").strip())

    def _read_line(self) -> Optional[str]:
        if self.stdin is sys.stdin and self.stdin.isatty():
            return input(self.prompt())
        line = self.stdin.readline()
        if not line:
            raise EOFError
        return line.rstrip("\n")

    # -- commands --------------------------------------------------------

    def _handle_meta(self, command: str) -> bool:
        parts = command.split()
        head = parts[0]
        argument = parts[1] if len(parts) > 1 else None
        if head in ("\\q", "\\quit", "\\exit"):
            return False
        if head in ("\\h", "\\?", "\\help"):
            self.write(_HELP.format(formats=", ".join(FORMATS)))
            return True
        if head == "\\d":
            self._describe(argument)
            return True
        if head == "\\f":
            self._list_functions(argument)
            return True
        if head == "\\format":
            if argument in FORMATS:
                self.output_format = argument
                self.write(f"output format is now {argument}")
            else:
                self.write(f"unknown format; choose one of {', '.join(FORMATS)}")
            return True
        if head == "\\timing":
            self.show_timing = not self.show_timing
            self.write(f"timing is {'on' if self.show_timing else 'off'}")
            return True
        self.write(f"unknown command {head}; try \\h")
        return True

    def _describe(self, table: Optional[str]) -> None:
        try:
            if table is None:
                names = self.session.tables()
                self.write("\n".join(names) if names else "(no tables registered)")
                return
            self.write(self.session.schema_of(table).describe())
        except SlateQLError as error:
            self.write(f"error: {error}")

    def _list_functions(self, pattern: Optional[str]) -> None:
        names = self.session.registry.names()
        if pattern:
            names = [name for name in names if pattern.lower() in name]
        self.write(", ".join(names) if names else "(no matching functions)")

    def _execute(self, statement: str) -> None:
        if not statement:
            return
        from ..util.timing import Stopwatch, format_duration

        watch = Stopwatch(start=True)
        try:
            result = self.session.sql(statement)
        except SlateQLError as error:
            watch.stop()
            self.write(f"error: {error}")
            return
        watch.stop()
        self.write(format_result(result, self.output_format))
        self.write(f"({plural(len(result), 'row')})")
        if self.show_timing:
            self.write(f"time: {format_duration(watch.elapsed)}")


def run_repl(session: Session) -> int:
    """Start an interactive shell bound to ``session``."""

    return Repl(session).run()
