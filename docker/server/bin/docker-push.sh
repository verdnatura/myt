#!/bin/bash
set -e
. /usr/local/bin/docker-env.sh

myt_temp_server_start() {
    ARGS=(mariadbd --datadir=/var/lib/mysql)
    docker_setup_env ${ARGS[@]}
    docker_temp_server_start ${ARGS[@]}
}

myt_temp_server_stop() {
    docker_temp_server_stop
}

myt_temp_server_start
(cd /workspace && myt --debug --remote socket push)
myt_temp_server_stop
