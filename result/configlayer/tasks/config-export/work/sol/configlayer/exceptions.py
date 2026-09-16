

class ExportError(ConfigError):
    """Raised when a configuration mapping cannot be rendered as text.

    Examples: a non-string key, a value no line-oriented format can
    carry (an embedded newline, a nested collection inside a list), or
    an unknown export format name.
    """
