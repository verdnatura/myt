#!/usr/bin/node
const fs = require('fs-extra');
const mysql = require('mysql2/promise');
const ejs = require('ejs');

class Exporter {
    constructor(objectName, callback) {
        this.objectName = objectName;
        this.callback = callback;
        this.dstDir = `${objectName}s`;

        const templateDir = `${__dirname}/templates/${objectName}`;
        this.query = fs.readFileSync(`${templateDir}.sql`, 'utf8');

        const templateFile = fs.readFileSync(`${templateDir}.ejs`, 'utf8');
        this.template = ejs.compile(templateFile);

        if (fs.existsSync(`${templateDir}.js`))
            this.formatter = require(`${templateDir}.js`);
    }

    async export(conn, exportDir, schema) {
        const res = await conn.execute(this.query, [schema]);
        if (!res[0].length) return; 

        const routineDir = `${exportDir}/${schema}/${this.dstDir}`;
        if (!fs.existsSync(routineDir))
            fs.mkdirSync(routineDir);

        for (let params of res[0]) {
            if (this.formatter)
                this.formatter(params, schema)

            params.schema = schema;
            let sql = this.template(params);
            fs.writeFileSync(`${routineDir}/${params.name}.sql`, sql);
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

// Exports objects for all schemas

module.exports = async function main(opts, config, dbConf) {
    const exportDir = `${opts.workdir}/routines`;

    const conn = await mysql.createConnection(dbConf);
    conn.queryFromFile = function(file, params) {
        return this.execute(
            fs.readFileSync(`${file}.sql`, 'utf8'),
            params
        );
    }

    try {
        if (fs.existsSync(exportDir))
            fs.removeSync(exportDir, {recursive: true});
        
        fs.mkdirSync(exportDir);

        for (let schema of config.structure) {
            let schemaDir = `${exportDir}/${schema}`;

            if (!fs.existsSync(schemaDir))
                fs.mkdirSync(schemaDir);

            for (let exporter of exporters)
                await exporter.export(conn, exportDir, schema);
        }
    } catch(err) {
        console.error(err);
    } finally {
        await conn.end();
    }
};
