#!/bin/bash

export MYSQL_PWD=root
FILE="/docker-boot/$1.sql"
echo "[INFO] -> Importing $FILE"
mysql -u root --default-character-set=utf8 --comments -f < "$FILE"
