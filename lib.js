
const ejs = require('ejs');
const shajs = require('sha.js');
const fs = require('fs-extra');

function camelToSnake(str) {
    return str.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}

class Exporter {
    constructor(engine, objectType, conn) {
        this.engine = engine;
        this.objectType = objectType;
        this.dstDir = `${objectType}s`;
        this.conn = conn;
    }

    async init() {
        const templateDir = `${__dirname}/exporters/${this.objectType}`;
        this.sql = await fs.readFile(`${templateDir}.sql`, 'utf8');

        const templateFile = await fs.readFile(`${templateDir}.ejs`, 'utf8');
        this.template = ejs.compile(templateFile);
        this.attrs = require(`${templateDir}.js`);
    }

    async export(exportDir, schema, newSums, oldSums, update) {
        const res = await this.query(schema);
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
            const routineName = params.name;
            const sql = this.format(params);
            const routineFile = `${routineDir}/${routineName}.sql`;

            const shaSum = this.engine.shaSum(sql);
            newSums[routineName] = shaSum;

            if (oldSums[routineName] !== shaSum || update)
                await fs.writeFile(routineFile, sql);
        }
    }

    async query(schema, name) {
        const {conn} = this;

        const ops = [];
        function addOp(col, value) {
            ops.push(conn.format('?? = ?', [col, value]));
        }
        if (schema)
            addOp(this.attrs.schemaCol, schema);
        if (name)
            addOp(this.attrs.nameCol, name);

        const filter = {
            toSqlString() {
                return ops.join(' AND ');
            }
        }

        const [res] = await conn.query(this.sql, [filter]);
        return res;
    }

    format(params) {
        const {conn, attrs} = this;

        if (attrs.formatter)
            attrs.formatter(params, conn);

        if (attrs.escapeCols)
        for (const escapeCol of attrs.escapeCols) {
            if (params[escapeCol])
                params[escapeCol] = conn.escape(params[escapeCol])
        }

        const split = params.definer.split('@');
        params.schema = conn.escapeId(params.schema, true);
        params.name = conn.escapeId(params.name, true);
        params.definer =
            `${conn.escapeId(split[0], true)}@${conn.escapeId(split[1], true)}`;

        return this.template(params);
    }
}
class ExporterEngine {
    constructor(conn, myvcDir) {
        this.conn = conn;
        this.shaFile = `${myvcDir}/.shasums.json`;
        this.exporters = [];
        this.exporterMap = {};
    }

    async init () {
        if (await fs.pathExists(this.shaFile))
            this.shaSums = JSON.parse(await fs.readFile(this.shaFile, 'utf8'));
        else
            this.shaSums = {};

        const types = [
            'function',
            'procedure',
            'view',
            'trigger',
            'event'
        ];

        for (const type of types) {
            const exporter = new Exporter(this, type, this.conn);
            await exporter.init();

            this.exporters.push(exporter);
            this.exporterMap[type] = exporter;
        }
    }

    async fetchRoutine(type, schema, name) {
        const exporter = this.exporterMap[type];
        const [row] = await exporter.query(schema, name);
        return row && exporter.format(row);
    }

    async fetchShaSum(type, schema, name) {
        const sql = await this.fetchRoutine(type, schema, name);
        this.setShaSum(type, schema, name, this.shaSum(sql));
    }

    shaSum(sql) {
        if (!sql) return null;
        return shajs('sha256')
            .update(JSON.stringify(sql))
            .digest('hex');
    }

    setShaSum(type, schema, name, shaSum) {
        if (!shaSum) {
            this.deleteShaSum(type, schema, name);
            return;
        }

        const shaSums = this.shaSums;
        if (!shaSums[schema])
            shaSums[schema] = {};
        if (!shaSums[schema][type])
            shaSums[schema][type] = {};
        shaSums[schema][type][name] = shaSum;
    }

    deleteShaSum(type, schema, name) {
        try {
            delete this.shaSums[schema][type][name];
        } catch (e) {};
    }

    async saveShaSums() {
        await fs.writeFile(this.shaFile,
            JSON.stringify(this.shaSums, null, '  '));
    }
}

module.exports.camelToSnake = camelToSnake;
module.exports.Exporter = Exporter;
module.exports.ExporterEngine = ExporterEngine;
