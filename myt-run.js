const Myt = require('./myt');
const Command = require('./lib/command');
const docker = require('./lib/docker');
const Server = require('./lib/server');
const Build = require('./myt-build');

/**
 * Builds the database image and runs a container. It only rebuilds the image
 * when dump have been modified. Some workarounds have been used to avoid a bug
 * with OverlayFS driver on MacOS.
 */
class Run extends Command {
    static usage = {
        description: 'Build and start local database server container',
        params: {
            ci: 'Workaround for continuous integration system',
            network: 'Docker network to attach container to',
            random: 'Whether to use a random container name and port',
            persist: 'Whether to not use tmpfs mount for MySQL data',
            keep: 'Keep container on failure',
            realm: 'Name of fixture realm to use',
            ip: 'Bind to container IP instead of localhost',
            push: 'Push changes before start database service'
        },
        operand: 'realm'
    };

    static opts = {
        alias: {
            network: 'n',
            random: 'r',
            persist: 'p',
            keep: 'k',
            realm: 'm',
            ip: 'i',
            push: 'u'
        },
        boolean: [
            'ci',
            'random',
            'persist',
            'keep',
            'ip',
            'push'
        ]
    };

    static reporter = {
        buildingImage: 'Building container image.',
        runningContainer: 'Running container.',
        mockingDate: 'Mocking date functions.',
        applyingFixtures: 'Applying fixtures.',
        applyingRealms: 'Applying realm fixtures.',
        creatingTriggers: 'Creating triggers.',
        waitingDb: function(dbConfig) {
            console.log(`Waiting for database: ${dbConfig.host}:${dbConfig.port}`);
        }
    };

    async run(myt, opts) {
        const tag = await myt.run(Build, opts);

        this.emit('runningContainer');

        const isRandom = opts.random;
        const dbConfig = opts.dbConfig;

        const runOptions = {};

        if (isRandom)
            Object.assign(runOptions, {publish: '3306'});
        else {
            Object.assign(runOptions, {
                name: opts.code,
                publish: `3306:${dbConfig.port}`
            });
            try {
                const server = new Server(new docker.Container(opts.code));
                await server.rm();
            } catch (e) {}
        }

        const {network} = opts;
        if (opts.network)
            runOptions.network = network;

        if (!opts.persist)
            runOptions.tmpfs = '/var/lib/mysql';

        if (opts.push)
            Object.assign(runOptions, {
                volume: `${opts.workspace}:/workspace`,
                env: `MYT_PUSH=true`
            });

        Object.assign(runOptions, {
            detach: true
        });

        const ct = await docker.run(tag, null, runOptions, opts.debug);

        try {
            const server = new Server(ct, dbConfig);

            try {
                const netSettings = await ct.inspect({
                    format: '{{json .NetworkSettings}}'
                });
                const ctNetworks = netSettings.Networks;

                let host;
                let port;
                let localhost = '127.0.0.1';
                if (opts.ip) {
                    if (network) {
                        host = network != 'host'
                            ? ctNetworks[network].IPAddress
                            : localhost;
                    } else {
                        host = netSettings.IPAddress
                            ?? ctNetworks.bridge?.IPAddress;
                    }
                    port = 3306;
                } else {
                    host = localhost;
                    port = netSettings.Ports['3306/tcp'][0].HostPort;
                }

                if (!host)
                    throw new Error(`Cannot get database host`);

                Object.assign(dbConfig, {host, port});
            } catch (err) {
                await server.rm();
                throw err;
            }

            this.emit('waitingDb', dbConfig);
            await server.wait();
            return server;
        } catch (err) {
            try {
                if (!opts.keep) await ct.rm({force: true});
            } catch (e) {}
            throw err;
        }
    }
}

module.exports = Run;

if (require.main === module)
    new Myt().cli(Run);