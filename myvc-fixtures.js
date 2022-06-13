
const MyVC = require('./myvc');

class Fixtures {
    get usage() {
        return {
            description: 'Dumps local fixtures from database',
            operand: 'remote'
        };
    }

    get localOpts() {
        return {
            default: {
                remote: 'docker'
            }
        };
    }

    async run(myvc, opts) {
        const dumpStream = await myvc.initDump('fixtures.sql');
        await myvc.dumpFixtures(dumpStream, opts.localFixtures);
        await dumpStream.end();
    }
}

module.exports = Fixtures;

if (require.main === module)
    new MyVC().run(Fixtures);

