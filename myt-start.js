
const Myt = require('./myt');
const Command = require('./lib/command');
const Container = require('./lib/docker').Container;
const Server = require('./lib/server');
const Run = require('./myt-run');

/**
 * Does the minium effort to start the database container, if it doesn't
 * exists calls the run command, if it is started does nothing. Keep in 
 * mind that when you do not rebuild the docker you may be using an outdated 
 * version of it.
 */
class Start extends Command {
    static usage =  {
        description: 'Start local database server container'
    };

    async run(myt, opts) {
        const ct = new Container(opts.code);
        let status;
        let exists;
        let server;

        try {
            status = await ct.inspect({
                format: '{{json .State.Status}}'
            });
            exists = true;
        } catch (err) {
            server = await myt.runCommand(Run, opts);
        }

        if (exists) {
            switch (status) {
            case 'running':
                break;
            case 'exited':
                await ct.start();
                server = new Server(ct, opts.dbConfig);
                await server.wait();
                break;
            default:
                throw new Error(`Unknown docker status: ${status}`);
            }
        }

        return server;
    }
}

module.exports = Start;

if (require.main === module)
    new Myt().run(Start);
