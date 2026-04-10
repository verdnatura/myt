const Myt = require('./myt');
const Command = require('./lib/command');
const Push = require('./myt-push');
const fs = require('fs-extra');
const path = require('path');
const connExt = require('./lib/conn');
const SqlString = require('sqlstring');
const spawn = require('child_process').spawn;

class Apply extends Command {
    static usage = {
        description: 'Initialize database',
        params: {
            structure: 'Apply only structure',
            changes: 'Apply only changes',
            realm: 'Name of fixture realm to use',
            load: 'Load commit and changed routines from passed args'
        },
        operand: 'realm'
    };

    static opts = {
        alias: {
            structure: 's',
            changes: 'c',
            realm: 'm',
            load: 'l'
        },
        string: [
            'realm',
            'load'
        ],
        boolean: [
            'structure',
            'changes'
        ],
        default: {
            remote: 'socket'
        }
    };

    static reporter = {
        mockingDate: 'Mocking date functions.',
        applyingFixtures: 'Applying fixtures.',
        applyingRealm: 'Applying realm fixtures.',
        creatingTriggers: 'Creating triggers.',
    };

    async _run(myt, ctx, cfg, opts) {
        const {
            structureDir,
            dumpDir,
            fixturesDir
        } = ctx;

        const {triggersImport} = cfg;

        if (ctx.isProtectedRemote)
            throw new Error('Cannot apply to protected remote');

        if (opts.structure) {
            await this.importFile(path.join(structureDir, 'before.sql'));

            const importFiles = [
                'structure.sql',
                'data.sql',
            ];

            if (triggersImport == 'before')
                importFiles.push('triggers.sql');

            importFiles.push('privileges.sql');

            for (const file of importFiles)
                await this.importFile(path.join(dumpDir, file), true);

            await this.importFile(path.join(structureDir, 'after.sql'));
        }

        if (opts.changes) {
            const conn = await myt.createConnection();

            // Mock date functions

            this.emit('mockingDate');
            const mockDateScript = path.join(fixturesDir, 'mock-date.sql');

            if (cfg.mockDate) {
                if (!await fs.pathExists(mockDateScript))
                    throw new Error(`Date mock enabled but mock script does not exist: ${mockDateScript}`);

                let sql = await fs.readFile(mockDateScript, 'utf8');
                sql = sql.replace(/@mockDate/g, SqlString.escape(cfg.mockDate));
                await connExt.multiQuery(conn, sql);
            }

            // Apply changes

            await myt.run(Push, {
                triggers: triggersImport == 'after',
                load: opts.load,
                commit: true,
                tracked: true
            });

            // Apply fixtures

            this.emit('applyingFixtures');
            const fixturesFiles = [
                ['before.sql'],
                ['.dump.sql', true],
                ['after.sql'],
                ['local.sql'],
            ];
            for (const [file, force] of fixturesFiles)
                await this.importFile(path.join(fixturesDir, file), force);

            // Apply realms

            if (opts.realm) {
                this.emit('applyingRealm');
                const realmDir = `realms/${opts.realm}`;
                let realmFiles =  await fs.readdir(realmDir);
                realmFiles = realmFiles.map(file => path.parse(file).name);
                for (const file of realmFiles) {
                    await this.importFile(path.join(realmDir, `${file}.sql`));
                }
            }

            // Create triggers

            if (triggersImport == 'after') {
                this.emit('creatingTriggers');

                for (const schema of cfg.schemas) {
                    const triggersPath = `${ctx.routinesDir}/${schema}/triggers`;
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
        const {cfg, ctx} = this;

        if (!await fs.exists(file)) {
            if (cfg.debug)
                console.debug('Import:', `${file} does not exist, ignoring`);
            return;
        }

        const iniPath = path.join(ctx.mytDir, 'remotes', ctx.iniFile);
        const execArgs = [
            `--defaults-file=${iniPath}`,
            '--default-character-set=utf8',
            '--comments',
        ];

        if (force)
            execArgs.push('--force');

        let stdio;
        const mysqlBin = 'mariadb';
        if (cfg.debug === true) {
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

module.exports = Apply;

if (require.main === module)
    new Myt().cli(Apply);
