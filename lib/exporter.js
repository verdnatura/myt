const ejs = require('ejs');
const fs = require('fs-extra');
const SqlString = require('sqlstring');

module.exports = class Exporter {
    constructor(objectType, replace) {
        Object.assign(this, {
            objectType,
            replace
        });
    }

    async init() {
        const templateDir = `${__dirname}/../exporters/${this.objectType}`;
        this.sql = await fs.readFile(`${templateDir}.sql`, 'utf8');

        const templateFile = await fs.readFile(`${templateDir}.ejs`, 'utf8');
        this.template = ejs.compile(templateFile);
        this.attrs = require(`${templateDir}.js`);
    }

    async query(conn, schema, name) {
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
        const {attrs} = this;
        params = Object.assign({}, attrs.defaults, params)
        const data = {params};

        if (attrs.formatter)
            attrs.formatter(params);

        if (attrs.escapeCols)
        for (const escapeCol of attrs.escapeCols) {
            if (params[escapeCol])
                params[escapeCol] = SqlString.escape(params[escapeCol])
        }

        const split = params.definer.split('@');
        data.definer =
            SqlString.escapeId(split[0], true) + '@' +
            SqlString.escapeId(split[1], true);

        data.name =
            SqlString.escapeId(params.schema, true) + '.' +
            SqlString.escapeId(params.name, true);

        const objectType = this.objectType.toUpperCase();
        const delimiter = '$$';
        const replace = `CREATE OR REPLACE`;

        let create;
        if (this.replace) {
            create = `DELIMITER ${delimiter}\n${replace}`
        } else {
            create =
                 `DROP ${objectType} IF EXISTS ${data.name};\n`
                +`DELIMITER ${delimiter}\n`
                +`CREATE`;
        }

        data.createOrReplace = `${replace} DEFINER=${data.definer}`
        data.begin = `${create} DEFINER=${data.definer}`;
        data.typeAndName = `${objectType} ${data.name}`;
        data.end = `${delimiter}\nDELIMITER ;`;

        return this.template(data);
    }
}
