#!/bin/bash
set -e

export MYSQL_ROOT_PASSWORD=$ROOT_PASS
export MYSQL_ALLOW_EMPTY_PASSWORD='true'

. /usr/local/bin/docker-entrypoint.sh
ARGS=(mariadbd --datadir=/mysql-template)

myt_temp_server_start() {
    docker_setup_env ${ARGS[@]}
    docker_temp_server_start ${ARGS[@]}
}

myt_temp_server_stop() {
    docker_temp_server_stop
}
