#!/bin/bash
set -e

. /usr/local/bin/docker-env.sh

export MARIADB_MYSQL_LOCALHOST_USER='yes'
export MARIADB_MYSQL_LOCALHOST_GRANTS='ALL PRIVILEGES'

mysql_check_config ${ARGS[@]}
docker_setup_env ${ARGS[@]}
docker_create_db_directories
docker_verify_minimum_env
docker_init_database_dir ${ARGS[@]}

docker_temp_server_start ${ARGS[@]}
docker_setup_db
docker_process_init_files /docker-entrypoint-initdb.d/*
docker_temp_server_stop
