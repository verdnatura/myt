
const MyVC = require('./myvc');
const fs = require('fs-extra');
const nodegit = require('nodegit');
const ExporterEngine = require('./lib').ExporterEngine;
class Pull {
    get usage() {
        return {
            description: 'Incorporate database routine changes into workspace',
            params: {
                force: 'Do it even if there are local changes',
                checkout: 'Move to same database commit before pull'
            },
            operand: 'remote'
        };
    }

    get localOpts() {
        return {
            boolean: {
                force: 'f',
                checkout: 'c'
            }
        };
    }

    async run(myvc, opts) {
        const conn = await myvc.dbConnect();
        const repo = await myvc.openRepo();

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

            const unstagedDiff = await myvc.getUnstaged(repo);

            if (await hasChanges(unstagedDiff))
                throw new Error('You have unstaged changes, save them before pull');

            // Check for staged changes

            const stagedDiff = await myvc.getStaged(repo);
 
            if (await hasChanges(stagedDiff))
                throw new Error('You have staged changes, save them before pull');
        }

        // Checkout to remote commit

        if (opts.checkout) {
            const version = await myvc.fetchDbVersion();

            if (version && version.gitCommit) {
                const now = parseInt(new Date().toJSON());
                const branchName = `myvc-pull_${now}`;
                console.log(`Creating branch '${branchName}' from database commit.`);
                const commit = await repo.getCommit(version.gitCommit);
                const branch = await nodegit.Branch.create(repo,
                    `myvc-pull_${now}`, commit, () => {});
                await repo.checkoutBranch(branch);
            }
        }

        // Export routines to SQL files

        console.log(`Incorporating routine changes.`);

        const engine = new ExporterEngine(conn, opts.myvcDir);
        await engine.init();
        const shaSums = engine.shaSums;

        const exportDir = `${opts.myvcDir}/routines`;
        if (!await fs.pathExists(exportDir))
            await fs.mkdir(exportDir);

        // Delete old schemas

        const schemas = await fs.readdir(exportDir);
        for (const schema of schemas) {
            if (opts.schemas.indexOf(schema) == -1)
                await fs.remove(`${exportDir}/${schema}`, {recursive: true});
        }

        for (const schema in shaSums) {
            if (!await fs.pathExists(`${exportDir}/${schema}`))
                delete shaSums[schema];
        }

        // Export objects to SQL files

        for (const schema of opts.schemas) {
            let schemaDir = `${exportDir}/${schema}`;
            if (!await fs.pathExists(schemaDir))
                await fs.mkdir(schemaDir);
            if (!shaSums[schema])
                shaSums[schema] = {};
            const sums = shaSums[schema];

            for (const exporter of engine.exporters) {
                const type = exporter.objectType;
                const oldSums = sums[type] || {};
                sums[type] = {};
                await exporter.export(exportDir, schema, sums[type], oldSums);
            }
        }

        await engine.saveShaSums();
    }
}

module.exports = Pull;

if (require.main === module)
    new MyVC().run(Pull);
