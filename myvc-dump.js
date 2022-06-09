
const MyVC = require('./myvc');
const fs = require('fs-extra');
const path = require('path');
const docker = require('./docker');

class Dump {
    get usage() {
        return {
            description: 'Dumps structure and fixtures from remote',
            operand: 'remote'
        };
    }

    get localOpts() {
        return {
            default: {
                remote: 'production'
            }
        };
    }

    async run(myvc, opts) {
        const iniPath = path.join(opts.subdir || '', 'remotes', opts.iniFile);

        const dumpDir = `${opts.myvcDir}/dump`;
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
            file: path.join(__dirname, 'server', 'Dockerfile.client')
        }, opts.debug);

        let dumpArgs = [
            `--defaults-file=${iniPath}`,
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
            `--defaults-file=${iniPath}`,
            '--no-create-info',
            '--skip-triggers',
            '--insert-ignore'
        ];
        for (const schema in opts.fixtures) {
            const escapedSchema = '`'+ schema.replace('`', '``') +'`';
            await dumpStream.write(
                `USE ${escapedSchema};\n`,
                'utf8'
            );

            const args = fixturesArgs.concat([schema], opts.fixtures[schema]);
            await this.dockerRun('mysqldump', args, execOptions);
        }

        await dumpStream.end();

        const version = await myvc.fetchDbVersion();
        if (version) {
            await fs.writeFile(
                `${dumpDir}/.dump.json`,
                JSON.stringify(version)
            );
        }
    }
    
    async dockerRun(command, args, execOptions) {
        const commandArgs = [command].concat(args);
        await docker.run('myvc/client', commandArgs, {
            volume: `${this.opts.myvcDir}:/workspace`,
            rm: true
        }, execOptions);
    }
}

module.exports = Dump;

if (require.main === module)
    new MyVC().run(Dump);

