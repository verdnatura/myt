
const MyVC = require('./myvc');
const fs = require('fs-extra');
const nodegit = require('nodegit');

/**
 * Pushes changes to remote.
 */
class Push {
    get usage() {
        return {
            description: 'Apply changes into database',
            params: {
                force: 'Answer yes to all questions',
                user: 'Update the user version instead, for shared databases'
            },
            operand: 'remote'
        };
    }

    get localOpts() {
        return {
            boolean: {
                force: 'f',
                user: 'u'
            }
        };
    }

    async run(myvc, opts) {
        const conn = await myvc.dbConnect();
        this.conn = conn;

        // Obtain exclusive lock

        const [[row]] = await conn.query(
            `SELECT GET_LOCK('myvc_push', 30) getLock`);

        if (!row.getLock) {
            let isUsed = 0;

            if (row.getLock == 0) {
                const [[row]] = await conn.query(
                    `SELECT IS_USED_LOCK('myvc_push') isUsed`);
                isUsed = row.isUsed;
            }

            throw new Error(`Cannot obtain exclusive lock, used by connection ${isUsed}`);
        }

        // Get database version

        const version = await myvc.fetchDbVersion() || {};

        console.log(
            `Database information:`
            + `\n -> Version: ${version.number}`
            + `\n -> Commit: ${version.gitCommit}`
        );

        if (!version.number)
            version.number = String('0').padStart(opts.versionDigits, '0');
        if (!/^[0-9]*$/.test(version.number))
            throw new Error('Wrong database version');

        if (opts.user) {
            const user = await this.getDbUser();
            let [[userVersion]] = await conn.query(
                `SELECT number, gitCommit
                    FROM versionUser
                    WHERE code = ? AND user = ?`,
                [opts.code, user]
            );
            userVersion = userVersion || {};
            console.log(
                `User information:`
                + `\n -> User: ${user}`
                + `\n -> Version: ${userVersion.number}`
                + `\n -> Commit: ${userVersion.gitCommit}`
            );

            if (userVersion.number > version.number)
                version.number = userVersion.number;
            if (userVersion.gitCommit && userVersion.gitCommit !== version.gitCommit)
                version.gitCommit = userVersion.gitCommit;
        }

        // Prevent push to production by mistake

        if (opts.remote == 'production') {
            console.log(
                '\n (   (       ) (                       (       )     ) '
                + '\n )\\ ))\\ ) ( /( )\\ )          (        ))\\ ) ( /(  ( /( '
                + '\n(()/(()/( )\\()|()/(     (    )\\   )  /(()/( )\\()) )\\())'
                + '\n /(_))(_)|(_)\\ /(_))    )\\ (((_) ( )(_))(_)|(_)\\ ((_)\\ '
                + '\n(_))(_))   ((_|_))_  _ ((_))\\___(_(_()|__)) ((_)  _((_)'
                + '\n| _ \\ _ \\ / _ \\|   \\| | | ((/ __|_   _|_ _| / _ \\| \\| |'
                + '\n|  _/   /| (_) | |) | |_| || (__  | |  | | | (_) | .  |'
                + '\n|_| |_|_\\ \\___/|___/ \\___/  \\___| |_| |___| \\___/|_|\\_|'
                + '\n'
            );

            if (!opts.force) {
                const readline = require('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                const answer = await new Promise(resolve => {
                    rl.question('Are you sure? (Default: no) [yes|no] ', resolve);
                });
                rl.close();

                if (answer !== 'yes')
                    throw new Error('Changes aborted');
            }
        }

        // Apply versions

        console.log('Applying versions.');
        const pushConn = await myvc.createConnection();

        let nChanges = 0;
        const versionsDir = `${opts.myvcDir}/versions`;

        function logVersion(type, version, name) {
            console.log('', type.bold, `[${version.bold}]`, name);
        }

