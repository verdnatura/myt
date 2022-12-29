const shajs = require('sha.js');
const fs = require('fs-extra');
const Exporter = require('./exporter');

module.exports = class ExporterEngine {
    constructor(conn, mytDir) {
        this.conn = conn;
        this.pullFile = `${mytDir}/.pullinfo.json`;
        this.exporters = [];
        this.exporterMap = {};
    }

    async init () {
        if (await fs.pathExists(this.pullFile)) {
            this.pullInfo = JSON.parse(await fs.readFile(this.pullFile, 'utf8'));
            const lastPull = this.pullInfo.lastPull;
            if (lastPull)
                this.pullInfo.lastPull = new Date(lastPull);
        } else
            this.pullInfo = {
                lastPull: null,
                shaSums: {}
            };

        this.shaSums = this.pullInfo.shaSums;
        this.lastPull = this.pullInfo.lastPull;
        this.infoChanged = false;

        const types = [
            'function',
            'procedure',
            'view',
            'trigger',
            'event'
        ];

        for (const type of types) {
            const exporter = new Exporter(type);
            await exporter.init();

            this.exporters.push(exporter);
            this.exporterMap[type] = exporter;
        }
    }

    async fetchRoutine(type, schema, name) {
        const exporter = this.exporterMap[type];
        const [row] = await exporter.query(this.conn, schema, name);
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

    getShaSum(type, schema, name) {
        try {
            return this.shaSums[schema][type][name];
        } catch (e) {};

        return null;
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
        this.infoChanged = true;
    }

    deleteShaSum(type, schema, name) {
        try {
            delete this.shaSums[schema][type][name];
            this.infoChanged = true;
        } catch (e) {};
    }

    deleteSchemaSums(schema) {
        delete this.shaSums[schema];
        this.infoChanged = true;
    }

    async refreshPullDate() {
        const [[row]] = await this.conn.query(`SELECT NOW() now`);
        this.pullInfo.lastPull = row.now;
        this.infoChanged = true;
    }

    async saveInfo() {
        if (!this.infoChanged) return;
        await fs.writeFile(this.pullFile,
            JSON.stringify(this.pullInfo, null, '  '));
        this.infoChanged = false;
    }
}
