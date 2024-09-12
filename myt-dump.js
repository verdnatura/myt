const Myt = require('./myt');
const Command = require('./lib/command');
const Dumper = require('./lib/dumper');
const fs = require('fs-extra');
const path = require('path');

class Dump extends Command {
    static usage = {
        description: 'Dumps structure and fixtures from remote',
        params: {
            lock: 'Whether to lock tables on dump',
            triggers: 'Whether to include triggers into dump'
        },
        operand: 'remote'
    };

    static opts = {
        default: {
            remote: 'production'
        },
        alias: {
            lock: 'l',
            triggers: 't'
        },
        boolean: [
            'lock',
            'triggers'
        ]
    };

    static reporter = {
        dumpStructure: 'Dumping structure.',
        dumpData: 'Dumping data.',
        dumpPrivileges: 'Dumping privileges.',
        dumpTriggers: 'Dumping triggers.'
    };

    async run(myt, opts) {
        let dumper;
        const dumpDataDir = path.join(opts.dumpDir, '.dump');
        const baseArgs = [
            `--lock-tables=${opts.lock ? 'true' : 'false'}`
        ];

        await fs.remove(dumpDataDir);

        // Structure

        this.emit('dumpStructure');

        dumper = new Dumper(opts);
        await dumper.init(dumpDataDir, 'structure');
        let dumpArgs = [
            '--default-character-set=utf8',
            '--no-data',
            '--comments',
            '--routines',
            '--events',
            '--skip-triggers'
        ].concat(baseArgs);

        dumpArgs.push('--databases');
        dumpArgs = dumpArgs.concat(opts.schemas);
        await dumper.runDump('docker-dump.sh', dumpArgs);
        await dumper.end();

        // Data

        this.emit('dumpData');

        dumper = new Dumper(opts);
        await dumper.init(dumpDataDir, 'data');
        await dumper.dumpFixtures(opts.fixtures, false, baseArgs);
        await dumper.end();

        // Privileges

        const privs = opts.privileges;
        if (privs) {
            this.emit('dumpPrivileges');

            dumper = new Dumper(opts);
            await dumper.init(dumpDataDir, 'privileges');

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

        if (opts.triggers) {
            this.emit('dumpTriggers');

            const dumper = new Dumper(opts);
            await dumper.init(dumpDataDir, 'triggers');

            let dumpArgs = [
                '--default-character-set=utf8',
                '--no-create-info',
                '--no-data',
                '--no-create-db',
                '--skip-opt',
                '--comments'
            ].concat(baseArgs);

            dumpArgs.push('--databases');
            dumpArgs = dumpArgs.concat(opts.schemas);
            await dumper.runDump('mysqldump', dumpArgs);
            await dumper.end();
        }
    }
}

module.exports = Dump;

if (require.main === module)
    new Myt().cli(Dump);
