# Everything that gets run before a change goes anywhere.

PYTHON ?= python3
SRC := src/signalbox
TESTS := tests
PLAN := tests/data/kingsmoor.sbx

.PHONY: help install test lint format typecheck check coverage pack clean

help:
	@echo "install    install the package and the development tools"
	@echo "test       run the tests"
	@echo "coverage   run the tests and report coverage"
	@echo "lint       run the linter"
	@echo "format     format the code in place"
	@echo "typecheck  run the type checker"
	@echo "complexity report anything over the complexity limit"
	@echo "check      lint, typecheck and test"
	@echo "pack       build a handover pack from the example scheme"
	@echo "clean      remove build and cache directories"

install:
	$(PYTHON) -m pip install -e ".[dev]"

test:
	$(PYTHON) -m pytest

coverage:
	$(PYTHON) -m pytest --cov --cov-report=term-missing

lint:
	$(PYTHON) -m ruff check $(SRC) $(TESTS)
	$(PYTHON) -m ruff format --check $(SRC) $(TESTS)

complexity:
	$(PYTHON) -m ruff check --select C90,PLR0912,PLR0915 --no-cache $(SRC)

format:
	$(PYTHON) -m ruff check --fix $(SRC) $(TESTS)
	$(PYTHON) -m ruff format $(SRC) $(TESTS)

typecheck:
	$(PYTHON) -m mypy

check: lint typecheck test

pack:
	$(PYTHON) -m signalbox pack $(PLAN) --out pack

clean:
	rm -rf build dist pack .pytest_cache .ruff_cache .mypy_cache htmlcov .coverage
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
