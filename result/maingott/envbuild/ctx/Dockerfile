FROM python:3.12-slim
RUN command -v git >/dev/null 2>&1 || { { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; } ; }
COPY repo/ /app
WORKDIR /app
RUN apt-get update  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir     openai==3.7.0     orjson==3.12.0     pillow==12.3.0     pydantic==2.13.5     pydantic-settings==2.15.0     pytest==9.1.1     pytest-cov==7.1.0     python-docx==1.2.0     python-dotenv==1.2.3     rich==15.0.0     tenacity==9.1.4     typer==0.27.2
RUN printf '/app/src\n' > /usr/local/lib/python3.12/site-packages/maingott-reel.pth
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
