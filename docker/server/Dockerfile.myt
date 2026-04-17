ARG BASE_TAG=myt/base
FROM ${BASE_TAG}

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

# RUN apt-get update \
#     && apt-get install -y --no-install-recommends \
#         libkrb5-dev \
#         libssl-dev \
#         build-essential \
#     && rm -rf /var/lib/apt/lists/*

WORKDIR /myt
COPY package.json ./
RUN pnpm install --prod --ignore-scripts

COPY . ./
RUN npm install -g /myt

# Server

ARG SERVER_DIR=docker/server
COPY ${SERVER_DIR}/docker-init.sh /usr/local/bin/
