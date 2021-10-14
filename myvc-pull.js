
const MyVC = require('./myvc');
const fs = require('fs-extra');
const ejs = require('ejs');
const nodegit = require('nodegit');

class Pull {
    async run(myvc, opts) {
        const conn = await myvc.dbConnect();
/*
        const version = await myvc.fetchDbVersion();
        let repo;

        if (version && version.gitCommit) {
            console.log(version);
            repo = await nodegit.Repository.open(opts.workspace);
            const commit = await repo.getCommit(version.gitCommit);
            const now = parseInt(new Date().getTime() / 1000);
            const branch = await nodegit.Branch.create(repo,
                `myvc_${now}`, commit, () => {});
            await repo.checkoutBranch(branch);
        }

        return;
*/
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

        for (const schema of opts.schemas) {
            let schemaDir = `${exportDir}/${schema}`;

            if (!await fs.pathExists(schemaDir))
                await fs.mkdir(schemaDir);

            for (const exporter of exporters)
                await exporter.export(conn, exportDir, schema);
        }
    }
}

class Exporter {
    constructor(objectName) {
        this.objectName = objectName;
        this.dstDir = `${objectName}s`;
    }

    async init() {
        const templateDir = `${__dirname}/exporters/${this.objectName}`;
        this.query = await fs.readFile(`${templateDir}.sql`, 'utf8');

        const templateFile = await fs.readFile(`${templateDir}.ejs`, 'utf8');
        this.template = ejs.compile(templateFile);

        if (await fs.pathExists(`${templateDir}.js`))
            this.formatter = require(`${templateDir}.js`);
    }

    async export(conn, exportDir, schema) {
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

            params.schema = schema;
            const sql = this.template(params);
            const routineFile = `${routineDir}/${params.name}.sql`;
            let changed = true;

            if (await fs.pathExists(routineFile)) {
                const currentSql = await fs.readFile(routineFile, 'utf8');
                changed = currentSql !== sql;
            }
            if (changed)
                await fs.writeFile(routineFile, sql);
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
