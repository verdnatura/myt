#!/bin/bash

. /usr/local/bin/docker-entrypoint.sh
CMD=mysqld

docker_setup_env "$CMD"
docker_temp_server_start "$CMD"

myvc push --socket --commit
docker-dump.sh dump/fixtures

docker_temp_server_stop
