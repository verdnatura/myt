
const Myt = require('./myt');
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

    async run(myt, opts) {
        const dumpStream = await myt.initDump('fixtures.sql');
        await myt.dumpFixtures(dumpStream, opts.localFixtures, true);
        await dumpStream.end();
    }
}

module.exports = Fixtures;

if (require.main === module)
    new Myt().run(Fixtures);

