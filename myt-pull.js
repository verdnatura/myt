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

    static reporter = {
        creatingBranch: function(branchName) {
            console.log(`Creating branch '${branchName}' from database commit.`);
        },
        routineChanges: 'Incorporating routine changes.'
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
                this.emit('creatingBranch', branchName);
                const commit = await repo.getCommit(version.gitCommit);
                const branch = await nodegit.Branch.create(repo,
                    `myt-pull_${now}`, commit, () => {});
                await repo.checkoutBranch(branch);
            }
        }

        // Export routines to SQL files

        this.emit('routineChanges', branchName);

        const engine = new ExporterEngine(conn, opts);
        await engine.init();
        const shaSums = engine.shaSums;

        const routinesDir = opts.routinesDir;
        if (!await fs.pathExists(routinesDir))
            await fs.mkdir(routinesDir);

        // Delete old schemas

        const schemas = await fs.readdir(routinesDir);
        for (const schema of schemas) {
            if (opts.schemas.indexOf(schema) == -1)
                await fs.remove(`${routinesDir}/${schema}`);
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
                await this.export(conn, engine, exporter, schema);
        }

        await engine.refreshPullDate();
        await engine.saveInfo();
    }

    async export(conn, engine, exporter, schema) {
        const {opts} = this;

        const res = await exporter.query(conn, schema);
        if (!res.length) return;

        const type = exporter.objectType;

        const routineDir = `${opts.routinesDir}/${schema}/${type}s`;
        if (!await fs.pathExists(routineDir))
            await fs.mkdir(routineDir);

        const routineSet = new Set();
        for (const params of res)
            routineSet.add(params.name);

        const routines = await fs.readdir(routineDir);
        for (const routineFile of routines) {
            const match = routineFile.match(/^(.*)\.sql$/);
            if (!match) continue;
            const routine = match[1];
            if (!routineSet.has(routine)) {
                await fs.remove(`${routineDir}/${routine}.sql`);
                engine.deleteShaSum(type, schema, routine)
            }
        }

        for (const params of res) {
            const routineName = params.name;
            const sql = exporter.format(params);
            const routineFile = `${routineDir}/${routineName}.sql`;
            let update = opts.update;

            const oldSum = engine.getShaSum(type, schema, routineName);
            if (oldSum || opts.sums || (opts.sumViews && type === 'view')) {
                const shaSum = engine.shaSum(sql);
                if (oldSum !== shaSum) {
                    engine.setShaSum(type, schema, routineName, shaSum);
                    update = true;
                }
            } else if (params.modified && engine.lastPull) {
                if (params.modified > engine.lastPull)
                    update = true;
            } else if (await fs.pathExists(routineFile)) {
                const currentSql = await fs.readFile(routineFile, 'utf8');
                if (sql != currentSql)
                    update = true;
            } else
                update = true;

            if (update)
                await fs.writeFile(routineFile, sql);
        }
    }
}

module.exports = Pull;

if (require.main === module)
    new Myt().cli(Pull);
