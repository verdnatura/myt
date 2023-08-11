#!/bin/bash

. /usr/local/bin/docker-entrypoint.sh
CMD=mysqld

mysql_check_config "$CMD"
docker_setup_env "$CMD"
docker_create_db_directories

docker_verify_minimum_env
docker_init_database_dir "$CMD"
docker_temp_server_start "$CMD"
docker_setup_db
docker_process_init_files /docker-entrypoint-initdb.d/*

docker-import.sh dump/dump.before
docker-import.sh dump/.dump/structure
docker-import.sh dump/.dump/data
docker-import.sh dump/.dump/triggers
docker-import.sh dump/.dump/privileges
docker-import.sh dump/dump.after

docker_temp_server_stop
