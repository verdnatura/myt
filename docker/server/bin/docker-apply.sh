#!/bin/bash
set -e

. /usr/local/bin/docker-env.sh
myt_temp_server_start
myt apply --docker --remote socket --debug $@
myt_temp_server_stop
