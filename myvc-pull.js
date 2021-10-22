
const MyVC = require('./myvc');
const fs = require('fs-extra');
const ejs = require('ejs');
const shajs = require('sha.js');
const nodegit = require('nodegit');

class Pull {
    get myOpts() {
        return {
            alias: {
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

        for (const exporter of exporters)
            await exporter.init();

        const exportDir = `${opts.workspace}/routines`;
        if (!await fs.pathExists(exportDir))
            await fs.mkdir(exportDir);

        const schemas = await fs.readdir(exportDir);
        for (const schema of schemas) {
            if (opts.schemas.indexOf(schema) == -1)
                await fs.remove(`${exportDir}/${schema}`, {recursive: true});
        }

        let shaSums;
        const shaFile = `${opts.workspace}/.shasums.json`;

        if (await fs.pathExists(shaFile))
            shaSums = JSON.parse(await fs.readFile(shaFile, 'utf8'));
        else
            shaSums = {};

        for (const schema of opts.schemas) {
            let schemaDir = `${exportDir}/${schema}`;

            if (!await fs.pathExists(schemaDir))
                await fs.mkdir(schemaDir);

            let schemaSums = shaSums[schema];
            if (!schemaSums) schemaSums = shaSums[schema] = {};

            for (const exporter of exporters) {
                const objectType = exporter.objectType;

                let objectSums = schemaSums[objectType];
                if (!objectSums) objectSums = schemaSums[objectType] = {};

                await exporter.export(conn, exportDir, schema, objectSums);
            }
        }

        await fs.writeFile(shaFile, JSON.stringify(shaSums, null, '  '));
    }
}

class Exporter {
    constructor(objectType) {
        this.objectType = objectType;
        this.dstDir = `${objectType}s`;
    }

    async init() {
        const templateDir = `${__dirname}/exporters/${this.objectType}`;
        this.query = await fs.readFile(`${templateDir}.sql`, 'utf8');

        const templateFile = await fs.readFile(`${templateDir}.ejs`, 'utf8');
        this.template = ejs.compile(templateFile);

        if (await fs.pathExists(`${templateDir}.js`))
            this.formatter = require(`${templateDir}.js`);
    }

    async export(conn, exportDir, schema, shaSums) {
        const [res] = await conn.query(this.query, [schema]);
        if (!res.length) return; 

        const routineDir = `${exportDir}/${schema}/${this.dstDir}`;
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
            if (!routineSet.has(routine))
                await fs.remove(`${routineDir}/${routine}.sql`);
        }

        for (const params of res) {
            if (this.formatter)
                this.formatter(params, schema)

            const routineName = params.name;
            const split = params.definer.split('@');
            params.schema = conn.escapeId(schema);
            params.name = conn.escapeId(routineName, true);
            params.definer =
                `${conn.escapeId(split[0], true)}@${conn.escapeId(split[1], true)}`;

            const sql = this.template(params);
            const routineFile = `${routineDir}/${routineName}.sql`;

            const shaSum = shajs('sha256')
                .update(JSON.stringify(sql))
                .digest('hex');
            shaSums[routineName] = shaSum;

            let changed = true;

            if (await fs.pathExists(routineFile)) {
                const currentSql = await fs.readFile(routineFile, 'utf8');
                changed = shaSums[routineName] !== shaSum;;
            }
            if (changed) {
                await fs.writeFile(routineFile, sql);
                shaSums[routineName] = shaSum;
            }
        }
    }
}

const exporters = [
    new Exporter('function'),
    new Exporter('procedure'),
    new Exporter('view'),
    new Exporter('trigger'),
    new Exporter('event')
];

module.exports = Pull;

if (require.main === module)
    new MyVC().run(Pull);
