ARG BASE_IMAGE=mariadb
ARG BASE_TAG=10.11.16-jammy

FROM registry.verdnatura.es/verdnatura/node:22.22.0-vn2 AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libkrb5-dev \
        libssl-dev \
        build-essential

WORKDIR /myt
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm install --prod --frozen-lockfile

FROM ${BASE_IMAGE}:${BASE_TAG}

# Myt

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        gnupg2 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g corepack@0.34.6 \
    && corepack enable \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /myt /myt
WORKDIR /myt
COPY . ./
RUN npm install -g /myt

# Database

ARG SERVER_DIR=docker/server
COPY ${SERVER_DIR}/docker.cnf /etc/mysql/conf.d/
COPY ${SERVER_DIR}/.gitconfig /var/lib/mysql/
COPY ${SERVER_DIR}/bin /usr/local/bin/

ENTRYPOINT ["docker-start.sh"]
CMD ["mariadbd"]

HEALTHCHECK --interval=2s --timeout=10s --retries=200 \
    CMD gosu mysql mariadb-admin ping || exit 1
