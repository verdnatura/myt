#!/bin/bash
set -e

export MYSQL_ROOT_PASSWORD="$ROOT_PASS"
export MYSQL_ALLOW_EMPTY_PASSWORD='true'

. /usr/local/bin/docker-entrypoint.sh