const docker = require('./docker');
const fs = require('fs-extra');
const path = require('path');

module.exports = class Dumper {
    constructor(opts) {
        this.opts = opts;
    }

    async init(dumpFile) {
        const dumpDir = this.opts.dumpDir;
        if (!await fs.pathExists(dumpDir))
            await fs.mkdir(dumpDir);

        const dumpPath = path.join(dumpDir, dumpFile);

        // FIXME: If it's called after docker.build() statement it creates an 
        // "invalid" WriteStream
        const dumpStream = await fs.createWriteStream(dumpPath);

        const buidDir = path.join(__dirname, '..',)
        await docker.build(buidDir, {
            tag: 'myt/client',
            file: path.join(buidDir, 'server', 'Dockerfile.client')
        }, this.opts.debug);

        this.dumpStream = dumpStream;
    }

    async use(schema) {
        const escapedSchema = '`'+ schema.replace('`', '``') +'`';
        await this.dumpStream.write(
            `USE ${escapedSchema};\n`,
            'utf8'
        );
    }

    async dumpFixtures(tables, replace) {
        const fixturesArgs = [
            '--no-create-info',
            '--skip-triggers',
            '--skip-extended-insert',
            '--skip-disable-keys',
            '--skip-add-locks',
            '--skip-set-charset',
            '--skip-comments',
            '--skip-tz-utc'
        ];

        if (replace)
            fixturesArgs.push('--replace');

        for (const schema in tables) {
            await this.use(schema);
            const args = fixturesArgs.concat([schema], tables[schema]);
            await this.runDump('mysqldump', args, this.dumpStream);
        }
    }

    async runDump(command, args) {
        const iniPath = path.join(this.opts.subdir || '', 'remotes', this.opts.iniFile);
        const myArgs = [
            `--defaults-file=${iniPath}`
        ];
        const execOptions = {
            stdio: [
                process.stdin,
                this.dumpStream,
                process.stderr
            ] 
        };
        const commandArgs = [command].concat(myArgs, args);
        await docker.run('myt/client', commandArgs, {
            addHost: 'host.docker.internal:host-gateway',
            volume: `${this.opts.mytDir}:/workspace`,
            rm: true
        }, execOptions);
    }

    async end() {
        await this.dumpStream.end();
    }
}
