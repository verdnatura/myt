
const MyVC = require('./myvc');
const fs = require('fs-extra');
const ejs = require('ejs');

class Pull {
    async run(myvc, opts) {
        const conn = await myvc.dbConnect();

        for (const exporter of exporters)
            await exporter.init();

        const exportDir = `${opts.workspace}/routines`;
        if (await fs.pathExists(exportDir))
            await fs.remove(exportDir, {recursive: true});
        await fs.mkdir(exportDir);

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

        for (const params of res) {
            if (this.formatter)
                this.formatter(params, schema)

            params.schema = schema;
            let sql = this.template(params);
            await fs.writeFile(`${routineDir}/${params.name}.sql`, sql);
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
