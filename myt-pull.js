const Myt = require('./myt');
const Command = require('./lib/command');
const fs = require('fs-extra');
const nodegit = require('nodegit');
const ExporterEngine = require('./lib/exporter-engine');
const repoExt = require('./lib/repo');

class Pull extends Command {
    static usage = {
        description: 'Incorporate database routine changes into workspace',
        params: {
            force: 'Do it even if there are local changes',
            checkout: 'Move to same database commit before pull',
            update: 'Update all routines',
            sums: 'Save SHA sums of all objects'
        },
        operand: 'remote'
    };

    static opts = {
        alias: {
            force: 'f',
            checkout: 'c',
            update: 'u',
            sums: 's'
        },
        boolean: [
            'force',
            'checkout',
            'update',
            'sums'
        ]
    };

    async run(myt, opts) {
        const conn = await myt.dbConnect();
        const repo = await myt.openRepo();

        if (!opts.force) {
            async function hasChanges(diff) {
                if (diff)
                for (const patch of await diff.patches()) {
                    const match = patch
                        .newFile()
                        .path()
                        .match(/^routines\/(.+)\.sql$/);
                    if (match) return true;
                }

                return false;
            }

            // Check for unstaged changes

            const unstagedDiff = await repoExt.getUnstaged(repo);

            if (await hasChanges(unstagedDiff))
                throw new Error('You have unstaged changes, save them before pull');

            // Check for staged changes

            const stagedDiff = await repoExt.getStaged(repo);
 
            if (await hasChanges(stagedDiff))
                throw new Error('You have staged changes, save them before pull');
        }

        // Checkout to remote commit

        if (opts.checkout) {
            const version = await myt.fetchDbVersion();

            if (version && version.gitCommit) {
                const now = parseInt(new Date().toJSON());
                const branchName = `myt-pull_${now}`;
                console.log(`Creating branch '${branchName}' from database commit.`);
                const commit = await repo.getCommit(version.gitCommit);
                const branch = await nodegit.Branch.create(repo,
                    `myt-pull_${now}`, commit, () => {});
                await repo.checkoutBranch(branch);
            }
        }

        // Export routines to SQL files

        console.log(`Incorporating routine changes.`);

        const engine = new ExporterEngine(conn, opts.mytDir);
        await engine.init();
        const shaSums = engine.shaSums;

        const routinesDir = opts.routinesDir;
        if (!await fs.pathExists(routinesDir))
            await fs.mkdir(routinesDir);

        // Delete old schemas

        const schemas = await fs.readdir(routinesDir);
        for (const schema of schemas) {
            if (opts.schemas.indexOf(schema) == -1)
                await fs.remove(`${routinesDir}/${schema}`, {recursive: true});
        }

        for (const schema in shaSums) {
            if (!await fs.pathExists(`${routinesDir}/${schema}`))
                engine.deleteSchemaSums(schema);
        }

        // Export objects to SQL files

        for (const schema of opts.schemas) {
            let schemaDir = `${routinesDir}/${schema}`;
            if (!await fs.pathExists(schemaDir))
                await fs.mkdir(schemaDir);

            for (const exporter of engine.exporters)
                await exporter.export(routinesDir,
                    schema, opts.update, opts.sums);
        }

        await engine.refreshPullDate();
        await engine.saveInfo();
    }
}

module.exports = Pull;

if (require.main === module)
    new Myt().run(Pull);