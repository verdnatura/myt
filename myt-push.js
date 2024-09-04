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
            commit: 'Whether to save the commit SHA into database',
            sums: 'Save SHA sums of pushed objects',
            triggers: 'Whether to exclude triggers, used to generate local DB'
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

    static reporter = {
        applyingVersions: 'Applying versions.',
        applyingRoutines: 'Applying changed routines.',
        dbInfo: function(version) {
            console.log(
                `Database information:`
                + `\n -> Version: ${version.number}`
                + `\n -> Commit: ${version.gitCommit}`
            );
        },
        version(version, dir, error) {
            let actionMsg;
            let number, color;

            if (!error) {
                actionMsg = version.apply
                    ? '[A]'.green
                    : '[I]'.blue;
                number = version.number;
                color = 'cyan';
            } else {
                actionMsg = '[W]'.yellow;
                switch(error) {
                    case 'badVersion':
                        number = '*****';
                        color = 'gray';
                        break;
                    case 'wrongDirectory':
                        number = '?????';
                        color = 'yellow';
                        break;
                }
            }

            const numberMsg = `[${number}]`[color];
            console.log('', `${actionMsg}${numberMsg}`.bold, version?.name || dir);
        },
        logScript(script) {
            let actionMsg;
            if (!script.matchRegex)
                actionMsg = '[W]'.yellow;
            else if (script.apply)
                actionMsg = '[+]'.green;
            else
                actionMsg = '[I]'.blue;

            console.log(' ', actionMsg.bold, script.file);
        },
        change(status, ignore, change) {
            let actionMsg;
            if (ignore)
                actionMsg = '[I]'.blue;
            else
                actionMsg = '[A]'.green;

            let statusMsg;
            switch(status) {
                case 'added':
                    statusMsg = '[+]'.green;
                    break;
                case 'deleted':
                    statusMsg = '[-]'.red;
                    break;
                case 'modified':
                    statusMsg = '[·]'.yellow;
                    break;
            }

            const typeMsg = `[${change.type.abbr}]`[change.type.color];
            console.log('',
                (actionMsg + statusMsg).bold,
                typeMsg.bold,
                change.fullName
            );
        },
        versionsApplied: function(nVersions, nChanges) {
            if (nVersions) {
                console.log(` -> ${nVersions} versions with ${nChanges} changes applied.`);
            } else
                console.log(` -> No versions applied.`);
        },
        routinesApplied: function(nRoutines) {
            if (nRoutines) {
                console.log(` -> ${nRoutines} routines changed.`);
            } else
                console.log(` -> No routines changed.`);
        }
    };

    async run(myt, opts) {
        const conn = await myt.dbConnect();
        this.conn = conn;

        if (opts.remote == 'local')
            opts.commit = true;

        // Obtain exclusive lock

        const [[row]] = await conn.query(
            `SELECT GET_LOCK('myt_push', 30) getLock`);

        const pingTimeout = setInterval(async() => {
            try {
                await conn.ping()
            } catch (e) {}
        }, 60 * 1000);

        if (!row.getLock) {
            let isUsed = 0;

            if (row.getLock == 0) {
                const [[row]] = await conn.query(
                    `SELECT IS_USED_LOCK('myt_push') isUsed`);
                isUsed = row.isUsed;
            }

            throw new Error(`Cannot obtain exclusive lock, used by connection ${isUsed}`);
        }

        const [[scheduler]] = await conn.query(`SELECT @@event_scheduler state`);
        if (scheduler.state === 'ON') await eventScheduler(false);

        async function eventScheduler(isActive) {
                await conn.query(
                    `SET GLOBAL event_scheduler = ${isActive ? 'ON' : 'OFF'}` 
                );
        }

        async function releaseLock() {
            if (scheduler.state === 'ON') await eventScheduler(true);
            await conn.query(`DO RELEASE_LOCK('myt_push')`);
        }

        try {
            await this.push(myt, opts, conn);
        } catch(err) {
            try {
                await releaseLock();
            } catch (e) {}
            throw err;
        } finally {
            clearInterval(pingTimeout);
        }

        await releaseLock();
    }

    async cli(myt, opts) {
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

        await super.cli(myt, opts);
    }

    async push(myt, opts, conn) {
        const pushConn = await myt.createConnection();

        // Get database version

        const dbVersion = await myt.fetchDbVersion() || {};
        this.emit('dbInfo', dbVersion);

        if (!dbVersion.number)
            dbVersion.number = String('0').padStart(opts.versionDigits, '0');
        if (!/^[0-9]*$/.test(dbVersion.number))
            throw new Error('Wrong database version');

        // Apply versions

        this.emit('applyingVersions');

        let nVersions = 0;
        let nChanges = 0;
        let showLog = false;
        const versionsDir = opts.versionsDir;

        const skipFiles = new Set([
            'README.md',
            '.archive'
        ]);

        if (await fs.pathExists(versionsDir)) {
            const versionDirs = await fs.readdir(versionsDir);
            for (const versionDir of versionDirs) {
                if (skipFiles.has(versionDir)) continue;
                const version = await myt.loadVersion(versionDir);

                let apply = false;

                if (!version) {
                    this.emit('version', version, versionDir, 'wrongDirectory');
                    continue;
                } else if (version.number.length != dbVersion.number.length) {
                    this.emit('version', version, versionDir, 'badVersion');
                    continue;
                }

                apply = version.apply;
                if (apply) showLog = true;
                if (showLog) this.emit('version', version, versionDir);
                if (!apply) continue;

                for (const script of version.scripts) {
                    this.emit('logScript', script);
                    if (!script.apply || !script.matchRegex) continue;

                    let err;
                    try {
                        await connExt.queryFromFile(pushConn,
                            `${versionsDir}/${versionDir}/${script.file}`);
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
                            version.number,
                            script.file,
                            err && err.errno,
                            err && err.message
                        ]
                    );

                    if (err) throw err;
                    nChanges++;
                }

                await this.updateVersion('number', version.number);
                nVersions++;
            }
        }

        this.emit('versionsApplied', nVersions, nChanges);

        // Apply routines

        this.emit('applyingRoutines');

        let nRoutines = 0;
        const changes = await this.changedRoutines(dbVersion.gitCommit);

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
            if (opts.triggers && change.type.name === 'TRIGGER')
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

            const isMockFn = type == 'function'
                && schema == opts.versionSchema
                && opts.remote == 'local'
                && opts.mockDate
                && opts.mockFunctions
                && opts.mockFunctions.indexOf(name) !== -1;
            const ignore = newSql == oldSql || isMockFn;

            let status;
            if (exists && !oldSql)
                status = 'added';
            else if (!exists)
                status = 'deleted';
            else
                status = 'modified';

            this.emit('change', status, ignore, change);

            if (!ignore) {
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

        this.emit('routinesApplied', nRoutines);

        const gitExists = await fs.pathExists(`${opts.workspace}/.git`);
        if (gitExists && opts.commit) {
            const repo = await nodegit.Repository.open(this.opts.workspace);
            const head = await repo.getHeadCommit();

            if (head && dbVersion.gitCommit !== head.sha())
                await this.updateVersion('gitCommit', head.sha());
        }

        // End

        await pushConn.end();
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

        const {opts} = this;
        async function pushChanges(diff) {
            if (!diff) return;
            const patches = await diff.patches();

            for (const patch of patches) {
                const path = patch.newFile().path();
                const match = path.match(opts.routinesRegex);
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

        const routines = [];
        for (const change of changes)
            routines.push(new Routine(change));

        return routines.sort((a, b) => {
            if (b.mark != a.mark)
                return b.mark == '-' ? -1 : 1;

            if (b.type.name !== a.type.name) {
                if (b.type.name == 'VIEW')
                    return -1;
                if (a.type.name == 'VIEW')
                    return 1;
            }

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
    new Myt().cli(Push);
