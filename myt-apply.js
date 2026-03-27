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

    async run(myt, opts) {
        if (opts.docker)
            opts.dbConfig = {
                user: 'mysql',
                socketPath: '/run/mysqld/mysqld.sock'
            };

        const dbConfig = opts.dbConfig;
        const dumpDir = opts.dumpDir;

        if (opts.structure) {
            await this.importFile(`${dumpDir}/dump.before.sql`);

            const importFiles = [
                'structure.sql',
                'data.sql',
                'triggers.sql',
                'privileges.sql',
            ];
            for (const file of importFiles)
                await this.importFile(`${dumpDir}/.dump/${file}`, true);

            await this.importFile(`${dumpDir}/dump.after.sql`);
        }

        if (opts.changes) {
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

            const hasTriggers = await fs.exists(`${dumpDir}/.dump/triggers.sql`);

            Object.assign(opts, {
                triggers: !hasTriggers,
                commit: true,
                dbConfig
            });
            await myt.run(Push, opts);

            // Apply fixtures

            this.emit('applyingFixtures');
            await this.importFile(`${dumpDir}/fixtures.before.sql`);
            await this.importFile(`${dumpDir}/.fixtures.sql`, true);
            await this.importFile(`${dumpDir}/fixtures.after.sql`);
            await this.importFile(`${dumpDir}/fixtures.local.sql`);

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

    async importFile(file, force) {
        if (!await fs.exists(file))
            return;

        const execArgs = [
            '--default-character-set=utf8',
            '--comments',
        ];

        if (force)
            execArgs.push('--force');
        if (!this.opts.docker) {
            const iniPath = path.join('remotes', this.opts.iniFile);
            execArgs.push(`--defaults-file=${iniPath}`);
        }

        let stdio;
        const mysqlBin = 'mariadb';
        if (this.opts.debug === true) {
            const quotedArgs = execArgs
                .map(x => /\s/g.test(x) ? `"${x}"` : x)
                .join(' ');
            console.debug('Command:', `${mysqlBin} ${quotedArgs} < ${file}`.yellow);

            stdio = ['pipe', 'inherit', 'inherit'];
        } else {
            stdio = ['pipe', 'ignore', 'ignore'];
        }
        
        const child = spawn(mysqlBin, execArgs, {stdio});
        fs.createReadStream(file).pipe(child.stdin);

        return await new Promise((resolve, reject) => {
            child.on('exit', code => {
                if (code !== 0)
                    reject(new Error(`${mysqlBin} exit code ${code}`));
                else
                    resolve(code);
            });
        });
    }
}

module.exports = Run;

if (require.main === module)
    new Myt().cli(Run);