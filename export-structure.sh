#!/bin/bash
set -e

CONFIG_FILE="myvc.config.json"
DUMP_FILE="dump/structure.sql"
INI_FILE="db.production.ini"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Config file found in working directory."
    exit 1
fi

SCHEMAS=( $(jq -r ".structure[]" "$CONFIG_FILE") )

mysqldump \
    --defaults-file="$INI_FILE" \
    --default-character-set=utf8 \
    --no-data \
    --comments \
    --triggers --routines --events \
    --databases \
    ${SCHEMAS[@]} \
    | sed 's/ AUTO_INCREMENT=[0-9]* //g' \
    > "$DUMP_FILE"
