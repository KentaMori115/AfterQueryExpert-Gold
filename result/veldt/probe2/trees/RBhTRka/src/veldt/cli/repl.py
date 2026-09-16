"""A minimal interactive shell.

The shell is intentionally small: read a statement, run it, print it. Multi
line input is supported by ending a statement with a semicolon; a line ending
without one continues onto the next.
"""

from __future__ import annotations

import sys
from typing import List, Optional, TextIO

from ..engine import Engine
from ..errors import ParseError, VeldtError
from .formatting import render_schema, render_table

__all__ = ["Repl", "run_repl"]

PROMPT = "veldt> "
CONTINUATION = "  ...> "
HELP_TEXT = """\
Commands:
  .tables            list registered tables
  .schema [TABLE]    describe one table or all of them
  .help              show this message
  .quit              leave the shell
Anything else is run as SQL. End a statement with ; to run it."""


class Repl:
    """A read-eval-print loop over one engine."""

    def __init__(
        self,
        engine: Engine,
        stream: Optional[TextIO] = None,
        error_stream: Optional[TextIO] = None,
    ) -> None:
        self.engine = engine
        self.stream = stream or sys.stdout
        self.error_stream = error_stream or sys.stderr
        self.buffer: List[str] = []

    def run(self, source: Optional[TextIO] = None) -> int:
        """Read statements until end of input.

        Returns:
            A process exit code, always zero for a clean exit.
        """
        handle = source or sys.stdin
        while True:
            self._prompt()
            line = handle.readline()
            if not line:
                break
            if not self.feed(line.rstrip("\n")):
                break
        return 0

    def feed(self, line: str) -> bool:
        """Handle one input line.

        Returns:
            False when the shell should exit.
        """
        text = line.strip()
        if not text and not self.buffer:
            return True
        if not self.buffer and text.startswith("."):
            return self._dot_command(text)
        self.buffer.append(line)
        combined = "\n".join(self.buffer).strip()
        if not combined.endswith(";"):
            return True
        self.buffer.clear()
        self._run_sql(combined.rstrip(";").strip())
        return True

    def _prompt(self) -> None:
        prompt = CONTINUATION if self.buffer else PROMPT
        print(prompt, end="", file=self.stream, flush=True)

    def _dot_command(self, text: str) -> bool:
        parts = text.split()
        command = parts[0].lower()
        if command in (".quit", ".exit"):
            return False
        if command == ".help":
            print(HELP_TEXT, file=self.stream)
            return True
        if command == ".tables":
            names = self.engine.tables()
            print("\n".join(names) if names else "(no tables)", file=self.stream)
            return True
        if command == ".schema":
            targets = [parts[1]] if len(parts) > 1 else self.engine.tables()
            for name in targets:
                print(render_schema(self.engine.schema(name), name), file=self.stream)
            return True
        print(f"unknown command {command}; try .help", file=self.error_stream)
        return True

    def _run_sql(self, sql: str) -> None:
        if not sql:
            return
        try:
            result = self.engine.sql(sql)
        except ParseError as error:
            print(error.annotated_source(), file=self.error_stream)
            return
        except VeldtError as error:
            print(str(error), file=self.error_stream)
            return
        print(render_table(result.table), file=self.stream)


def run_repl(engine: Engine, source: Optional[TextIO] = None) -> int:
    """Run a shell against an engine."""
    return Repl(engine).run(source)
