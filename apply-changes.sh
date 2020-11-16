#!/bin/bash

FORCE=FALSE
IS_USER=FALSE

usage() {
	echo "[ERROR] Usage: $0 [-f] [-u] [-e environment]"
	exit 1
}

while getopts ":fue:" option
do
	case $option in
		f)
			FORCE=TRUE
			;;
		u)
			IS_USER=TRUE
			;;
		e)
			ENV="$OPTARG"
			;;
		\?|:)
			usage
			;;
	esac
done

shift $(($OPTIND - 1))

CONFIG_FILE="myvc.config.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "[ERROR] Config file not found: $CONFIG_FILE"
    exit 2
fi

DIR="$(dirname "${BASH_SOURCE[0]}")"
CODE=$(jq -r ".code" "$CONFIG_FILE")

# Production protection

if [ "$ENV" == "production" ]; then
    echo ""
    echo " (   (       ) (                       (       )     ) "
    echo " )\ ))\ ) ( /( )\ )          (        ))\ ) ( /(  ( /( "
    echo "(()/(()/( )\()|()/(     (    )\   )  /(()/( )\()) )\())"
    echo " /(_))(_)|(_)\ /(_))    )\ (((_) ( )(_))(_)|(_)\ ((_)\ "
    echo "(_))(_))   ((_|_))_  _ ((_))\___(_(_()|__)) ((_)  _((_)"
    echo "| _ \ _ \ / _ \|   \| | | ((/ __|_   _|_ _| / _ \| \| |"
    echo "|  _/   /| (_) | |) | |_| || (__  | |  | | | (_) | .  |"
    echo "|_| |_|_\ \___/|___/ \___/  \___| |_| |___| \___/|_|\_|"
    echo ""

    if [ "$FORCE" != "TRUE" ]; then
        read -p "[INTERACTIVE] Are you sure? (Default: no) [yes|no]: " ANSWER

        if [ "$ANSWER" != "yes" ]; then
            echo "[INFO] Aborting changes."
            exit
        fi
    fi
fi

# Configuration file

if [ -z "$ENV" ]; then
    INI_FILE="$PWD/db.ini"
else
    INI_FILE="$PWD/db.$ENV.ini"
fi

if [ ! -f "$INI_FILE" ]; then
    echo "[ERROR] Database config file not found: $INI_FILE"
    exit 2
fi

echo "[INFO] Using config file: $INI_FILE"

echo "SELECT 1;" | mysql --defaults-file="$INI_FILE" >> /dev/null

if [ "$?" -ne "0" ]; then
    exit 3
fi

# Query functions

dbQuery() {
    SQL=$1
    RETVAL=`echo "$SQL" | mysql --defaults-file="$INI_FILE" --silent --raw`
}
dbExec() {
    SQL=$1
    echo "$SQL" | mysql --defaults-file="$INI_FILE"
}
dbExecFromFile() {
    FILE_PATH=$1
    SCHEMA=$2
    mysql --defaults-file="$INI_FILE" --default-character-set=utf8 --comments "$SCHEMA" < $FILE_PATH
}

# Fetches database version

COMMIT_SHA=$(git rev-parse HEAD)
echo "[INFO] Commit: $COMMIT_SHA"

dbQuery "SELECT number, gitCommit FROM util.version WHERE code = '$CODE'"
RETVAL=($RETVAL)
DB_VERSION=${RETVAL[0]}
DB_COMMIT=${RETVAL[1]}

echo "[INFO] Database information:"
echo "[INFO]  -> Version: $DB_VERSION"
echo "[INFO]  -> Commit: $DB_COMMIT"

if [[ ! "$DB_VERSION" =~ ^[0-9]*$ ]]; then
    echo "[ERROR] Wrong database version."
    exit 4
fi
if [[ -z "$DB_VERSION" ]]; then
    DB_VERSION=10000
fi

if [ "$IS_USER" == "TRUE" ]; then
    echo "[INFO] User information:"

    dbQuery "SELECT LEFT(USER(), INSTR(USER(), '@') - 1)"
    DB_USER=$RETVAL
    echo "[INFO]  -> Name: $DB_USER"

    dbQuery "SELECT number, gitCommit FROM util.versionUser WHERE code = '$CODE' AND user = '$DB_USER'"
    RETVAL=($RETVAL)
    USER_VERSION=${RETVAL[0]}
    USER_COMMIT=${RETVAL[1]}

    echo "[INFO]  -> Version: $USER_VERSION"
    echo "[INFO]  -> Commit: $USER_COMMIT"
    
    if [ ! -z "$USER_VERSION" ]; then
        if [ "$USER_VERSION" -gt "$DB_VERSION" ]; then
            DB_VERSION=$USER_VERSION
            DB_COMMIT=$USER_COMMIT
        fi
    fi
fi

# Applies changes

N_CHANGES=0
LAST_APPLIED_VERSION=$DB_VERSION

