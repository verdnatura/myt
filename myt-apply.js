const Myt = require('./myt');
const Command = require('./lib/command');
const Push = require('./myt-push');
const fs = require('fs-extra');
const path = require('path');
const connExt = require('./lib/conn');
const SqlString = require('sqlstring');
const spawn = require('child_process').spawn;

class Run extends Command {
    static usage = {
        description: 'Initialize database',
        params: {
            realm: 'Name of fixture realm to use',
            docker: 'Whether apply is running inside docker database container'
        },
        operand: 'realm'
    };

    static opts = {
        alias: {
            structure: 's',
            changes: 'c',
            realm: 'm',
            docker: 'd'
        },
        boolean: [
            'docker',
            'structure',
            'changes'
        ]
    };

    static reporter = {
        mockingDate: 'Mocking date functions.',
        applyingFixtures: 'Applying fixtures.',
        applyingRealms: 'Applying realm fixtures.',
        creatingTriggers: 'Creating triggers.',
    };

    async importFile(file) {
        if (!await fs.exists(file))
            return;

        const execArgs = [
            '--default-character-set=utf8',
            '--comments',
            '--force'
        ];

        let stdio;
        if (this.opts.debug === true) {
            const quotedArgs = execArgs
                .map(x => /\s/g.test(x) ? `"${x}"` : x)
                .join(' ');
            console.debug('Command:', `mysql ${quotedArgs} < ${file}`.yellow);

            stdio: ['pipe', 'inherit', 'inherit'];
        } else {
            stdio: ['pipe', 'ignore', 'ignore'];
        }
        
        const child = spawn('mysql', execArgs, {stdio});
        fs.createReadStream(file).pipe(child.stdin);

        return await new Promise((resolve, reject) => {
            child.on('exit', code => {
                if (code !== 0)
                    reject(new Error(`mysql exit code ${code}`));
                else
                    resolve(code);
            });
        });
    }

    async run(myt, opts) {
        if (opts.docker)
            opts.dbConfig = {
                user: 'mysql',
                socketPath: '/run/mysqld/mysqld.sock'
            };

        const dbConfig = opts.dbConfig;

        if (opts.structure) {
            const importFiles = [
                'dump.before.sql',
                '.dump/structure.sql',
                '.dump/data.sql',
                '.dump/triggers.sql',
                '.dump/privileges.sql',
                'dump.after.sql'
            ];
            for (const file of importFiles)
                await this.importFile(`${opts.mytDir}/dump/${file}`);
        }

        if (opts.changes) {
            const dumpDir = opts.dumpDir;
            const dumpDataDir = path.join(dumpDir, '.dump');
            const conn = await myt.createConnection();

            // Mock date functions

            this.emit('mockingDate');
            const mockDateScript = path.join(dumpDir, 'mockDate.sql');

            if (opts.mockDate) {
                if (!await fs.pathExists(mockDateScript))
                    throw new Error(`Date mock enabled but mock script does not exist: ${mockDateScript}`);

                let sql = await fs.readFile(mockDateScript, 'utf8');
                sql = sql.replace(/@mockDate/g, SqlString.escape(opts.mockDate));
                await connExt.multiQuery(conn, sql);
            }

            // Apply changes

            const hasTriggers = await fs.exists(`${dumpDataDir}/triggers.sql`);

            Object.assign(opts, {
                triggers: !hasTriggers,
                commit: true,
                dbConfig
            });
            await myt.run(Push, opts);

            // Apply fixtures

            this.emit('applyingFixtures');
            const fixturesFiles = [
                'fixtures.before',
                '.fixtures',
                'fixtures.after',
                'fixtures.local'
            ]
            for (const file of fixturesFiles) {
                if (!await fs.exists(`${dumpDir}/${file}.sql`)) continue;
                await this.importFile(`dump/${file}.sql`);
            }

            // Apply realms

            if(opts.realm) {
                this.emit('applyingRealms');
                const realmDir = `realms/${opts.realm}`;
                let realmFiles =  await fs.readdir(`${dumpDir}/${realmDir}`);
                realmFiles = realmFiles.map(file => path.parse(file).name);
                for (const file of realmFiles) {
                    await this.importFile(`${realmDir}/${file}.sql`);
                }
            }

            // Create triggers

            if (!hasTriggers) {
                this.emit('creatingTriggers');

                for (const schema of opts.schemas) {
                    const triggersPath = `${opts.routinesDir}/${schema}/triggers`;
                    if (!await fs.pathExists(triggersPath))
                        continue;

                    const triggersDir = await fs.readdir(triggersPath);
                    for (const triggerFile of triggersDir)
                        await connExt.queryFromFile(conn, `${triggersPath}/${triggerFile}`);
                }
            }

            await conn.end();
        }
    }
}

module.exports = Run;

if (require.main === module)
    new Myt().cli(Run);