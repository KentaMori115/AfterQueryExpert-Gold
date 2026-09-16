PYTHON ?= python3

.PHONY: help test lint fmt demo clean

help:
	@echo "test   run the test suite"
	@echo "lint   run ruff if it is installed"
	@echo "demo   run the example scripts against the sample data"
	@echo "clean  remove caches and build artefacts"

test:
	$(PYTHON) -m pytest

lint:
	$(PYTHON) -m ruff check slateql tests

demo:
	$(PYTHON) examples/quickstart.py
	$(PYTHON) examples/sales_report.py
	$(PYTHON) examples/custom_functions.py

clean:
	find . -name '__pycache__' -type d -prune -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache build dist *.egg-info
