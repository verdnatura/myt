const Myt = require('./myt');
const Command = require('./lib/command');
const fs = require('fs-extra');
const Dumper = require('./lib/dumper');

class Dump extends Command {
    static usage = {
        description: 'Dumps structure and fixtures from remote',
        operand: 'remote'
    };

    static opts = {
        default: {
            remote: 'production'
        }
    };

    async run(myt, opts) {
        const dumper = new Dumper(opts);
        await dumper.init('.dump.sql');

        console.log('Dumping structure.');
        let dumpArgs = [
            '--default-character-set=utf8',
            '--no-data',
            '--comments',
            '--triggers',
            '--routines',
            '--events',
            '--databases'
        ];
        dumpArgs = dumpArgs.concat(opts.schemas);
        await dumper.runDump('docker-dump.sh', dumpArgs);

        console.log('Dumping fixtures.');
        await dumper.dumpFixtures(opts.fixtures);

        console.log('Dumping privileges.');
        const privs = opts.privileges;
        if (privs && Array.isArray(privs.tables)) {
            let args = [
                '--no-create-info',
                '--skip-triggers',
                '--insert-ignore',
                '--complete-insert'
            ];
            if (privs.where) args.push('--where', privs.where);
            args = args.concat(['mysql'], privs.tables);

            await dumper.use('mysql');
            await dumper.runDump('mysqldump', args);
        }

        await dumper.end();
    }
}

module.exports = Dump;

if (require.main === module)
    new Myt().run(Dump);

