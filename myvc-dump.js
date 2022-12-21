
const MyVC = require('./myvc');
const Command = require('./lib/command');
const fs = require('fs-extra');
const path = require('path');

class Dump extends Command {
    static usage = {
        description: 'Dumps structure and fixtures from remote',
        operand: 'remote'
    };

    static localOpts = {
        default: {
            remote: 'production'
        }
    };

    async run(myvc, opts) {
        const dumpStream = await myvc.initDump('.dump.sql');

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
        await myvc.runDump('docker-dump.sh', dumpArgs, dumpStream);

        console.log('Dumping fixtures.');
        await myvc.dumpFixtures(dumpStream, opts.fixtures);

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
            
            await dumpStream.write('USE `mysql`;\n', 'utf8');
            await myvc.runDump('mysqldump', args, dumpStream);
        }

        await dumpStream.end();

        console.log('Saving version.');
        await myvc.dbConnect();
        const version = await myvc.fetchDbVersion();
        if (version) {
            await fs.writeFile(
                `${opts.dumpDir}/.dump.json`,
                JSON.stringify(version)
            );
        }
    }
}

module.exports = Dump;

if (require.main === module)
    new MyVC().run(Dump);

