const Myt = require('./myt');
const Command = require('./lib/command');
const Dumper = require('./lib/dumper');

class Fixtures extends Command {
    static usage = {
        description: 'Dumps local fixtures from database',
        operand: 'remote'
    };

    static args = {
        default: {
            remote: 'local'
        }
    };

    async _run(myt, ctx, cfg, opts) {
        const dumper = new Dumper(myt);
        await dumper.init(ctx.fixturesDir, '.dump');
        await dumper.dumpFixtures(cfg.localFixtures, false);
        await dumper.end();
    }
}

module.exports = Fixtures;

if (require.main === module)
    new Myt().cli(Fixtures);
