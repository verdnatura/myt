const Myt = require('./myt');
const Command = require('./lib/command');
const fs = require('fs-extra');
const nodegit = require('nodegit');
const ExporterEngine = require('./lib/exporter-engine');
const connExt = require('./lib/conn');
const repoExt = require('./lib/repo');
const SqlString = require('sqlstring');

/**
 * Pushes changes to remote.
 */
class Push extends Command {
    static usage = {
        description: 'Apply changes into database',
        params: {
            force: 'Answer yes to all questions',
            commit: 'Wether to save the commit SHA into database',
            sums: 'Save SHA sums of pushed objects',
            triggers: 'Wether to exclude triggers, used to generate local DB'
        },
        operand: 'remote'
    };

    static opts = {
        alias: {
            force: 'f',
            commit: 'c',
            sums: 's',
            triggers: 't'
        },
        boolean: [
            'force',
            'commit',
            'sums',
            'triggers'
        ]
    };

    async run(myt, opts) {
        const conn = await myt.dbConnect();
        this.conn = conn;

        if (opts.remote == 'local')
            opts.commit = true;

        // Obtain exclusive lock

        const [[row]] = await conn.query(
            `SELECT GET_LOCK('myt_push', 30) getLock`);

        if (!row.getLock) {
            let isUsed = 0;

            if (row.getLock == 0) {
                const [[row]] = await conn.query(
                    `SELECT IS_USED_LOCK('myt_push') isUsed`);
                isUsed = row.isUsed;
            }

            throw new Error(`Cannot obtain exclusive lock, used by connection ${isUsed}`);
        }

        async function releaseLock() {
            await conn.query(`DO RELEASE_LOCK('myt_push')`);
        }

        try {
            await this.push(myt, opts, conn);
        } catch(err) {
            try {
                await releaseLock();
            } catch (e) {
                console.error(e);
            }
            throw err;
        }

        await releaseLock();
    }

