FROM python:3.12-slim
RUN command -v git >/dev/null 2>&1 || { { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; } || apk add --no-cache git || microdnf -y install git || dnf -y install git || yum -y install git || { echo "PLATFORM ERROR: this base image has no git, and no apt-get/apk/dnf/yum to install it. Use one of the approved base images, or add git to the image yourself."; exit 1; }; }
COPY repo/ /app
WORKDIR /app
ENV PYTHONPATH=/app     PYTHONDONTWRITEBYTECODE=1     PYTHONHASHSEED=0
WORKDIR /app
RUN pip install --no-cache-dir     pytest==8.3.5     pytest-cov==5.0.0
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
