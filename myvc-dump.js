
const MyVC = require('./index');
const fs = require('fs-extra');
const path = require('path');
const docker = require('./docker');

class Dump {
    get myOpts() {
        return {
            alias: {
                env: 'e'
            },
            default: {
                env: 'production'
            }
        };
    }

    async run(myvc, opts) {
        const conn = await myvc.dbConnect();

        const dumpDir = `${opts.workspace}/dump`;
        if (!await fs.pathExists(dumpDir))
            await fs.mkdir(dumpDir);

        const dumpFile = `${dumpDir}/.dump.sql`;
        const dumpStream = await fs.createWriteStream(dumpFile);
        const execOptions = {
            stdio: [
                process.stdin,
                dumpStream,
                process.stderr
            ] 
        };

        await docker.build(__dirname, {
            tag: 'myvc/client',
            file: path.join(__dirname, 'Dockerfile.client')
        }, !!this.opts.debug);

        let dumpArgs = [
            `--defaults-file=${opts.iniFile}`,
            '--default-character-set=utf8',
            '--no-data',
            '--comments',
            '--triggers',
            '--routines',
            '--events',
            '--databases'
        ];
        dumpArgs = dumpArgs.concat(opts.schemas);
        await this.dockerRun('myvc-dump.sh', dumpArgs, execOptions);

        const fixturesArgs = [
            `--defaults-file=${opts.iniFile}`,
            '--no-create-info',
            '--skip-triggers',
            '--insert-ignore'
        ];
        for (const schema in opts.fixtures) {
            await dumpStream.write(
                `USE ${conn.escapeId(schema, true)};\n`,
                'utf8'
            );

            const args = fixturesArgs.concat([schema], opts.fixtures[schema]);
            await this.dockerRun('mysqldump', args, execOptions);
        }

        await dumpStream.end();

        const version = await myvc.fetchDbVersion();
        if (version){
            await fs.writeFile(
                `${dumpDir}/.dump.json`,
                JSON.stringify(version)
            );
        }
    }
    
    async dockerRun(command, args, execOptions) {
        const commandArgs = [command].concat(args);
        await docker.run('myvc/client', commandArgs, {
            volume: `${this.opts.workspace}:/workspace`
        }, execOptions);
    }
}

module.exports = Dump;

if (require.main === module)
    new MyVC().run(Dump);

