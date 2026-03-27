const Myt = require('./myt');
const Command = require('./lib/command');
const docker = require('./lib/docker');
const fs = require('fs-extra');
const path = require('path');

class Run extends Command {
    static usage = {
        description: 'Build local database server container',
    };

    static opts = {
        alias: {
            tag: 't',
        },
        string: [
            'tag'
        ]
    };

    static reporter = {
        buildingImage: 'Building container image.'
    };

    async run(myt, opts) {
        const dumpDir = opts.dumpDir;
        const dumpDataDir = path.join(dumpDir, '.dump');
        const serverDir = path.join(__dirname, 'docker/server');

        if (!await fs.pathExists(`${dumpDataDir}/structure.sql`))
            throw new Error('To run local database you have to create a dump first');

        this.emit('buildingImage');

        // Build base image

        const buildArgs = [
            `ROOT_PASS=${opts.rootPassword}`
        ];
        const baseDockerfile = path.join(dumpDir, 'Dockerfile');

        if (await fs.pathExists(baseDockerfile)) {
            await docker.build(dumpDir, {
                tag: 'myt/base',
                file: baseDockerfile
            }, opts.debug);
            buildArgs.push(
                `BASE_IMAGE=myt/base`,
                `BASE_TAG=latest`
            );
        } else {
            if (opts.baseImage)
                buildArgs.push(`BASE_IMAGE=${opts.baseImage}`);
            if (opts.baseImageTag)
                buildArgs.push(`BASE_TAG=${opts.baseImageTag}`);
        }

        // Build server image

        await docker.build(__dirname, {
            tag: 'myt/server',
            file: path.join(serverDir, 'Dockerfile'),
            buildArg: buildArgs
        }, opts.debug);

        // Build dump image

        const subdir = opts.subdir ?? '.';
        await docker.build(opts.workspace, {
            tag: opts.tag || opts.code,
            file: path.join(serverDir, 'Dockerfile.dump'),
            buildArg: [
                `MYT_DIR=${subdir}`
            ]
        }, opts.debug);
    }
}

module.exports = Run;

if (require.main === module)
    new Myt().cli(Run);