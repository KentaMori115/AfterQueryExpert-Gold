"""The command line, which is how anyone actually uses this.

Everything a command does is a thin wrapper over the library. If a command needs
more than a dozen lines of its own then the thing it is doing belongs in the
library where it can be tested without a terminal.
"""
