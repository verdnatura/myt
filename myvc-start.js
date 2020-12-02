
const MyVC = require('./index');
const docker = require('./docker');
const Server = require('./server/server');

/**
 * Does the minium effort to start the database container, if it doesn't
 * exists calls the run command, if it is started does nothing. Keep in 
 * mind that when you do not rebuild the docker you may be using an outdated 
 * version of it.
 */
class Start {
    async run(myvc, opts) {
        const server = new Server(opts.code, opts.workspace);
        await server.start();

        let status;
        try {
            status = await docker.inspect(opts.code, {
                filter: '{{json .State.Status}}'
            });
        } catch (err) {
            return await this.run();
        }

        switch (status) {
        case 'running':
            return;
        case 'exited':
            await docker.start(opts.code);
            await this.wait();
            return;
        default:
            throw new Error(`Unknown docker status: ${status}`);
        }
    }
}

module.exports = Start;

if (require.main === module)
    new MyVC().run(Start);
