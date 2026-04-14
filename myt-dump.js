const Myt = require('./myt');
const Command = require('./lib/command');
const Dumper = require('./lib/dumper');
const fs = require('fs-extra');
const path = require('path');

class Dump extends Command {
    static usage = {
        description: 'Dumps structure and fixtures from remote',
        params: {
            lock: 'Whether to lock tables on dump'
        },
        operand: 'remote'
    };

    static args = {
        default: {
            remote: 'production'
        },
        alias: {
            lock: 'l'
        },
        boolean: [
            'lock'
        ]
    };

    static reporter = {
        dumpStructure: 'Dumping structure.',
        dumpData: 'Dumping data.',
        dumpPrivileges: 'Dumping privileges.',
        dumpTriggers: 'Dumping triggers.'
    };

    async _run(myt, ctx, cfg, opts) {
        const {dumpDir} = ctx;

        let dumper;
        const baseArgs = [
            `--lock-tables=${opts.lock ? 'true' : 'false'}`
        ];

        await fs.remove(dumpDir);

        // Structure

        this.emit('dumpStructure');

        dumper = new Dumper(myt);
        await dumper.init(dumpDir, 'structure');
        let dumpArgs = [
            '--default-character-set=utf8',
            '--no-data',
            '--comments',
            '--routines',
            '--events',
            '--skip-triggers'
        ].concat(baseArgs);

        dumpArgs.push('--databases');
        dumpArgs = dumpArgs.concat(cfg.schemas);
        await dumper.runDump('docker-dump.sh', dumpArgs);
        await dumper.end();

        // Data

        this.emit('dumpData');

        dumper = new Dumper(myt);
        await dumper.init(dumpDir, 'data');
        await dumper.dumpFixtures(cfg.fixtures, false, baseArgs);
        await dumper.end();

        // Privileges

        const privs = cfg.privileges;
        if (privs) {
            this.emit('dumpPrivileges');

            dumper = new Dumper(myt);
            await dumper.init(dumpDir, 'privileges');

            const {tables, userTable, where} = privs;

            if (tables)
                await dumper.dumpPrivileges(tables, baseArgs, where);

            if (userTable) {
                let userWhere = '';
                for (const cond of [where, privs.userWhere]) {
                    if (!cond) continue;
                    if (userWhere) userWhere += ' AND ';
                    userWhere += cond;
                }
                await dumper.dumpPrivileges([userTable], baseArgs, userWhere);
            }

            await dumper.end();
        }

        // Triggers

        this.emit('dumpTriggers');

        dumper = new Dumper(myt);
        await dumper.init(dumpDir, 'triggers');

        dumpArgs = [
            '--default-character-set=utf8',
            '--no-create-info',
            '--no-data',
            '--no-create-db',
            '--skip-opt',
            '--comments'
        ].concat(baseArgs);

        dumpArgs.push('--databases');
        dumpArgs = dumpArgs.concat(cfg.schemas);
        await dumper.runDump('mysqldump', dumpArgs);
        await dumper.end();
        
        // Info

        await myt.dbConnect();
        const version = await myt.fetchDbVersion();
        await fs.writeFile(
            path.join(dumpDir, 'version.json'),
            JSON.stringify(version, null, 1)
        );
    }
}

module.exports = Dump;

if (require.main === module)
    new Myt().cli(Dump);
