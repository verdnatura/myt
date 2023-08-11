#!/bin/bash

FILE="$1.sql"
if [[ ! -f "$FILE" ]] ; then
    exit
fi

echo "[LOG] -> Importing $FILE"
export MYSQL_PWD=root
mysql -u root --default-character-set=utf8 --comments -f < "$FILE"
