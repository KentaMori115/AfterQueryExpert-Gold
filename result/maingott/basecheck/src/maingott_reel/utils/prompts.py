"""Versioned prompt templates.

Prompts live in ``prompts/`` as Markdown files with a small front matter block
so their version can be recorded in the run manifest:

```markdown
---
version: 1
---
Prompt body with {{placeholders}}.
```

Keeping prompts out of Python source means a wording change is reviewable as a
text diff and its version can be tracked per run.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from maingott_reel.errors import ConfigurationError
from maingott_reel.utils.hashing import sha256_text

_FRONT_MATTER = re.compile(r"\A---\n(?P<meta>.*?)\n---\n(?P<body>.*)\Z", re.DOTALL)
_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")

DEFAULT_VERSION = "1"


@dataclass(frozen=True)
class PromptTemplate:
    """A prompt file with its version and content hash."""

    name: str
    version: str
    body: str

    @property
    def sha256(self) -> str:
        """Hash of the prompt body, recorded with generated artifacts."""
        return sha256_text(self.body)

    @property
    def placeholders(self) -> set[str]:
        """Placeholder names used in the body."""
        return set(_PLACEHOLDER.findall(self.body))

    def render(self, **values: object) -> str:
        """Fill every placeholder.

        Raises:
            ConfigurationError: a placeholder has no value.
        """
        missing = self.placeholders - set(values)
        if missing:
            raise ConfigurationError(
                f"Prompt '{self.name}' is missing values for: {', '.join(sorted(missing))}"
            )
        return _PLACEHOLDER.sub(lambda match: str(values[match.group(1)]), self.body).strip()


def load_prompt(name: str, prompts_root: Path) -> PromptTemplate:
    """Load ``prompts_root/<name>.md``.

    Raises:
        ConfigurationError: the prompt file is missing or empty.
    """
    path = prompts_root / f"{name}.md"
    if not path.is_file():
        raise ConfigurationError(f"Prompt file not found: {path}")

    raw = path.read_text(encoding="utf-8")
    version = DEFAULT_VERSION
    body = raw
    match = _FRONT_MATTER.match(raw)
    if match:
        body = match.group("body")
        for line in match.group("meta").splitlines():
            key, _, value = line.partition(":")
            if key.strip() == "version" and value.strip():
                version = value.strip()

    body = body.strip()
    if not body:
        raise ConfigurationError(f"Prompt file is empty: {path}")
    return PromptTemplate(name=name, version=version, body=body)
