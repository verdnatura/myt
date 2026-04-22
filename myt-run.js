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
            network: 'Docker network to attach container to',
            random: 'Whether to use a random container name and port',
            persist: 'Whether to not use tmpfs mount for MySQL data',
            keep: 'Keep container on failure',
            realm: 'Name of fixture realm to use',
            ip: 'Bind to container IP instead of localhost',
            build: 'Whether to skip image build',
            name: 'Built image name',
            tag: 'Built image tag',
            force: 'Whether to force build'
        },
        operand: 'realm'
    };

    static args = {
        alias: {
            network: 'e',
            random: 'r',
            persist: 'p',
            keep: 'k',
            ip: 'i',
            build: 'b',
            name: 'n',
            tag: 't',
            force: 'f',
            realm: 'm'
        },
        string: [
            'network',
            'name',
            'tag',
            'realm'
        ],
        boolean: [
            'random',
            'persist',
            'keep',
            'ip',
            'build',
            'force'
        ]
    };

    static reporter = {
        buildingImage: 'Building container image.',
        runningContainer: 'Running container.',
        waitingDb: function(dbConfig) {
            console.log(`Waiting for database: ${dbConfig.host}:${dbConfig.port}`);
        }
    };

    async _run(myt, ctx, cfg, opts) {
        let tag;

        if (!opts.build) {
            tag = await myt.run(Build, {
                name: opts.name,
                tag: opts.tag,
                force: opts.force,
                realm: opts.realm
            });
        } else {
            tag = opts.name || cfg.code;
            if (opts.tag) tag += `:${opts.tag}`;
        }

        this.emit('runningContainer');

        const isRandom = opts.random;
        const dbConfig = ctx.dbConfig;

        const runOptions = {};

        if (isRandom)
            Object.assign(runOptions, {publish: '3306'});
        else {
            Object.assign(runOptions, {
                name: cfg.code,
                publish: `3306:${dbConfig.port}`
            });
            try {
                const server = new Server(new docker.Container(cfg.code));
                await server.rm();
            } catch (e) {}
        }

        const {network} = opts;
        if (opts.network)
            runOptions.network = network;

        if (!opts.persist)
            runOptions.tmpfs = '/var/lib/mysql';

        Object.assign(runOptions, {
            detach: true
        });

        const ct = await docker.run(tag, null, runOptions, undefined, cfg.debug);

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