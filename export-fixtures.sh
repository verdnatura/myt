#!/bin/bash
set -e

CONFIG_FILE="myvc.config.json"
DUMP_FILE="dump/fixtures.sql"
INI_FILE="db.production.ini"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Config file not found in working directory."
    exit 1
fi

echo "SELECT 1;" | mysql --defaults-file="$INI_FILE" >> /dev/null

echo "Exporting fixtures"
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
