#!/bin/bash

FORCE=FALSE
IS_USER=FALSE
APPLY_UNCOMMITED=FALSE
WORKSPACE="$PWD"

error() {
    local MESSAGE=$1
    >&2 echo "[ERR] $MESSAGE"
    exit 1
}
warn() {
    local MESSAGE=$1
    >&2 echo "[WAR] $MESSAGE"
}
log() {
    local MESSAGE=$1
    echo "[LOG] $MESSAGE"
}

while getopts ":fuae:" option
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
		a)
			APPLY_UNCOMMITED=TRUE
			;;
		\?|:)
			error "Usage: $0 [-f] [-u] [-a] [-e environment]"
			;;
	esac
done

shift $(($OPTIND - 1))

# Load configuration

CONFIG_FILE="myvc.config.json"

if [ ! -f "$CONFIG_FILE" ]; then
    error "Config file not found: $CONFIG_FILE"
fi

DIR="$(dirname "${BASH_SOURCE[0]}")"
CODE=$(jq -r ".code" "$CONFIG_FILE")

# Load database configuration

if [ -z "$ENV" ]; then
    INI_FILE="$DIR/db.ini"
else
    INI_FILE="$WORKSPACE/remotes/$ENV.ini"
fi

if [ ! -f "$INI_FILE" ]; then
    error "Database config file not found: $INI_FILE"
fi

log "Using config file: $INI_FILE"
echo "SELECT 1;" | mysql --defaults-file="$INI_FILE" >> /dev/null

if [ "$?" -ne "0" ]; then
    error "Cannot connect to database."
fi

# Fetch git information

if [ ! -d "$WORKSPACE/.git" ]; then
    error "Git directory not initialized."
fi

COMMIT_SHA=$(git rev-parse HEAD)

if [ "$?" -ne "0" ]; then
    error "Cannot fetch Git HEAD."
fi

log "HEAD: $COMMIT_SHA"

git diff-index --quiet --cached HEAD --
STAGED=$?

git diff-files --quiet
CHANGED=$?

UNTRACKED=`git ls-files --others --exclude-standard`

if [ "$STAGED" == "1" ] || [ "$CHANGED" == "1" ] || [ -n "$UNTRACKED" ]; then
    if [ "$APPLY_UNCOMMITED" == "TRUE" ]; then
        warn "You are applying uncommited changes."
    else
        error "You have uncommited changes, commit them before pushing or use -a option."
    fi
fi

# Query functions

dbQuery() {
    local SQL=$1
    local SCHEMA=$2
    RETVAL=`echo "$SQL" | mysql --defaults-file="$INI_FILE" --silent --raw "$SCHEMA"`
}
dbExec() {
    local SQL=$1
    local SCHEMA=$2
    echo "$SQL" | mysql --defaults-file="$INI_FILE" "$SCHEMA"
}
dbExecFromFile() {
    local FILE_PATH=$1
    local SCHEMA=$2
    mysql --defaults-file="$INI_FILE" --default-character-set=utf8 --comments "$SCHEMA" < $FILE_PATH
}

# Fetch database version

VERSION_SCHEMA=$(jq -r ".versionSchema" "$CONFIG_FILE")

if [ "$VERSION_SCHEMA" == "null" ]; then
    VERSION_SCHEMA="myvc"
fi

read -r -d '' SQL << EOM
    SELECT COUNT(*)
        FROM information_schema.tables
        WHERE TABLE_SCHEMA = '$VERSION_SCHEMA'
            AND TABLE_NAME = 'version'
EOM

dbQuery "$SQL"
TABLE_EXISTS=$RETVAL

SCHEMA="\`$VERSION_SCHEMA\`"

if [ "$TABLE_EXISTS" -eq "0" ]; then
    dbExec "CREATE DATABASE IF NOT EXISTS $SCHEMA"
    dbExecFromFile "$DIR/structure.sql" "$VERSION_SCHEMA"
    log "Version tables created into $SCHEMA schema."
fi

dbQuery "SELECT number, gitCommit FROM $SCHEMA.version WHERE code = '$CODE'"
RETVAL=($RETVAL)
DB_VERSION=${RETVAL[0]}
DB_COMMIT=${RETVAL[1]}

log "Database information:"
log " -> Version: $DB_VERSION"
log " -> Commit: $DB_COMMIT"

if [[ ! "$DB_VERSION" =~ ^[0-9]*$ ]]; then
    error "Wrong database version."
fi
if [ -z "$DB_VERSION" ]; then
    DB_VERSION=00000
fi

if [ "$IS_USER" == "TRUE" ]; then
    log "User information:"

    dbQuery "SELECT LEFT(USER(), INSTR(USER(), '@') - 1)"
    DB_USER=$RETVAL
    log " -> Name: $DB_USER"

    dbQuery "SELECT number, gitCommit FROM $SCHEMA.versionUser WHERE code = '$CODE' AND user = '$DB_USER'"
    RETVAL=($RETVAL)
    USER_VERSION=${RETVAL[0]}
    USER_COMMIT=${RETVAL[1]}

    log " -> Version: $USER_VERSION"
    log " -> Commit: $USER_COMMIT"
    
    if [ ! -z "$USER_VERSION" ]; then
        if [ "$USER_VERSION" -gt "$DB_VERSION" ]; then
            DB_VERSION=$USER_VERSION
            DB_COMMIT=$USER_COMMIT
        fi
    fi
