#!/bin/bash

# XXX: Workaround to avoid OverlayFS bug on MacOs
# https://docs.docker.com/storage/storagedriver/overlayfs-driver/#limitations-on-overlayfs-compatibility

if [ "$RUN_CHOWN" = "true" ]; then
	chown -R mysql:mysql /mysql-data
fi

exec "$@"
