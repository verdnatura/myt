FROM debian:11.11-slim

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        mariadb-client \
        libmariadb3 \
    && rm -rf /var/lib/apt/lists/*

COPY \
    docker-dump.sh \
    docker-fixtures.sh \
    /usr/local/bin/
WORKDIR /workspace
