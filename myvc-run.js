
const MyVC = require('./index');
const docker = require('./docker');
const fs = require('fs-extra');
const Server = require('./server/server');

/**
 * Builds the database image and runs a container. It only rebuilds the
 * image when fixtures have been modified or when the day on which the
 * image was built is different to today. Some workarounds have been used
 * to avoid a bug with OverlayFS driver on MacOS.
 *
 * @param {Boolean} ci continuous integration environment argument
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
        const server = new Server(opts.code, opts.workspace);
        await server.run();

        const dumpDir = `${opts.workspace}/dump`;
        const dumpInfo = `${dumpDir}/.dump.json`;

        if (await fs.pathExists(dumpInfo)) {
            const version = JSON.parse(
                await fs.readFileSync(dumpInfo, 'utf8')
            );

            const fd = await fs.open(`${dumpDir}/.changes`, 'w+');
            const changes = await myvc.changedRoutines(version.gitCommit);

            for (const change of changes)
                fs.write(fd, change.mark + change.path + '\n');

            await fs.close(fd);
        }

        const dockerfilePath = path.join(__dirname, 'server', 'Dockerfile');
    
        await docker.build(__dirname, {
            tag: 'myvc/server',
            file: `${dockerfilePath}.server`
        });

        const today = new Date();
        const pad = v => v < 10 ? '0' + v : v;
        const year = today.getFullYear();
        const month = pad(today.getMonth() + 1);
        const day = pad(today.getDate());
        const stamp = `${year}-${month}-${day}`;

        await docker.build(__dirname, {
            tag: this.imageTag,
            file: `${dockerfilePath}.dump`,
            buildArg: `STAMP=${stamp}`
        });

        let runOptions;

        if (this.isRandom)
            runOptions = {publish: '3306'};
        else {
            runOptions = {
                name: this.name,
                publish: `3306:${this.dbConf.port}`
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
        const ct = await docker.run(this.imageTag, null, runOptions);

        try {
            if (this.isRandom) {
                const netSettings = await ct.inspect({
                    filter: '{{json .NetworkSettings}}'
                });

                if (opts.ci)
                    this.dbConf.host = netSettings.Gateway;

                this.dbConf.port = netSettings.Ports['3306/tcp'][0]['HostPort'];
            }

            await this.wait();
        } catch (err) {
            if (this.isRandom)
                await this.rm();
            throw err;
        }
    }
}

module.exports = Run;

if (require.main === module)
    new MyVC().run(Run);
