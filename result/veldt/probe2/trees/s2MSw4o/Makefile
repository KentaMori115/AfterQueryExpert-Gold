.PHONY: help test test-fast lint example cli clean

PYTHON ?= python

help:
	@echo "test       run the whole suite"
	@echo "test-fast  stop at the first failure"
	@echo "example    run the quickstart tour"
	@echo "cli        run a sample query through the command line"
	@echo "clean      remove caches and build artefacts"

test:
	$(PYTHON) -m pytest

test-fast:
	$(PYTHON) -m pytest -x -q

example:
	PYTHONPATH=src $(PYTHON) examples/quickstart.py

cli:
	PYTHONPATH=src $(PYTHON) -m veldt.cli.main query \
		--csv trips=examples/data/trips.csv \
		"SELECT driver, count(*) AS trips, round(sum(fare), 2) AS revenue \
		 FROM trips WHERE status = 'completed' GROUP BY driver ORDER BY revenue DESC"

clean:
	rm -rf .pytest_cache .ruff_cache build dist src/*.egg-info
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
