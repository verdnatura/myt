#!/usr/bin/node
const fs = require('fs-extra');
const ini = require('ini');
const mysql = require('mysql2/promise');
const ejs = require('ejs');

let cwd = process.cwd();
let env = process.argv[2];
let iniFile = env ? `db.${env}.ini` : `${__dirname}/db.ini`;
let dbConf = ini.parse(fs.readFileSync(iniFile, 'utf8')).client;
let exportDir = `${cwd}/routines`;
let config = require(`${cwd}/myvc.config.json`);

class Exporter {
    constructor(objectName, callback) {
        this.objectName = objectName;
        this.callback = callback;
        this.dstDir = `${objectName}s`;

        let templateDir = `${__dirname}/templates/${objectName}`;
        this.query = fs.readFileSync(`${templateDir}.sql`, 'utf8');

        let templateFile = fs.readFileSync(`${templateDir}.ejs`, 'utf8');
        this.template = ejs.compile(templateFile);

        if (fs.existsSync(`${templateDir}.js`))
            this.formatter = require(`${templateDir}.js`);
    }

    async export(conn, exportDir, schema) {
        let res = await conn.execute(this.query, [schema]);
        if (!res[0].length) return; 

        let routineDir = `${exportDir}/${schema}/${this.dstDir}`;
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

let exporters = [
    new Exporter('function'),
    new Exporter('procedure'),
    new Exporter('view'),
    new Exporter('trigger'),
    new Exporter('event')
];

// Exports objects for all schemas

async function main() {
    let ssl;
    if (dbConf.ssl_ca) {
        ssl = {
            ca: fs.readFileSync(`${cwd}/${dbConf.ssl_ca}`),
            rejectUnauthorized: dbConf.ssl_verify_server_cert != undefined
        }
    }

    let conn = await mysql.createConnection({
        host: !env ? 'localhost' : dbConf.host,
        port: dbConf.port,
        user: dbConf.user,
        password: dbConf.password,
        authPlugins: {
            mysql_clear_password() {
                return () => dbConf.password + '\0';
            }
        },
        ssl
    });
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
}
main();
