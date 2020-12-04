
const MyVC = require('./myvc');
const Container = require('./docker').Container;
const Server = require('./server/server');
const Run = require('./myvc-run');

/**
 * Does the minium effort to start the database container, if it doesn't
 * exists calls the run command, if it is started does nothing. Keep in 
 * mind that when you do not rebuild the docker you may be using an outdated 
 * version of it.
 */
class Start {
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