for DIR_PATH in "$PWD/changes/"*; do
    DIR_NAME=$(basename $DIR_PATH)
    DIR_VERSION=${DIR_NAME:0:5}

    if [ "$DIR_NAME" == "README.md" ]; then
        continue
    fi
    if [[ ! "$DIR_NAME" =~ ^[0-9]{5}(-[a-zA-Z0-9]+)?$ ]]; then
        echo "[WARN] Ignoring wrong directory name: $DIR_NAME"
        continue
    fi
    if [ "$DB_VERSION" -ge "$DIR_VERSION" ]; then
        echo "[INFO] Ignoring already applied version: $DIR_NAME"
        continue
    fi

    echo "[INFO] Applying version: $DIR_NAME"

    for FILE in "$DIR_PATH/"*; do
        FILE_NAME=$(basename "$FILE")

        if [ "$FILE_NAME" == "*" ]; then
            continue
        fi
        if [[ ! "$FILE_NAME" =~ ^[0-9]{2}-[a-zA-Z0-9_]+\.sql$ ]]; then
            echo "[WARN] Ignoring wrong file name: $FILE_NAME"
            continue
        fi

        echo "[INFO]  -> $FILE_NAME"
        dbExecFromFile "$FILE"
        N_CHANGES=$((N_CHANGES + 1))
    done

    LAST_APPLIED_VERSION=$DIR_VERSION
done

# Applies routines

applyRoutines() {
    FILES_CMD=$1

    for FILE_PATH in `$FILES_CMD`; do
        FILE_NAME=$(basename $FILE_PATH)

        if [[ ! "$FILE_PATH" =~ ^routines/ ]]; then
            continue
        fi
        if [[ ! "$FILE_NAME" =~ ^[a-zA-Z0-9_]+\.sql$ ]]; then
            echo "[WARN] Ignoring wrong file name: $FILE_NAME"
            continue
        fi

        FILE_REL_PATH=${FILE_PATH//routines\/}

        IFS='/' read -ra SPLIT <<< "$FILE_REL_PATH"
        SCHEMA=${SPLIT[0]}
        NAME=${SPLIT[2]}
        NAME=${NAME//\.sql/}
        
        ROUTINE_TYPE=${SPLIT[1]}
        case "$ROUTINE_TYPE" in
            events)
                ROUTINE_TYPE=EVENT
                ;;
            functions)
                ROUTINE_TYPE=FUNCTION
                ;;
            procedures)
                ROUTINE_TYPE=PROCEDURE
                ;;
            triggers)
                ROUTINE_TYPE=TRIGGER
                ;;
            views)
                ROUTINE_TYPE=VIEW
                ;;
            *)
                echo "[WARN] Ignoring unknown routine type: $ROUTINE_TYPE"
                continue
                ;;
        esac

        ROUTINE_NAME="\`$SCHEMA\`.\`$NAME\`"

        if [[ -f "$FILE_PATH" ]]; then
            ACTION="REPLACE"
        else
            ACTION="DROP"
        fi

        echo "[INFO]  -> $ACTION: $ROUTINE_TYPE $ROUTINE_NAME"

        if [ "$ACTION" == "REPLACE" ]; then
            dbExecFromFile "$FILE_PATH" "$SCHEMA"
        else
            dbExec "DROP $ROUTINE_TYPE IF EXISTS $ROUTINE_NAME"
        fi

        ROUTINES_CHANGED=$((ROUTINES_CHANGED + 1))
    done
}

echo "[INFO] Applying changed routines."

ROUTINES_CHANGED=0

PROCS_FILE=.procs-priv.sql
mysqldump \
    --defaults-file="$INI_FILE" \
    --no-create-info \
    --skip-triggers \
    --insert-ignore \
    mysql procs_priv > "$PROCS_FILE"

if [[ -z "$DB_COMMIT" ]]; then
    applyRoutines "find routines -type f"
else
    applyRoutines "git diff --name-only --diff-filter=D $DB_COMMIT -- routines"
    applyRoutines "git diff --name-only --diff-filter=d $DB_COMMIT -- routines"
fi

applyRoutines "git ls-files --others --exclude-standard"

if [ "$ROUTINES_CHANGED" -gt "0" ]; then
    dbExecFromFile "$PROCS_FILE" "mysql"

    if [ "$?" -eq "0" ]; then
        dbExec "FLUSH PRIVILEGES"
        rm "$PROCS_FILE"
    else
        echo "[WARN] An error ocurred when restoring routine privileges, backup saved at $PROCS_FILE"
    fi

    echo "[INFO]  -> $ROUTINES_CHANGED routines have changed."
else
    echo "[INFO]  -> No routines changed."
    rm "$PROCS_FILE"
fi

N_CHANGES=$((N_CHANGES + ROUTINES_CHANGED))

# Displaying summary

if [ "$N_CHANGES" -gt "0" ]; then
    if [ "$IS_USER" == "TRUE" ]; then
        SQL=(
            "INSERT INTO util.versionUser SET "
                "code = '$CODE', "
                "user = '$DB_USER', "
                "number = '$LAST_APPLIED_VERSION', "
                "gitCommit = '$COMMIT_SHA' "
            "ON DUPLICATE KEY UPDATE "
                "number = VALUES(number), "
                "gitCommit = VALUES(gitCommit)"
        )
    else
        SQL=(
            "INSERT INTO util.version SET "
                "code = '$CODE', "
                "number = '$LAST_APPLIED_VERSION', "
                "gitCommit = '$COMMIT_SHA' "
            "ON DUPLICATE KEY UPDATE "
                "number = VALUES(number), "
                "gitCommit = VALUES(gitCommit)"
        )
    fi

    dbExec "${SQL[*]}"
    echo "[INFO] Changes applied succesfully."
else
    echo "[INFO] No changes applied."
fi
