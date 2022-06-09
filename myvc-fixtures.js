
const MyVC = require('./myvc');
const fs = require('fs-extra');
const path = require('path');
const docker = require('./docker');

class Fixtures {
    get usage() {
        return {
            description: 'Dumps local fixtures from database',
            operand: 'remote'
        };
    }

    get localOpts() {
        return {
            default: {
                remote: 'local'
            }
        };
    }

    async run(myvc, opts) {
        const iniPath = path.join(opts.subdir || '', 'remotes', opts.iniFile);

        const dumpDir = `${opts.myvcDir}/dump`;
        if (!await fs.pathExists(dumpDir))
            await fs.mkdir(dumpDir);

        const dumpFile = `${dumpDir}/fixtures.sql`;
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

        const fixturesArgs = [
            `--defaults-file=${iniPath}`,
            '--no-create-info',
            '--skip-triggers',
            '--insert-ignore'
        ];
        for (const schema in opts.localFixtures) {
            const escapedSchema = '`'+ schema.replace('`', '``') +'`';
            await dumpStream.write(
                `USE ${escapedSchema};\n`,
                'utf8'
            );

            const args = fixturesArgs.concat([schema], opts.localFixtures[schema]);
            await this.dockerRun('mysqldump', args, execOptions);
        }

        await dumpStream.end();
    }
    
    async dockerRun(command, args, execOptions) {
        const commandArgs = [command].concat(args);
        await docker.run('myvc/client', commandArgs, {
            addHost: 'host.docker.internal:host-gateway',
            volume: `${this.opts.myvcDir}:/workspace`,
            rm: true
        }, execOptions);
    }
}

module.exports = Fixtures;

if (require.main === module)
    new MyVC().run(Fixtures);

