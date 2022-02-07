
const MyVC = require('./myvc');
const fs = require('fs-extra');
const nodegit = require('nodegit');
const ExporterEngine = require('./lib').ExporterEngine;

/**
 * Pushes changes to remote.
 */
class Push {
    get usage() {
        return {
            description: 'Apply changes into database',
            params: {
                force: 'Answer yes to all questions'
            },
            operand: 'remote'
        };
    }

    get localOpts() {
        return {
            alias: {
                force: 'f'
            },
            boolean: [
                'force'
            ]
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

        const pushConn = await myvc.createConnection();

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

        let nChanges = 0;
        const versionsDir = `${opts.myvcDir}/versions`;

        function logVersion(version, name, error) {
            console.log('', version.bold, name);
        }
        function logScript(type, message, error) {
            console.log(' ', type.bold, message);
        }

        if (await fs.pathExists(versionsDir)) {
            const versionDirs = await fs.readdir(versionsDir);

            for (const versionDir of versionDirs) {
                if (versionDir == 'README.md')
                    continue;

                const match = versionDir.match(/^([0-9]+)-([a-zA-Z0-9]+)?$/);
                if (!match) {
                    logVersion('[?????]'.yellow, versionDir,
                        `Wrong directory name.`
                    );
                    continue;
                }

                const versionNumber = match[1];
                const versionName = match[2];

                if (versionNumber.length != version.number.length) {
                    logVersion('[*****]'.gray, versionDir,
                        `Bad version length, should have ${version.number.length} characters.`
                    );
                    continue;
                }

                logVersion(`[${versionNumber}]`.cyan, versionName);
                const scriptsDir = `${versionsDir}/${versionDir}`;
                const scripts = await fs.readdir(scriptsDir);

                for (const script of scripts) {
                    if (!/^[0-9]{2}-[a-zA-Z0-9_]+(.undo)?\.sql$/.test(script)) {
                        logScript('[W]'.yellow, script, `Wrong file name.`);
                        continue;
                    }
                    if (/\.undo\.sql$/.test(script))
                        continue;

                    const [[row]] = await conn.query(
                        `SELECT errorNumber FROM versionLog
                            WHERE code = ?
                                AND number = ?
                                AND file = ?`,
                        [
                            opts.code,
                            versionNumber,
                            script
                        ]
                    );
                    const apply = !row || row.errorNumber;
                    const actionMsg = apply ? '[+]'.green : '[I]'.blue;
                    
                    logScript(actionMsg, script);
                    if (!apply) continue;

                    let err;
                    try {
                        await this.queryFromFile(pushConn,
                            `${scriptsDir}/${script}`);
                    } catch (e) {
                        err = e;
                    }

                    await conn.query(
                        `INSERT INTO versionLog
                            SET code = ?,
                                number = ?,
                                file = ?,
                                user = USER(),
                                updated = NOW(),
                                errorNumber = ?,
                                errorMessage = ?
                            ON DUPLICATE KEY UPDATE
                                updated = VALUES(updated),
                                user = VALUES(user),
                                errorNumber = VALUES(errorNumber),
                                errorMessage = VALUES(errorMessage)`,
                        [
                            opts.code,
                            versionNumber,
                            script,
                            err && err.errno,
                            err && err.message
                        ]
                    );

                    if (err) throw err;
                    nChanges++;
                }

                await this.updateVersion('number', versionNumber);
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
                routines.push([
                    change.schema,
                    change.name,
                    change.type.name
                ]);

        if (routines.length) {
            await conn.query(
                `DROP TEMPORARY TABLE IF EXISTS tProcsPriv`
            );
            await conn.query(
                `CREATE TEMPORARY TABLE tProcsPriv
                    ENGINE = MEMORY
                    SELECT * FROM mysql.procs_priv
                        WHERE (Db, Routine_name, Routine_type) IN (?)`,
                [routines]
            );
        }

        const engine = new ExporterEngine(conn, opts.myvcDir);
        await engine.init();

        for (const change of changes) {
            const schema = change.schema;
            const name = change.name;
            const type = change.type.name.toLowerCase();
            const fullPath = `${opts.myvcDir}/routines/${change.path}.sql`;
            const exists = await fs.pathExists(fullPath);

            let newSql;
            if (exists)
                newSql = await fs.readFile(fullPath, 'utf8');
            const oldSql = await engine.fetchRoutine(type, schema, name);
            const isEqual = newSql == oldSql;

            let actionMsg;
            if ((exists && isEqual) || (!exists && !oldSql))
                actionMsg = '[I]'.blue;
            else if (exists)
                actionMsg = '[+]'.green;
            else
                actionMsg = '[-]'.red;

            const typeMsg = `[${change.type.abbr}]`[change.type.color];
            console.log('', actionMsg.bold, typeMsg.bold, change.fullName);

            if (!isEqual)
            try {
                const scapedSchema = pushConn.escapeId(schema, true);

                if (exists) {
                    if (change.type.name === 'VIEW')
                        await pushConn.query(`USE ${scapedSchema}`);

                    await this.multiQuery(pushConn, newSql);

                    if (change.isRoutine) {
                        await conn.query(
                            `INSERT IGNORE INTO mysql.procs_priv
                                SELECT * FROM tProcsPriv
                                    WHERE Db = ?
                                        AND Routine_name = ?
                                        AND Routine_type = ?`,
                            [schema, name, change.type.name]
                        );
                    }

                    await engine.fetchShaSum(type, schema, name);
                } else {
                    const escapedName =
                        scapedSchema + '.' +
                        pushConn.escapeId(name, true);

                    const query = `DROP ${change.type.name} IF EXISTS ${escapedName}`;
                    await pushConn.query(query);

                    engine.deleteShaSum(type, schema, name);
                }

                nRoutines++;
            } catch (err) {
                if (err.sqlState)
                    console.warn('Warning:'.yellow, err.message);
                else
                    throw err;
            }

        }

        await engine.saveShaSums();

        if (routines.length) {
            await conn.query(`DROP TEMPORARY TABLE tProcsPriv`);
            await conn.query('FLUSH PRIVILEGES');
        }

        if (nRoutines > 0) {
            console.log(` -> ${nRoutines} routines have changed.`);
        } else
            console.log(` -> No routines changed.`);

        const repo = await nodegit.Repository.open(this.opts.workspace);
        const head = await repo.getHeadCommit();

        if (version.gitCommit !== head.sha())
            await this.updateVersion('gitCommit', head.sha());

        // Update and release

        await pushConn.end();
        await conn.query(`DO RELEASE_LOCK('myvc_push')`);
    }

    parseChanges(changes) {
        const routines = [];
        if (changes)
            for (const change of changes)
                routines.push(new Routine(change));
        return routines;
    }

    async updateVersion(column, value) {
        column = this.conn.escapeId(column, true);
        await this.conn.query(
            `INSERT INTO version
                SET code = ?,
                    ${column} = ?,
                    updated = NOW()
                ON DUPLICATE KEY UPDATE 
                    ${column} = VALUES(${column}),
                    updated = VALUES(updated)`,
            [
                this.opts.code,
                value
            ]
        );
    }

    /**
     * Executes a multi-query string.
     *
     * @param {Connection} conn MySQL connection object
     * @param {String} sql SQL multi-query string
     * @returns {Array<Result>} The resultset
     */
    async multiQuery(conn, sql) {
        let results = [];
        const stmts = this.querySplit(sql);

        for (const stmt of stmts)
            results = results.concat(await conn.query(stmt));

        return results;
    }

    /**
     * Executes an SQL script.
     *
     * @param {Connection} conn MySQL connection object
     * @returns {Array<Result>} The resultset
     */
    async queryFromFile(conn, file) {
        const sql = await fs.readFile(file, 'utf8');
        return await this.multiQuery(conn, sql);
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
            isRoutine: routineTypes.has(type.name)
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
