FROM sbot-8f3a-env:v2
COPY ctx/ /app
WORKDIR /app
RUN git init -q /app \
 && git -C /app config user.email base@local \
 && git -C /app config user.name base \
 && git -C /app add -A \
 && git -C /app commit -q -m base \
 && git config --global --add safe.directory /app \
 && git -C /app config core.hooksPath /dev/null
