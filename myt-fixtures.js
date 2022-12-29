const Myt = require('./myt');
const Command = require('./lib/command');
const Dumper = require('./lib/dumper');

class Fixtures extends Command {
    static usage = {
        description: 'Dumps local fixtures from database',
        operand: 'remote'
    };

    static opts = {
        default: {
            remote: 'docker'
        }
    };

    async run(myt, opts) {
        const dumper = new Dumper(opts);
        await dumper.init('fixtures.sql');
        await dumper.dumpFixtures(opts.localFixtures, true);
        await dumper.end();
    }
}

module.exports = Fixtures;

if (require.main === module)
    new Myt().run(Fixtures);