    async push(myt, opts, conn) {
        const pushConn = await myt.createConnection();

        // Get database version

        const version = await myt.fetchDbVersion() || {};

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
        let silent = true;
        const versionsDir = opts.versionsDir;

        function logVersion(version, name, error) {
            console.log('', version.bold, name);
        }
        function logScript(type, message, error) {
            console.log(' ', type.bold, message);
        }
        function isUndoScript(script) {
            return /\.undo\.sql$/.test(script);
        }

        const skipFiles = new Set([
            'README.md',
            '.archive'
        ]);

        if (await fs.pathExists(versionsDir)) {
            const versionDirs = await fs.readdir(versionsDir);

            for (const versionDir of versionDirs) {
                if (skipFiles.has(versionDir)) continue;

                const dirVersion = myt.parseVersionDir(versionDir);
                if (!dirVersion) {
                    logVersion('[?????]'.yellow, versionDir,
                        `Wrong directory name.`
                    );
                    continue;
                }

                const versionNumber = dirVersion.number;
                const versionName = dirVersion.name;

                if (versionNumber.length != version.number.length) {
                    logVersion('[*****]'.gray, versionDir,
                        `Bad version length, should have ${version.number.length} characters.`
                    );
                    continue;
                }

                const scriptsDir = `${versionsDir}/${versionDir}`;
                const scripts = await fs.readdir(scriptsDir);

                const [versionLog] = await conn.query(
                    `SELECT file FROM versionLog
                        WHERE code = ?
                            AND number = ?
                            AND errorNumber IS NULL`,
                    [opts.code, versionNumber]
                );

                for (const script of scripts)
                if (!isUndoScript(script)
                && versionLog.findIndex(x => x.file == script) === -1) {
                    silent = false;
                    break;
                }

                if (silent) continue;
                logVersion(`[${versionNumber}]`.cyan, versionName);

                for (const script of scripts) {
                    if (!/^[0-9]{2}-[a-zA-Z0-9_]+(.undo)?\.sql$/.test(script)) {
                        logScript('[W]'.yellow, script, `Wrong file name.`);
                        continue;
                    }
                    if (isUndoScript(script))
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
                        await connExt.queryFromFile(pushConn,
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
    
        const gitExists = await fs.pathExists(`${opts.workspace}/.git`);

        let nRoutines = 0;
        let changes = await this.changedRoutines(version.gitCommit);
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

        const engine = new ExporterEngine(conn, opts);
        await engine.init();

        async function finalize() {
            await engine.saveInfo();

            if (routines.length) {
                await conn.query('FLUSH PRIVILEGES');
                await conn.query(`DROP TEMPORARY TABLE tProcsPriv`);
            }
        }

        for (const change of changes)
        try {
            if (opts.trigger && change.type.name === 'TRIGGER')
                continue;

            const schema = change.schema;
            const name = change.name;
            const type = change.type.name.toLowerCase();
            const fullPath = `${opts.routinesDir}/${change.path}.sql`;
            const exists = await fs.pathExists(fullPath);

            let newSql;
            if (exists)
                newSql = await fs.readFile(fullPath, 'utf8');
            const oldSql = await engine.fetchRoutine(type, schema, name);
            const oldSum = engine.getShaSum(type, schema, name);
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

            if (!isEqual) {
                const scapedSchema = SqlString.escapeId(schema, true);

                if (exists) {
                    if (change.type.name === 'VIEW')
                        await pushConn.query(`USE ${scapedSchema}`);

                    await connExt.multiQuery(pushConn, newSql);

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

                    if (opts.sums || oldSum || (opts.sumViews && type === 'view'))
                        await engine.fetchShaSum(type, schema, name);
                } else {
                    const escapedName =
                        scapedSchema + '.' +
                        SqlString.escapeId(name, true);

                    const query = `DROP ${change.type.name} IF EXISTS ${escapedName}`;
                    await pushConn.query(query);

                    engine.deleteShaSum(type, schema, name);
                }

                nRoutines++;
            }
        } catch (err) {
            try {
                await finalize();
            } catch (e) {
                console.error(e);
            }
            throw err;
        }

        await finalize();

        if (nRoutines > 0) {
            console.log(` -> ${nRoutines} routines have changed.`);
        } else
            console.log(` -> No routines changed.`);

        if (gitExists && opts.commit) {
            const repo = await nodegit.Repository.open(this.opts.workspace);
            const head = await repo.getHeadCommit();

            if (head && version.gitCommit !== head.sha())
                await this.updateVersion('gitCommit', head.sha());
        }

        // End

        await pushConn.end();
    }

    parseChanges(changes) {
        const routines = [];
        if (changes)
            for (const change of changes)
                routines.push(new Routine(change));
        return routines;
    }

    async updateVersion(column, value) {
        column = SqlString.escapeId(column, true);
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

    async changedRoutines(commitSha) {
        const repo = await this.myt.openRepo();
        const changes = [];
        const changesMap = new Map();

        async function pushChanges(diff) {
            if (!diff) return;
            const patches = await diff.patches();

            for (const patch of patches) {
                const path = patch.newFile().path();
                const match = path.match(/^routines\/(.+)\.sql$/);
                if (!match) continue;

                let change = changesMap.get(match[1]);
                if (!change) {
                    change = {path: match[1]};
                    changes.push(change);
                    changesMap.set(match[1], change);
                }
                change.mark = patch.isDeleted() ? '-' : '+';
            }
        }

        const head = await repo.getHeadCommit();

        if (head && commitSha) {
            let commit;
            let notFound;

            try {
                commit = await repo.getCommit(commitSha);
                notFound = false;
            } catch (err) {
                if (err.errorFunction == 'Commit.lookup')
                    notFound = true;
                else
                    throw err;
            }

            if (notFound) {
                console.warn(`Database commit not found, trying git fetch`.yellow);
                await repo.fetchAll();
                commit = await repo.getCommit(commitSha);
            }

            const commitTree = await commit.getTree();

            const headTree = await head.getTree();
            const diff = await headTree.diff(commitTree);
            await pushChanges(diff);
        }

        await pushChanges(await repoExt.getUnstaged(repo));
        await pushChanges(await repoExt.getStaged(repo));

        return changes.sort((a, b) => {
            if (b.mark != a.mark)
                return b.mark == '-' ? 1 : -1;
            return a.path.localeCompare(b.path);
        });
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

        if (split.length !== 3 || !type)
            throw new Error(`Wrong routine path for '${path}', check that the sql file is located in the correct directory`);

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

module.exports = Push;

if (require.main === module)
    new Myt().run(Push);
