"""One module per command.

Each module exposes ``register(app)`` and adds its own commands to it. Nothing
imports anything from another command module, so a command can be removed by
deleting its file and its line in ``main``.
"""
