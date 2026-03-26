#!/bin/bash
set -e

. /usr/local/bin/docker-env.sh
myt_temp_server_start
myt apply --docker --debug $@
myt_temp_server_stop
