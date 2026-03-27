#!/bin/bash
set -e

# XXX: Workaround to avoid OverlayFS bug on MacOs
# https://docs.docker.com/storage/storagedriver/overlayfs-driver/#limitations-on-overlayfs-compatibility

if [[ ! -d /var/lib/mysql/mysql && -d /mysql-template ]]; then
	chown mysql:mysql /var/lib/mysql
	cp -a /mysql-template/. /var/lib/mysql
fi

# echo -e "[safe]\n\tdirectory = /workspace" > ~/.gitconfig
# git config --global safe.directory /workspace

exec gosu mysql "$@"
