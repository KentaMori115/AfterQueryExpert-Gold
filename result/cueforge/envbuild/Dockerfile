FROM python:3.12-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1     PYTHONUNBUFFERED=1     PIP_DISABLE_PIP_VERSION_CHECK=1     PYTHONPATH=/app/src
RUN apt-get update     && apt-get install -y --no-install-recommends         ca-certificates         git     && rm -rf /var/lib/apt/lists/*
RUN python -m pip install --no-cache-dir         annotated-types==0.7.0         build==1.2.2.post1         click==8.1.8         coverage==7.10.1         hypothesis==6.136.9         iniconfig==2.3.0         lark==1.2.2         markdown-it-py==4.2.0         mdurl==0.1.2         mypy==1.17.0         mypy_extensions==1.1.0         packaging==26.2         pathspec==1.1.1         pluggy==1.6.0         pydantic==2.11.7         pydantic_core==2.33.2         Pygments==2.21.0         pyproject_hooks==1.2.0         pytest==8.4.1         pytest-cov==6.2.1         PyYAML==6.0.2         rich==15.0.0         ruff==0.12.7         shellingham==1.5.4         typer==0.16.0         types-PyYAML==6.0.12.20250516         typing-inspection==0.4.2         typing_extensions==4.15.0         wheel==0.48.0
RUN python -m pytest --version     && git --version
WORKDIR /app
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
