#!/bin/bash

FILE="$1.sql"
if [[ ! -f "$FILE" ]] ; then
    exit
fi

echo "[LOG] -> Importing $FILE"
mariadb --default-character-set=utf8 --comments --force < "$FILE"
