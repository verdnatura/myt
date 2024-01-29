#!/bin/bash
set -e

# XXX: Workaround to avoid OverlayFS bug on MacOs
# https://docs.docker.com/storage/storagedriver/overlayfs-driver/#limitations-on-overlayfs-compatibility

if [ ! -d /var/lib/mysql/mysql ]; then
	chown mysql:mysql /var/lib/mysql
	cp -a /mysql-template/. /var/lib/mysql
fi

exec gosu mysql "$@"
