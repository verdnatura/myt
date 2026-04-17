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
            force: 'Whether to force build',
            realm: 'Name of fixture realm to use'
        },
        operand: 'realm'
    };

    static args = {
        alias: {
            name: 'n',
            tag: 't',
            force: 'f',
            realm: 'm'
        },
        string: [
            'name',
            'tag',
            'realm'
        ],
        boolean: [
            'force'
        ]
    };

    static reporter = {
        buildingBaseImages: 'Building base images.',
        buildingServerImage: 'Building server image.',
        serverImageTag: function(tag) {
            console.log('Image:', tag);
        }
    };

    async _run(myt, ctx, cfg, opts) {
        const {
            dumpDir,
            dockerDir,
            version,
            subdir
        } = ctx;

        const {
            realm,
            force
        } = opts;

        const serverDir = path.join(__dirname, 'docker/server');

        if (!await fs.pathExists(`${dumpDir}/structure.sql`))
            throw new Error('Dump file not found');

        // Initialize

        const imageLabels = [`myt.version=${version}`];
        const tagHash = createHash('sha1');
        const repo = await myt.openRepo();

        const commit = await repo.getHeadCommit();
        const commitSha = commit?.sha() || '';
        tagHash.update(commitSha);
        imageLabels.push(`myt.commit-sha=${commitSha}`);

        // Get changed files hash

        const repoExt = require('./lib/repo');
        const regex = subdir && new RegExp(`^${subdir}\/(.+)`);
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

        if (cfg.debug)
            console.debug('Uncommited:'.magenta, gitChanges);

        let changesSha;
        if (gitChanges.size) {
            const {hash} = await hashElement(subdir, {
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

            changesSha = hash;
            tagHash.update(changesSha);
            imageLabels.push(`myt.changes-sha=${changesSha}`);
        }

        if (realm)
            imageLabels.push(`myt.realm=${realm}`);

        // Get image tag

        const tagSha = tagHash.digest('hex');
        const shortSha = tagSha.substring(0, cfg.gitShortLen);

        let imageTag = shortSha;
        if (realm) imageTag += `-${realm}`;

        const imageName = opts.name || cfg.code;
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

        const useCache = !force
            && labels['myt.version'] == version
            && labels['myt.commit-sha'] == commitSha
            && (
                (!changesSha && !labels['myt.changes-sha'])
                || (labels['myt.changes-sha'] == changesSha)
            )
            && (
                (!realm && !labels['myt.realm'])
                || (labels['myt.realm'] == realm)
            );

        if (!useCache) {
            // Build base server image

            const baseTag = `myt/base:${version}`;
            const mytTag = `myt/app:${version}`;

            let baseLabels;
            try {
                baseLabels = await docker.inspect(baseTag,
                    {format: '{{json .Config.Labels}}'}
                );
            } catch (err) {
                if (err.code !== 1) throw err;
            }

            let buildBase = !baseLabels;

            const buildBaseLabels = [];
            const dbDockerfile = path.join(dockerDir, 'Dockerfile');
            const dbDockerExists = await fs.pathExists(dbDockerfile);

            if (!buildBase && dbDockerExists) {
                const {hash} = await hashElement(dockerDir, {
                    algo: 'sha1',
                    encoding: 'hex',
                });

                buildBase = baseLabels['myt.server-sha'] != hash;
                buildBaseLabels.push(`myt.server-sha=${hash}`);
            }

            if (buildBase || force) {
                this.emit('buildingBaseImages');

                let dbTag;
                if (dbDockerExists) {
                    dbTag = `myt/db:${version}`;
                    await docker.build(dockerDir, {
                        tag: dbTag,
                        file: dbDockerfile,
                        label: buildBaseLabels,
                    }, cfg.debug);
                } else {
                    dbTag = cfg.dbImageTag;
                }

                const buildArgs = [];
                if (dbTag)
                    buildArgs.push(`DB_TAG=${dbTag}`);

                await docker.build(__dirname, {
                    tag: baseTag,
                    file: path.join(serverDir, 'Dockerfile.base'),
                    buildArg: buildArgs,
                    label: buildBaseLabels,
                }, cfg.debug);

                await docker.build(__dirname, {
                    tag: mytTag,
                    file: path.join(serverDir, 'Dockerfile.myt'),
                    buildArg: `BASE_TAG=${baseTag}`,
                    label: buildBaseLabels,
                }, cfg.debug);
            }

            // Build dump image

            this.emit('buildingServerImage');

            let dbCommit;
            const versionFile = path.join(dumpDir, 'version.json');
            if (await fs.exists(versionFile)) {
                const dbVersion = JSON.parse(await fs.readFile(versionFile, 'utf8'));
                dbCommit = dbVersion.gitCommit;
            }
            const changes = await myt.getChanges(dbCommit);

            const changesFile = path.join(ctx.routinesDir, '.changes.json');
            await fs.writeFile(
                changesFile,
                JSON.stringify(changes, null, 1)
            );

            try {
                const buildArgs = [
                    `ROOT_PASS=${cfg.rootPassword}`,
                    `BASE_TAG=${baseTag}`,
                    `MYT_TAG=${mytTag}`,
                    `MYT_COMMIT=${commitSha}`
                ];

                if (realm)
                    buildArgs.push(`MYT_REALM=${realm}`);

                const tags = [tag, `${imageName}:latest`];
                if (opts.tag)
                    tags.push(`${imageName}:${opts.tag}`);

                await docker.build(ctx.mytDir, {
                    tag: tags,
                    file: path.join(serverDir, 'Dockerfile'),
                    label: imageLabels,
                    buildArg: buildArgs
                }, cfg.debug);
            } finally {
                await fs.unlink(changesFile);
            }
        }

        this.emit('serverImageTag', tag);
        return tag;
    }
}

module.exports = Build;

if (require.main === module)
    new Myt().cli(Build);
