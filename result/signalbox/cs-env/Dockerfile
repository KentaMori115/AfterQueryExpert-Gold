FROM python:3.12-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
RUN pip install --no-cache-dir click==8.1.8 pydantic==2.10.5 typer==0.15.1 rich==13.9.4 PyYAML==6.0.2
RUN pip install --no-cache-dir pytest==8.3.4 pytest-cov==6.0.0 mypy==1.14.1 ruff==0.9.2 types-PyYAML==6.0.12.20241230
ENV PYTHONPATH=/app/src
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
