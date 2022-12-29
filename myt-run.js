const Myt = require('./myt');
const Command = require('./lib/command');
const Push = require('./myt-push');
const docker = require('./lib/docker');
const fs = require('fs-extra');
const path = require('path');
const Server = require('./lib/server');
const connExt = require('./lib/conn');

/**
 * Builds the database image and runs a container. It only rebuilds the
 * image when fixtures have been modified or when the day on which the
 * image was built is different to today. Some workarounds have been used
 * to avoid a bug with OverlayFS driver on MacOS.
 */
class Run extends Command {
    static usage = {
        description: 'Build and start local database server container',
        params: {
            ci: 'Workaround for continuous integration system',
            random: 'Whether to use a random container name or port'
        }
    };

    static opts = {
        alias: {
            ci: 'c',
            random: 'r'
        },
        boolean: [
            'ci',
            'random'
        ]
    };

    async run(myt, opts) {
        const dumpDir = opts.dumpDir;
        const serverDir = path.join(__dirname, 'server');

        if (!await fs.pathExists(`${dumpDir}/.dump.sql`))
            throw new Error('To run local database you have to create a dump first');

        // Build base image

        let serverDockerfile = path.join(dumpDir, 'Dockerfile');
        if (!await fs.pathExists(serverDockerfile))
            serverDockerfile = path.join(serverDir, 'Dockerfile.base');

        await docker.build(__dirname, {
            tag: 'myt/base',
            file: serverDockerfile
        }, opts.debug);

        // Build server image

        await docker.build(__dirname, {
            tag: 'myt/server',
            file: path.join(serverDir, 'Dockerfile.server')
        }, opts.debug);

        // Build dump image

        await docker.build(opts.mytDir, {
            tag: opts.code,
            file: path.join(serverDir, 'Dockerfile.dump')
        }, opts.debug);

        // Run container

        const isRandom = opts.random;
        const dbConfig = Object.assign({}, opts.dbConfig);

        let runOptions;

        if (isRandom)
            runOptions = {publish: '3306'};
        else {
            runOptions = {
                name: opts.code,
                publish: `3306:${dbConfig.port}`
            };
            try {
                const server = new Server(new docker.Container(opts.code));
                await server.rm();
            } catch (e) {}
        }

        const runChown = process.platform != 'linux';

        Object.assign(runOptions, null, {
            env: `RUN_CHOWN=${runChown}`,
            detach: true,
            volume: `${this.opts.mytDir}:/workspace`
        });
        const ct = await docker.run(opts.code, null, runOptions);
        const server = new Server(ct, dbConfig);

        if (isRandom) {
            try {
                const netSettings = await ct.inspect({
                    format: '{{json .NetworkSettings}}'
                });

                if (opts.ci)
                    dbConfig.host = netSettings.Gateway;

                dbConfig.port = netSettings.Ports['3306/tcp'][0].HostPort;
            } catch (err) {
                await server.rm();
                throw err;
            }
        }

        await server.wait();

        // Apply changes

        Object.assign(opts, {
            commit: true,
            trigger: true,
            dbConfig
        });
        await myt.runCommand(Push, opts);

        // Apply fixtures

        console.log('Applying fixtures.');
        await ct.exec(null,
            'docker-import.sh',
            ['/workspace/dump/fixtures'],
            'spawn',
            opts.debug
        );

        // Create triggers

        console.log('Creating triggers.');
        const conn = await myt.createConnection();

        for (const schema of opts.schemas) {
            const triggersPath = `${opts.routinesDir}/${schema}/triggers`;
            if (!await fs.pathExists(triggersPath))
                continue;

            const triggersDir = await fs.readdir(triggersPath);
            for (const triggerFile of triggersDir)
                await connExt.queryFromFile(conn, `${triggersPath}/${triggerFile}`);
        }

        return server;
    }
}

module.exports = Run;

if (require.main === module)
    new Myt().run(Run);