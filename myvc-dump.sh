#!/bin/bash
set -e

CONFIG_FILE=$1
INI_FILE=$2
DUMP_DIR="dump"
DUMP_FILE="$DUMP_DIR/.dump.sql"

echo "SELECT 1;" | mysql --defaults-file="$INI_FILE" >> /dev/null
SCHEMAS=( $(jq -r ".schemas[]" "$CONFIG_FILE") )

mkdir -p "$DUMP_DIR"

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

for SCHEMA in $(jq -r ".fixtures | keys[]" "$CONFIG_FILE"); do
    TABLES=( $(jq -r ".fixtures.$SCHEMA[]" "$CONFIG_FILE") )

    echo "USE \`$SCHEMA\`;" >> "$DUMP_FILE"
    mysqldump \
        --defaults-file="$INI_FILE" \
        --no-create-info \
        --skip-triggers \
        $SCHEMA ${TABLES[@]} >> "$DUMP_FILE"
done
