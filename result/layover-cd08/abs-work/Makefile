PYTHON ?= python3

.PHONY: check test demo cli clean

check: test demo cli

test:
	$(PYTHON) -m unittest discover -q -s tests -t .

demo:
	$(PYTHON) -m layover demo --summary

cli:
	$(PYTHON) -m layover --help >/dev/null

clean:
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
