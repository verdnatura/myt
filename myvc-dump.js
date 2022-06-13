
const MyVC = require('./myvc');
const fs = require('fs-extra');
const path = require('path');

class Dump {
    get usage() {
        return {
            description: 'Dumps structure and fixtures from remote',
            operand: 'remote'
        };
    }

    get localOpts() {
        return {
            default: {
                remote: 'production'
            }
        };
    }

    async run(myvc, opts) {
        const dumpStream = await myvc.initDump('.dump.sql');

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
        await myvc.runDump('myvc-dump.sh', dumpArgs, dumpStream);

        await myvc.dumpFixtures(dumpStream, opts.fixtures);
        await dumpStream.end();

        await myvc.dbConnect();
        const version = await myvc.fetchDbVersion();
        if (version) {
            const dumpDir = path.join(opts.myvcDir, 'dump');
            await fs.writeFile(
                `${dumpDir}/.dump.json`,
                JSON.stringify(version)
            );
        }
    }
}

module.exports = Dump;

if (require.main === module)
    new MyVC().run(Dump);

