
const MyVC = require('./myvc');
const Command = require('./lib/command');

class Fixtures extends Command {
    static usage = {
        description: 'Dumps local fixtures from database',
        operand: 'remote'
    };

    static localOpts = {
        default: {
            remote: 'docker'
        }
    };

    async run(myvc, opts) {
        const dumpStream = await myvc.initDump('fixtures.sql');
        await myvc.dumpFixtures(dumpStream, opts.localFixtures, true);
        await dumpStream.end();
    }
}

module.exports = Fixtures;

if (require.main === module)
    new MyVC().run(Fixtures);