        if (await fs.pathExists(versionsDir)) {
            const versionDirs = await fs.readdir(versionsDir);

            for (const versionDir of versionDirs) {
                if (versionDir == 'README.md')
                    continue;

                const match = versionDir.match(/^([0-9])-([a-zA-Z0-9]+)?$/);
                if (!match) {
                    logVersion('[W]'.yellow, '?????', versionDir);
                    continue;
                }

                const versionNumber = match[1];
                const versionName = match[2];

                if (versionNumber.length != version.number.length) {
                    logVersion('[W]'.yellow, '*****', versionDir);
                    continue;
                }
                if (version.number >= versionNumber) {
                    logVersion('[I]'.blue, versionNumber, versionName);
                    continue;
                }

                logVersion('[+]'.green, versionNumber, versionName);
                const scriptsDir = `${versionsDir}/${versionDir}`;
                const scripts = await fs.readdir(scriptsDir);

                for (const script of scripts) {
                    if (!/^[0-9]{2}-[a-zA-Z0-9_]+\.sql$/.test(script)) {
                        console.log(`  - Ignoring wrong file name: ${script}`);
                        continue;
                    }

                    console.log(`  - ${script}`);
                    await this.queryFromFile(pushConn, `${scriptsDir}/${script}`);
                    nChanges++;
                }

                await this.updateVersion(nChanges, 'number', versionNumber);
            }
        }

        // Apply routines

        console.log('Applying changed routines.');

        let nRoutines = 0;
        let changes = await fs.pathExists(`${opts.workspace}/.git`)
            ? await myvc.changedRoutines(version.gitCommit)
            : await myvc.cachedChanges();
        changes = this.parseChanges(changes);

        const routines = [];
        for (const change of changes)
            if (change.isRoutine)
                routines.push([change.schema, change.name]);

        if (routines.length) {
            await conn.query(
                `DROP TEMPORARY TABLE IF EXISTS tProcsPriv`
            );
            await conn.query(
                `CREATE TEMPORARY TABLE tProcsPriv
                    ENGINE = MEMORY
                    SELECT * FROM mysql.procs_priv
                        WHERE (Db, Routine_name) IN (?)`,
                [routines]
            );
        }

        for (const change of changes) {
            const fullPath = `${opts.myvcDir}/routines/${change.path}.sql`;
            const exists = await fs.pathExists(fullPath);

            const actionMsg = exists ? '[+]'.green : '[-]'.red;
            const typeMsg = `[${change.type.abbr}]`[change.type.color];
            console.log('', actionMsg.bold, typeMsg.bold, change.fullName);

            try {
                const scapedSchema = pushConn.escapeId(change.schema, true);

                if (exists) {
                    if (change.type.name = 'VIEW')
                        await pushConn.query(`USE ${scapedSchema}`);

                    await this.queryFromFile(pushConn, `routines/${change.path}.sql`);

                    if (change.isRoutine) {
                        await conn.query(
                            `INSERT IGNORE INTO mysql.procs_priv
                                SELECT * FROM tProcsPriv
                                WHERE Db = ?
                                    AND Routine_name = ?
                                    AND Routine_type = ?`,
                            [change.schema, change.name, change.type.name]
                        );
                    }
                } else {
                    const escapedName =
                        scapedSchema + '.' +
                        pushConn.escapeId(change.name, true);

                    const query = `DROP ${change.type.name} IF EXISTS ${escapedName}`;
                    await pushConn.query(query);
                }
            } catch (err) {
                if (err.sqlState)
                    console.warn('Warning:'.yellow, err.message);
                else
                    throw err;
            }

            nRoutines++;
        }

        if (routines.length) {
            await conn.query(`DROP TEMPORARY TABLE tProcsPriv`);
            await conn.query('FLUSH PRIVILEGES');
        }

        // Update and release

        await pushConn.end();

        if (nRoutines > 0) {
            console.log(` -> ${nRoutines} routines have changed.`);
        } else
            console.log(` -> No routines changed.`);

        const repo = await nodegit.Repository.open(this.opts.workspace);
        const head = await repo.getHeadCommit();

        if (version.gitCommit !== head.sha())
            await this.updateVersion(nRoutines, 'gitCommit', head.sha());

