#!/bin/bash

. /usr/local/bin/docker-entrypoint.sh
CMD=mysqld

docker_setup_env "$CMD"
docker_temp_server_stop
