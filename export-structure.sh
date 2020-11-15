#!/bin/bash
set -e

CONFIG_FILE=$1
INI_FILE=$2
DUMP_FILE="dump/structure.sql"

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
