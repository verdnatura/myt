#!/bin/bash
set -e

export MYSQL_ROOT_PASSWORD="$ROOT_PASS"
export MYSQL_ALLOW_EMPTY_PASSWORD='true'
export MARIADB_MYSQL_LOCALHOST_USER='yes'

. /usr/local/bin/docker-entrypoint.sh

ARGS=(mariadbd --datadir=/var/lib/mysql)

mysql_check_config ${ARGS[@]}
docker_setup_env ${ARGS[@]}
docker_create_db_directories
docker_verify_minimum_env
docker_init_database_dir ${ARGS[@]}

docker_temp_server_start ${ARGS[@]}
docker_setup_db

MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mariadb -u root \
    -e "GRANT ALL PRIVILEGES ON *.* TO mysql@localhost WITH GRANT OPTION"

docker_process_init_files /docker-entrypoint-initdb.d/*

myt apply \
    --debug \
    --structure \
    --changes \
    --remote socket \
    --load $MYT_COMMIT

docker_temp_server_stop
cp -a /var/lib/mysql/. /mysql-template
