
const execFile = require('child_process').execFile;
const log = require('fancy-log');
const path = require('path');

module.exports = class Docker {
    constructor(name, context) {
        Object.assign(this, {
            id: name,
            name,
            isRandom: name == null,
            dbConf: {
                host: 'localhost',
                port: '3306',
                username: 'root',
                password: 'root'
            },
            imageTag: name || 'myvc/dump',
            context
        });
    }

    /**
     * Builds the database image and runs a container. It only rebuilds the
     * image when fixtures have been modified or when the day on which the
     * image was built is different to today. Some workarounds have been used
     * to avoid a bug with OverlayFS driver on MacOS.
     *
     * @param {Boolean} ci continuous integration environment argument
     */
    async run(ci) {
        let dockerfilePath = path.join(__dirname, 'Dockerfile');
    
        await this.execFile('docker', [
            'build',
            '-t',  'myvc/server',
            '-f', `${dockerfilePath}.server`,
            __dirname
        ]);

        let d = new Date();
        let pad = v => v < 10 ? '0' + v : v;
        let stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

        await this.execFile('docker', [
            'build',
            '-t', this.imageTag,
            '-f', `${dockerfilePath}.dump`,
            '--build-arg', `STAMP=${stamp}`,
            this.context
        ]);

        let dockerArgs;

        if (this.isRandom)
            dockerArgs = ['-p', '3306'];
        else {
            try {
                await this.rm();
            } catch (e) {}
            dockerArgs = ['--name', this.name, '-p', `3306:${this.dbConf.port}`];
        }

        let runChown = process.platform != 'linux';
        const container = await this.execFile('docker', [
            'run',
            '--env', `RUN_CHOWN=${runChown}`,
            '-d',
            ...dockerArgs,
            this.imageTag
        ]);
        this.id = container.stdout.trim();

        try {
            if (this.isRandom) {
                let netSettings = await this.execJson('docker', [
                    'inspect', '-f', '{{json .NetworkSettings}}', this.id
                ]);

                if (ci)
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

    /**
     * Does the minium effort to start the database container, if it doesn't
     * exists calls the 'docker' task, if it is started does nothing. Keep in 
     * mind that when you do not rebuild the docker you may be using an outdated 
     * version of it. See the 'docker' task for more info.
     */
    async start() {
        let state;
        try {
            state = await this.execJson('docker', [
                'inspect', '-f', '{{json .State}}', this.id
            ]);
        } catch (err) {
            return await this.run();
        }

        switch (state.Status) {
        case 'running':
            return;
        case 'exited':
            await this.execFile('docker', ['start', this.id]);
            await this.wait();
            return;
        default:
            throw new Error(`Unknown docker status: ${state.Status}`);
        }
    }

    waitForHealthy() {
        return new Promise((resolve, reject) => {
            let interval = 100;
            let elapsedTime = 0;
            let maxInterval = 4 * 60 * 1000;

            log('Waiting for container to be ready...');

            async function checker() {
                elapsedTime += interval;
                let status;

                try {
                    let status = await this.execJson('docker', [
                        'inspect', '-f', '{{.State.Health.Status}}', this.id
                    ]);
                    status = status.trimEnd();
                } catch (err) {
                    return reject(new Error(err.message));
                }

                if (status == 'unhealthy')
                    return reject(new Error('Docker exited, please see the docker logs for more info'));

                if (status == 'healthy') {
                    log('Container ready.');
                    return resolve();
                }

                if (elapsedTime >= maxInterval)
                    reject(new Error(`Container initialized whithin ${elapsedTime / 1000} secs`));
                else
                    setTimeout(bindedChecker, interval);
            }
            let bindedChecker = checker.bind(this);
            bindedChecker();
        });
    }

    wait() {
        return new Promise((resolve, reject) => {
            const mysql = require('mysql2');

            let interval = 100;
            let elapsedTime = 0;
            let maxInterval = 4 * 60 * 1000;

            let myConf = {
                user: this.dbConf.username,
                password: this.dbConf.password,
                host: this.dbConf.host,
                port: this.dbConf.port
            };

            log('Waiting for MySQL init process...');

            async function checker() {
                elapsedTime += interval;
                let state;

                try {
                    state = await this.execJson('docker', [
                        'inspect', '-f', '{{json .State}}', this.id
                    ]);
                } catch (err) {
                    return reject(new Error(err.message));
                }

                if (state.Status === 'exited')
                    return reject(new Error('Docker exited, please see the docker logs for more info'));

                let conn = mysql.createConnection(myConf);
                conn.on('error', () => {});
                conn.connect(err => {
                    conn.destroy();
                    if (!err) {
                        log('MySQL process ready.');
                        return resolve();
                    }

                    if (elapsedTime >= maxInterval)
                        reject(new Error(`MySQL not initialized whithin ${elapsedTime / 1000} secs`));
                    else
                        setTimeout(bindedChecker, interval);
                });
            }
            let bindedChecker = checker.bind(this);
            bindedChecker();
        });
    }

    async rm() {
        try {
            await this.execFile('docker', ['stop', this.id]);
            await this.execFile('docker', ['rm', '-v', this.id]);
        } catch (e) {}
    }

    /**
     * Promisified version of execFile().
     *
     * @param {String} command The exec command
     * @param {Array} args The command arguments
     * @return {Promise} The promise
     */
    execFile(command, args) {
        return new Promise((resolve, reject) => {
            execFile(command, args, (err, stdout, stderr) => {
                if (err)
                    reject(err);
                else {
                    resolve({
                        stdout: stdout,
                        stderr: stderr
                    });
                }
            });
        });
    }

    /**
     * Executes a command whose return is json.
     *
     * @param {String} command The exec command
     * @param {Array} args The command arguments
     * @return {Object} The parsed JSON
     */
    async execJson(command, args) {
        const result = await this.execFile(command, args);
        return JSON.parse(result.stdout);
    }
};
