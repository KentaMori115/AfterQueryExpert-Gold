# Contributing

Paper Tech is developed offline. Please keep that contract.

- Use Python 3.12.
- Do not add network clients, live show-control protocols, or wall-clock sleeps.
- Keep virtual time as integers.
- Prefer public API tests over private helper tests.
- Leave the ten future Gold tasks unimplemented until they are selected as fresh work.

Quality commands:

```bash
python -m ruff format --check .
python -m ruff check .
python -m mypy src
python -m pytest
```
