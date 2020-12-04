
const MyVC = require('./index');
const docker = require('./docker');
const fs = require('fs-extra');
const path = require('path');
const Server = require('./server/server');

/**
 * Builds the database image and runs a container. It only rebuilds the
 * image when fixtures have been modified or when the day on which the
 * image was built is different to today. Some workarounds have been used
 * to avoid a bug with OverlayFS driver on MacOS.
 *
 * @property {Boolean} ci Continuous integration environment
 * @property {Boolean} random Whether to use a random container name
 */
class Run {
    get myOpts() {
        return {
            alias: {
                ci: 'c',
                random: 'r'
            }
        };
    }

    async run(myvc, opts) {
        const dumpDir = `${opts.workspace}/dump`;
        const dumpInfo = `${dumpDir}/.dump.json`;

        if (await fs.pathExists(dumpInfo)) {
            const cache = await myvc.cachedChanges();

            const version = JSON.parse(
                await fs.readFileSync(dumpInfo, 'utf8')
            );
            const changes = await myvc.changedRoutines(version.gitCommit);

            let isEqual = false;
            if (cache && changes && cache.length == changes.lenth)
                for (let i = 0; i < changes.length; i++) {
                    isEqual = cache[i].path == changes[i].path
                        && cache[i].mark == changes[i].mark;
                    if (!isEqual) break;
                }

            if (!isEqual) {
                const fd = await fs.open(`${dumpDir}/.changes`, 'w+');
                for (const change of changes)
                    fs.write(fd, change.mark + change.path + '\n');
                await fs.close(fd);
            }
        }

        const dockerfilePath = path.join(__dirname, 'server', 'Dockerfile');
    
        await docker.build(__dirname, {
            tag: 'myvc/server',
            file: dockerfilePath
        }, opts.debug);

        const today = new Date();
        const pad = v => v < 10 ? '0' + v : v;
        const year = today.getFullYear();
        const month = pad(today.getMonth() + 1);
        const day = pad(today.getDate());
        const stamp = `${year}-${month}-${day}`;

        await docker.build(opts.workspace, {
            tag: opts.code,
            file: `${dockerfilePath}.dump`,
            buildArg: `STAMP=${stamp}`
        }, opts.debug);

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
                await this.rm();
            } catch (e) {}
        }

        const runChown = process.platform != 'linux';

        Object.assign(runOptions, null, {
            env: `RUN_CHOWN=${runChown}`,
            detach: true
        });
        const ct = await docker.run(opts.code, null, runOptions);
        const server = new Server(ct, dbConfig);

        try {
            if (isRandom) {
                const netSettings = await ct.inspect({
                    format: '{{json .NetworkSettings}}'
                });

                if (opts.ci)
                    dbConfig.host = netSettings.Gateway;

                dbConfig.port = netSettings.Ports['3306/tcp'][0].HostPort;
            }
        } catch (err) {
            if (isRandom)
                await server.rm();
            throw err;
        }

        await server.wait();
        return server;
    }
}

module.exports = Run;

if (require.main === module)
    new MyVC().run(Run);
