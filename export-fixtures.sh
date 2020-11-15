#!/bin/bash
set -e

CONFIG_FILE=$1
INI_FILE=$2
DUMP_FILE="dump/fixtures.sql"

echo "SELECT 1;" | mysql --defaults-file="$INI_FILE" >> /dev/null
echo "" > "$DUMP_FILE"

for SCHEMA in $(jq -r ".fixtures | keys[]" "$CONFIG_FILE"); do
    TABLES=( $(jq -r ".fixtures.$SCHEMA[]" "$CONFIG_FILE") )

    echo " -> $SCHEMA"
    echo "USE \`$SCHEMA\`;" >> "$DUMP_FILE"
    mysqldump \
        --defaults-file="$INI_FILE" \
        --no-create-info \
        --skip-triggers \
        $SCHEMA ${TABLES[@]} >> "$DUMP_FILE"
done
