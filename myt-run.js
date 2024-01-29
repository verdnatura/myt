const Myt = require('./myt');
const Command = require('./lib/command');
const Push = require('./myt-push');
const docker = require('./lib/docker');
const fs = require('fs-extra');
const path = require('path');
const Server = require('./lib/server');
const connExt = require('./lib/conn');
const SqlString = require('sqlstring');

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
            tmpfs: 'Whether to use tmpfs mount for MySQL data'
        }
    };

    static opts = {
        alias: {
            ci: 'c',
            network: 'n',
            random: 'r',
            tmpfs: 'r'
        },
        boolean: [
            'ci',
            'random'
        ]
    };

    static reporter = {
        buildingImage: 'Building container image.',
        runningContainer: 'Running container.',
        waitingDb: 'Waiting for MySQL init process.',
        mockingDate: 'Mocking date functions.',
        applyingFixtures: 'Applying fixtures.',
        creatingTriggers: 'Creating triggers.'
    };

    async run(myt, opts) {
        const dumpDir = opts.dumpDir;
        const dumpDataDir = path.join(dumpDir, '.dump');
        const serverDir = path.join(__dirname, 'server');

        if (!await fs.pathExists(`${dumpDataDir}/structure.sql`))
            throw new Error('To run local database you have to create a dump first');

        // Build base image

        this.emit('buildingImage');

        let basePath = dumpDir;
        let baseDockerfile = path.join(dumpDir, 'Dockerfile');

        if (!await fs.pathExists(baseDockerfile)) {
            basePath = serverDir;
            baseDockerfile = path.join(serverDir, 'Dockerfile.base');
        }

        await docker.build(basePath, {
            tag: 'myt/base',
            file: baseDockerfile
        }, opts.debug);

        // Build server image

        await docker.build(serverDir, {
            tag: 'myt/server',
            file: path.join(serverDir, 'Dockerfile.server')
        }, opts.debug);

        // Build dump image

        const dumpContext = path.join(opts.mytDir, 'dump');
        await docker.build(dumpContext, {
            tag: opts.code,
            file: path.join(serverDir, 'Dockerfile.dump')
        }, opts.debug);

        // Run container

        this.emit('runningContainer');

        const isRandom = opts.random;
        const dbConfig = opts.dbConfig;

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

        if (opts.network)
            runOptions.network = opts.network;
        if (opts.tmpfs)
            runOptions.tmpfs = '/var/lib/mysql';

        Object.assign(runOptions, null, {
            detach: true
        });
        const ct = await docker.run(opts.code, null, runOptions);
        const server = new Server(ct, dbConfig);

        if (isRandom) {
            try {
                const netSettings = await ct.inspect({
                    format: '{{json .NetworkSettings}}'
                });

                if (opts.ci) {
                    dbConfig.host = opts.network
                        ? netSettings.Networks[opts.network].IPAddress
                        : netSettings.Gateway;
                    dbConfig.port = 3306;
                } else
                    dbConfig.port = netSettings.Ports['3306/tcp'][0].HostPort;
            } catch (err) {
                await server.rm();
                throw err;
            }
        }

        this.emit('waitingDb');
        await server.wait();
        const conn = await myt.createConnection();

        // Mock date functions

        this.emit('mockingDate');
        const mockDateScript = path.join(dumpDir, 'mockDate.sql');

        if (opts.mockDate) {
            if (!await fs.pathExists(mockDateScript))
                throw new Error(`Date mock enabled but mock script does not exist: ${mockDateScript}`);

            let sql = await fs.readFile(mockDateScript, 'utf8');
            sql = sql.replace(/@mockDate/g, SqlString.escape(opts.mockDate));
            await connExt.multiQuery(conn, sql);
        }

        // Apply changes

        const hasTriggers = await fs.exists(`${dumpDataDir}/triggers.sql`);

        Object.assign(opts, {
            triggers: !hasTriggers,
            commit: true,
            dbConfig
        });
        await myt.run(Push, opts);

        // Apply fixtures

        this.emit('applyingFixtures');
        const fixturesFiles = [
            'fixtures.before',
            '.fixtures',
            'fixtures.after',
            'fixtures.local'
        ]
        for (const file of fixturesFiles) {
            if (!await fs.exists(`${dumpDir}/${file}.sql`)) continue;
            await ct.exec(null, 'docker-import.sh',
                [`/workspace/dump/${file}`],
                'spawn',
                true
            );
        }

        // Create triggers

        if (!hasTriggers) {
            this.emit('creatingTriggers');

            for (const schema of opts.schemas) {
                const triggersPath = `${opts.routinesDir}/${schema}/triggers`;
                if (!await fs.pathExists(triggersPath))
                    continue;

                const triggersDir = await fs.readdir(triggersPath);
                for (const triggerFile of triggersDir)
                    await connExt.queryFromFile(conn, `${triggersPath}/${triggerFile}`);
            }
        }

        await conn.end();
        return server;
    }
}

module.exports = Run;

if (require.main === module)
    new Myt().cli(Run);
