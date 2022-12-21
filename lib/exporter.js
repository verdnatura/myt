
const ejs = require('ejs');
const fs = require('fs-extra');

module.exports = class Exporter {
    constructor(engine, objectType, conn) {
        this.engine = engine;
        this.objectType = objectType;
        this.dstDir = `${objectType}s`;
        this.conn = conn;
    }

    async init() {
        const templateDir = `${__dirname}/../exporters/${this.objectType}`;
        this.sql = await fs.readFile(`${templateDir}.sql`, 'utf8');

        const templateFile = await fs.readFile(`${templateDir}.ejs`, 'utf8');
        this.template = ejs.compile(templateFile);
        this.attrs = require(`${templateDir}.js`);
    }

    async export(exportDir, schema, update, saveSum) {
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

        const engine = this.engine;

        for (const params of res) {
            const routineName = params.name;
            const sql = this.format(params);
            const routineFile = `${routineDir}/${routineName}.sql`;

            const oldSum = engine.getShaSum(routineName);
            if (oldSum || saveSum) {
                const shaSum = engine.shaSum(sql);
                if (oldSum !== shaSum) {
                    engine.setShaSum(
                        this.objectType, schema, routineName, shaSum);
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