fi

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
        read -p "[INT] Are you sure? (Default: no) [yes|no]: " ANSWER

        if [ "$ANSWER" != "yes" ]; then
            log "Aborting changes."
            exit
        fi
    fi
fi

# Apply versions

N_CHANGES=0
VERSIONS_DIR="$WORKSPACE/versions"

if [ -d "$VERSIONS_DIR" ]; then
    LAST_APPLIED_VERSION=$DB_VERSION

    for DIR_PATH in "$VERSIONS_DIR/"*; do
        DIR_NAME=$(basename $DIR_PATH)
        DIR_VERSION=${DIR_NAME:0:5}

        if [ "$DIR_NAME" == "README.md" ]; then
            continue
        fi
        if [[ ! "$DIR_NAME" =~ ^[0-9]{5}(-[a-zA-Z0-9]+)?$ ]]; then
            warn "Ignoring wrong directory name: $DIR_NAME"
            continue
        fi
        if [ "$DB_VERSION" -ge "$DIR_VERSION" ]; then
            log "Ignoring already applied version: $DIR_NAME"
            continue
        fi

        log "Applying version: $DIR_NAME"

        for FILE in "$DIR_PATH/"*; do
            FILE_NAME=$(basename "$FILE")

            if [ "$FILE_NAME" == "*" ]; then
                continue
            fi
            if [[ ! "$FILE_NAME" =~ ^[0-9]{2}-[a-zA-Z0-9_]+\.sql$ ]]; then
                warn "Ignoring wrong file name: $FILE_NAME"
                continue
            fi

            log " -> $FILE_NAME"
            dbExecFromFile "$FILE"
            N_CHANGES=$((N_CHANGES + 1))
        done

        LAST_APPLIED_VERSION=$DIR_VERSION
    done
fi

# Apply routines

applyRoutines() {
    FILES_CMD=$1

    for FILE_PATH in `$FILES_CMD`; do
        FILE_NAME=$(basename $FILE_PATH)

        if [[ ! "$FILE_PATH" =~ ^routines/ ]]; then
            continue
        fi
        if [[ ! "$FILE_NAME" =~ ^[a-zA-Z0-9_]+\.sql$ ]]; then
            warn "Ignoring wrong file name: $FILE_NAME"
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
                warn "Ignoring unknown routine type: $ROUTINE_TYPE"
                continue
                ;;
        esac

        ROUTINE_NAME="\`$SCHEMA\`.\`$NAME\`"

        if [[ -f "$FILE_PATH" ]]; then
            ACTION="REPLACE"
        else
            ACTION="DROP"
        fi

        log " -> $ACTION: $ROUTINE_TYPE $ROUTINE_NAME"

        if [ "$ACTION" == "REPLACE" ]; then
            dbExecFromFile "$FILE_PATH" "$SCHEMA"
        else
            dbExec "DROP $ROUTINE_TYPE IF EXISTS $ROUTINE_NAME"
        fi

        ROUTINES_CHANGED=$((ROUTINES_CHANGED + 1))
    done
}

ROUTINES_CHANGED=0
ROUTINES_DIR="$WORKSPACE/routines"

if [ -d "$ROUTINES_DIR" ]; then
    log "Applying changed routines."

    PROCS_FILE=.procs-priv.sql
    mysqldump \
        --defaults-file="$INI_FILE" \
        --no-create-info \
        --skip-triggers \
        --insert-ignore \
        mysql procs_priv > "$PROCS_FILE"

    if [ -z "$DB_COMMIT" ]; then
        applyRoutines "find routines -type f"
    else
        applyRoutines "git diff --name-only --diff-filter=D $DB_COMMIT -- routines"
        applyRoutines "git diff --name-only --diff-filter=d $DB_COMMIT -- routines"
    fi

    if [ "$ROUTINES_CHANGED" -gt "0" ]; then
        dbExecFromFile "$PROCS_FILE" "mysql"

        if [ "$?" -eq "0" ]; then
            dbExec "FLUSH PRIVILEGES"
            rm "$PROCS_FILE"
        else
            warn "An error ocurred when restoring routine privileges, backup saved at $PROCS_FILE"
        fi

        log " -> $ROUTINES_CHANGED routines have changed."
    else
        log " -> No routines changed."
        rm "$PROCS_FILE"
    fi
fi

N_CHANGES=$((N_CHANGES + ROUTINES_CHANGED))

# Display summary

if [ "$N_CHANGES" -gt "0" ]; then
    if [ "$IS_USER" == "TRUE" ]; then
        SQL=(
            "INSERT INTO $SCHEMA.versionUser SET "
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
            "INSERT INTO $SCHEMA.version SET "
                "code = '$CODE', "
                "number = '$LAST_APPLIED_VERSION', "
                "gitCommit = '$COMMIT_SHA' "
            "ON DUPLICATE KEY UPDATE "
                "number = VALUES(number), "
                "gitCommit = VALUES(gitCommit)"
        )
    fi

    dbExec "${SQL[*]}"
    log "Changes applied succesfully."
else
    log "No changes applied."
fi
