const docker = require('./docker');
const fs = require('fs-extra');
const path = require('path');
const SqlString = require('sqlstring');

module.exports = class Dumper {
    constructor(opts) {
        this.opts = opts;
    }

    async init(dumpDir, dumpFile) {
        if (!await fs.pathExists(dumpDir))
            await fs.mkdir(dumpDir, {recursive: true});

        const dumpPath = path.join(dumpDir, `${dumpFile}.sql`);

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

    async end() {
        await this.dumpStream.end();
    }

    async use(schema) {
        await this.dumpStream.write(
            `USE ${SqlString.escapeId(schema, true)};\n`,
            'utf8'
        );
    }

    async dumpFixtures(tables, replace, args) {
        let fixturesArgs = [
            '--no-create-info',
            '--skip-triggers',
            '--skip-extended-insert',
            '--skip-disable-keys',
            '--skip-add-locks',
            '--skip-set-charset',
            '--skip-comments',
            '--skip-tz-utc'
        ]
        if (args)
            fixturesArgs = fixturesArgs.concat(args);
        if (replace)
            fixturesArgs.push('--replace');

        for (const schema in tables) {
            const args = fixturesArgs.concat([schema], tables[schema]);
            await this.use(schema);
            await this.runDump('mysqldump', args);
        }
    }

    async dumpPrivileges(tables, args, where) {
        let privArgs = [
            '--no-create-info',
            '--skip-triggers',
            '--insert-ignore',
            '--skip-extended-insert',
            '--skip-add-locks',
            '--skip-set-charset',
            '--skip-comments',
            '--skip-tz-utc'
        ];
        if (args)
            privArgs = privArgs.concat(args);
        if (where)
            privArgs.push('--where', where);
        args = privArgs.concat(['mysql'], tables);

        await this.use('mysql');
        await this.runDump('mysqldump', args);
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
}