        await conn.query(`DO RELEASE_LOCK('myvc_push')`);
    }

    parseChanges(changes) {
        const routines = [];
        if (changes)
            for (const change of changes)
                routines.push(new Routine(change));
        return routines;
    }

    async getDbUser() {
        const [[row]] = await this.conn.query('SELECT USER() `user`');
        return row.user.substr(0, row.user.indexOf('@'));
    }

    async updateVersion(nChanges, column, value) {
        if (nChanges == 0) return;
        const {opts} = this;

        column = this.conn.escapeId(column, true);

        if (opts.user) {
            const user = await this.getDbUser();
            await this.conn.query(
                `INSERT INTO versionUser
                    SET code = ?, 
                        user = ?, 
                        ${column} = ?,
                        updated = NOW()
                    ON DUPLICATE KEY UPDATE 
                        ${column} = VALUES(${column}),
                        updated = VALUES(updated)`,
                [
                    opts.code,
                    user,
                    value
                ]
            );
        } else {
            await this.conn.query(
                `INSERT INTO version
                    SET code = ?,
                        ${column} = ?,
                        updated = NOW()
                    ON DUPLICATE KEY UPDATE 
                        ${column} = VALUES(${column}),
                        updated = VALUES(updated)`,
                [
                    opts.code,
                    value
                ]
            );
        }
    }

    /**
     * Executes an SQL script.
     *
     * @param {String} file Path to the SQL script
     * @returns {Array<Result>} The resultset
     */
    async queryFromFile(conn, file) {
        let results = [];
        const stmts = this.querySplit(await fs.readFile(file, 'utf8'));

        for (const stmt of stmts)
            results = results.concat(await conn.query(stmt));

        return results;
    }

    /**
     * Splits an SQL muti-query into a single-query array, it does an small 
     * parse to correctly handle the DELIMITER statement.
     *
     * @param {Array<String>} stmts The splitted SQL statements
     */
    querySplit(sql) {
        const stmts = [];
        let i,
            char,
            token,
            escaped,
            stmtStart;

        let delimiter = ';';
        const delimiterRe = /\s*delimiter\s+(\S+)[^\S\r\n]*(?:\r?\n|\r)/yi;

        function begins(str) {
            let j;
            for (j = 0; j < str.length; j++)
                if (sql[i + j] != str[j])
                    return false;
            i += j;
            return true;
        }

        for (i = 0; i < sql.length;) {
            stmtStart = i;

            delimiterRe.lastIndex = i;
            const match = sql.match(delimiterRe);
            if (match) {
                delimiter = match[1];
                i += match[0].length;
                continue;
            }

            while (i < sql.length) {
                char = sql[i];

                if (token) {
                    if (!escaped && begins(token.end))
                        token = null;
                    else {
                        escaped = !escaped && token.escape(char);
                        i++;
                    }
                } else {
                    if (begins(delimiter)) break;

                    const tok = tokenIndex.get(char);
                    if (tok && begins(tok.start))
                        token = tok;
                    else
                        i++;
                }
            }

            const len = i - stmtStart - delimiter.length;
            stmts.push(sql.substr(stmtStart, len));
        }

        const len = stmts.length;
        if (len > 1 && /^\s*$/.test(stmts[len - 1]))
            stmts.pop();

        return stmts;
    }
}

const typeMap = {
    events: {
        name: 'EVENT',
        abbr: 'EVNT',
        color: 'cyan'
    },
    functions: {
        name: 'FUNCTION',
        abbr: 'FUNC',
        color: 'cyan'
    },
    procedures: {
        name: 'PROCEDURE',
        abbr: 'PROC',
        color: 'yellow'
    },
    triggers: {
        name: 'TRIGGER',
        abbr: 'TRIG',
        color: 'blue'
    },
    views: {
        name: 'VIEW',
        abbr: 'VIEW',
        color: 'magenta'
    },
};

const routineTypes = new Set([
    'FUNCTION',
    'PROCEDURE'
]);

class Routine {
    constructor(change) {
        const path = change.path;
        const split = path.split('/');

        const schema = split[0];
        const type = typeMap[split[1]];
        const name = split[2];

        Object.assign(this, {
            path,
            mark: change.mark,
            type,
            schema,
            name,
            fullName: `${schema}.${name}`,
            isRoutine: routineTypes.has(type.abbr)
        });
    }
}

const tokens = {
    string: {
        start: '\'',
        end: '\'',
        escape: char => char == '\'' || char == '\\'
    },
    id: {
        start: '`',
        end: '`',
        escape: char => char == '`'
    },
    multiComment: {
        start: '/*',
        end: '*/',
        escape: () => false
    },
    singleComment: {
        start: '-- ',
        end: '\n',
        escape: () => false
    }
};

const tokenIndex = new Map();
for (const tokenId in tokens) {
    const token = tokens[tokenId];
    tokenIndex.set(token.start[0], token);
}

module.exports = Push;

if (require.main === module)
    new MyVC().run(Push);
