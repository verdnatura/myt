
const MyVC = require('./myvc');
const Command = require('./lib/command');
const Container = require('./lib/docker').Container;
const Server = require('./lib/server');
const Run = require('./myvc-run');

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

    async run(myvc, opts) {
        const ct = new Container(opts.code);
        let status;

        try {
            status = await ct.inspect({
                format: '{{json .State.Status}}'
            });
        } catch (err) {
            const run = new Run()
            return await run.run(myvc, opts);
        }

        switch (status) {
        case 'running':
            break;
        case 'exited':
            await ct.start();
            break;
        default:
            throw new Error(`Unknown docker status: ${status}`);
        }

        const server = new Server(ct, opts.dbConfig);
        await server.wait();
        return server;
    }
}

module.exports = Start;

if (require.main === module)
    new MyVC().run(Start);
