#!/bin/bash
set -e

. /usr/local/bin/docker-entrypoint.sh
ARGS=(mysqld --datadir=/mysql-template)

mysql_check_config ${ARGS[@]}
docker_setup_env ${ARGS[@]}
docker_create_db_directories

docker_verify_minimum_env
docker_init_database_dir ${ARGS[@]}
docker_temp_server_start ${ARGS[@]}
docker_setup_db
docker_process_init_files /docker-entrypoint-initdb.d/*

docker-import.sh dump/dump.before
docker-import.sh dump/.dump/structure
docker-import.sh dump/.dump/data
docker-import.sh dump/.dump/triggers
docker-import.sh dump/.dump/privileges
docker-import.sh dump/dump.after

docker_temp_server_stop
