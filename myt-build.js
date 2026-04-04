const Myt = require('./myt');
const Command = require('./lib/command');
const docker = require('./lib/docker');
const fs = require('fs-extra');
const path = require('path');
const {hashElement} = require('folder-hash');
const {createHash} = require('crypto');

class Build extends Command {
    static usage = {
        description: 'Build local database server container',
        params: {
            name: 'Built image name',
            tag: 'Built image tag',
            force: 'Whether to force build'
        },
    };

    static opts = {
        alias: {
            name: 'n',
            tag: 't',
            force: 'f',
        },
        string: [
            'name',
            'tag'
        ],
        boolean: [
            'force'
        ]
    };

    static reporter = {
        buildingServerImage: 'Building server image.',
        buildingDumpImage: 'Building dump image.',
        dumpImageBuilt: function(tag) {
            console.log(tag);
        }
    };

    async run(myt, opts) {
        const {dumpDir} = opts;
        const dumpDataDir = path.join(dumpDir, '.dump');
        const serverDir = path.join(__dirname, 'docker/server');

        if (!await fs.pathExists(`${dumpDataDir}/structure.sql`))
            throw new Error('Dump file not found');

        // Initialize

        const imageLabels = [];
        const tagHash = createHash('sha1');
        const repo = await myt.openRepo();

        const commit = await repo.getHeadCommit();
        const commitSha = commit.sha();
        tagHash.update(commitSha);
        imageLabels.push(`myt.commit-sha=${commitSha}`);

        // Get changed files hash

        const repoExt = require('./lib/repo');
        const regex = opts.subdir && new RegExp(`^${opts.subdir}\/(.+)`);
        const gitChanges = new Set();
        const dirnames = new Set();
        const {sep} = path;

        async function pushChanges(diff) {
            if (!diff) return;
            const patches = await diff.patches();
            for (const patch of patches) {
                let filePath = patch.newFile().path();
                if (regex) {
                    const match = filePath.match(regex);
                    if (!match) continue;
                }
                gitChanges.add(filePath);

                const parts = path.dirname(filePath).split(sep);
                for(let i = 0; i < parts.length; i++)
                    dirnames.add(parts.slice(0, i + 1).join(sep));
            }
        }

        await pushChanges(await repoExt.getUnstaged(repo));
        await pushChanges(await repoExt.getStaged(repo));

        let changesSha;
        if (gitChanges.size) {
            const hash = await hashElement(opts.subdir, {
                algo: 'sha1',
                encoding: 'hex',
                folders: {
                    include: [...dirnames],
                    matchBasename: false,
                    matchPath: true
                },
                files: {
                    include: [...gitChanges],
                    matchBasename: false,
                    matchPath: true
                }
            });

            changesSha = hash.hash;
            tagHash.update(changesSha);
            imageLabels.push(`myt.changes-sha=${changesSha}`);
        }

        // Get image tag

        const tagSha = tagHash.digest('hex');
        const shortSha = tagSha.substring(0, opts.gitShortLen);

        const imageName = opts.name || opts.code;
        const imageTag = opts.tag || shortSha || 'latest';
        const tag = `${imageName}:${imageTag}`;

        // Check for existent image

        let labels;
        try {
            labels = await docker.inspect(tag, {
                format: '{{json .Config.Labels}}'
            });
        } catch (err) {
            if (err.code !== 1) throw err;
            labels = {};
        }

        const useCache = !opts.force
            && labels['myt.commit-sha'] == commitSha
            && (
                (!changesSha && !labels['myt.changes-sha'])
                || (labels['myt.changes-sha'] == changesSha)
            );
        if (useCache) return tag;

        // Build base server image

        const serverTag = `myt/server:${opts.version}`;
        let serverId;
        try {
            serverId = await docker.inspect(serverTag,
                {format: '{{json .Id}}'}
            );
        } catch (err) {
            if (err.code !== 1) throw err;
        }

        if (!serverId || opts.force) {
            this.emit('buildingServerImage');

            const buildArgs = [];
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

            await docker.build(__dirname, {
                tag: serverTag,
                file: path.join(serverDir, 'Dockerfile'),
                buildArg: buildArgs
            }, opts.debug);
        }

        // Build dump image

        this.emit('buildingDumpImage');

        const versionFile = path.join(dumpDataDir, 'version.json');
        const version = JSON.parse(await fs.readFile(versionFile, 'utf8'));

        const changes = await myt.getChanges(version.gitCommit);
        await fs.writeFile(
            path.join(dumpDir, '.changes.json'),
            JSON.stringify(changes, null, 1)
        );

        await docker.build(opts.mytDir, {
            tag: [tag, imageName],
            file: path.join(serverDir, 'Dockerfile.dump'),
            label: imageLabels,
            buildArg: [
                `ROOT_PASS=${opts.rootPassword}`,
                `BASE_IMAGE=${serverTag}`,
                `MYT_COMMIT=${commitSha}`
            ]
        }, opts.debug);

        this.emit('dumpImageBuilt', tag);

        return tag;
    }
}

module.exports = Build;

if (require.main === module)
    new Myt().cli(Build);
