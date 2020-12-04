#!/usr/bin/env node

require('require-yaml');
require('colors');
const getopts = require('getopts');
const packageJson = require('./package.json');
const fs = require('fs-extra');
const ini = require('ini');
const path = require('path');
const mysql = require('mysql2/promise');
const nodegit = require('nodegit');

class MyVC {
    async run(command) {
        console.log(
            'MyVC (MySQL Version Control)'.green,
            `v${packageJson.version}`.magenta
        );

        const opts = {};
        const argv = process.argv.slice(2);
        const cliOpts = getopts(argv, {
            alias: {
                remote: 'r',
                workspace: 'w',
                socket: 's',
                debug: 'd',
                version: 'v',
                help: 'h'
            },
            default: {
                workspace: process.cwd()
            }
        })

        if (cliOpts.version)
            process.exit(0);

        try {
            if (!command) {
                const commandName = cliOpts._[0];
                if (!commandName) {
                    console.log(
                        'Usage:'.gray,
                        '[npx] myvc'
                            + '[-w|--workspace]'
                            + '[-r|--remote]'
                            + '[-d|--debug]'
                            + '[-h|--help]'
                            + '[-v|--version]'
                            + 'command'.blue
                    );
                    process.exit(0);
                }

                const commands = [
                    'init',
                    'pull',
                    'push',
                    'dump',
                    'start',
                    'run'
                ];

                if (commands.indexOf(commandName) == -1)
                    throw new Error (`Unknown command '${commandName}'`);
        
                const Klass = require(`./myvc-${commandName}`);
                command = new Klass();
            }
    
            const commandOpts = getopts(argv, command.myOpts);
            Object.assign(cliOpts, commandOpts);
    
            for (const opt in cliOpts) {
                if (opt.length > 1 || opt == '_')
                    opts[opt] = cliOpts[opt];
            }
    
            parameter('Workspace:', opts.workspace);
            parameter('Remote:', opts.remote || 'local');

            await this.load(opts);
            command.opts = opts;
            await command.run(this, opts);
            await this.unload();
        } catch (err) {
            if (err.name == 'Error' && !opts.debug)
                console.error('Error:'.gray, err.message.red);
            else
                throw err;
        }

        function parameter(parameter, value) {
            console.log(parameter.gray, (value || 'null').blue);
        }

        process.exit();
    }

    async load(opts) {
        // Configuration file

        const config = require(`${__dirname}/myvc.default.yml`);
        
        const configFile = 'myvc.config.yml';
        const configPath = path.join(opts.workspace, configFile);
        if (await fs.pathExists(configPath))
            Object.assign(config, require(configPath));

        Object.assign(opts, config);
        opts.configFile = configFile;
        
        // Database configuration
        
        let iniFile = 'db.ini';
        let iniDir = __dirname;
        if (opts.remote) {
            iniFile = `remotes/${opts.remote}.ini`;
            iniDir = opts.workspace;
        }
        const iniPath = path.join(iniDir, iniFile);
        
        if (!await fs.pathExists(iniPath))
            throw new Error(`Database config file not found: ${iniFile}`);
        
        const iniConfig = ini.parse(await fs.readFile(iniPath, 'utf8')).client;
        const dbConfig = {
            host: iniConfig.host,
            port: iniConfig.port,
            user: iniConfig.user,
            password: iniConfig.password,
            database: opts.versionSchema,
            authPlugins: {
                mysql_clear_password() {
                    return () => iniConfig.password + '\0';
                }
            }
        };

        if (iniConfig.ssl_ca) {
            dbConfig.ssl = {
                ca: await fs.readFile(`${opts.workspace}/${iniConfig.ssl_ca}`),
                rejectUnauthorized: iniConfig.ssl_verify_server_cert != undefined
            }
        }
        if (opts.socket)
            dbConfig.socketPath = '/var/run/mysqld/mysqld.sock';

        Object.assign(opts, {
            iniFile,
            dbConfig
        });
        this.opts = opts;
    }

    async dbConnect() {
        if (!this.conn)
            this.conn = await this.createConnection();
        return this.conn;
    }

    async createConnection() {
        return await mysql.createConnection(this.opts.dbConfig);
    }

    async unload() {
        if (this.conn)
            await this.conn.end();
    }

    async fetchDbVersion() {
        const {opts} = this;

        const [[res]] = await this.conn.query(
            `SELECT COUNT(*) > 0 tableExists
                FROM information_schema.tables
                WHERE TABLE_SCHEMA = ?
                    AND TABLE_NAME = 'version'`,
            [opts.versionSchema]
        );

        if (!res.tableExists) {
            const structure = await fs.readFile(`${__dirname}/structure.sql`, 'utf8');
            await this.conn.query(structure);
            return null;
        }

        const [[version]] = await this.conn.query(
            `SELECT number, gitCommit
                FROM version WHERE code = ?`,
            [opts.code]
        );
        return version;
    }

    async changedRoutines(commit) {
        const repo = await nodegit.Repository.open(this.opts.workspace);

        const from = await repo.getCommit(commit);
        const fromTree = await from.getTree();

        const to = await repo.getHeadCommit();
        const toTree = await to.getTree();

        const diff = await toTree.diff(fromTree);
        const patches = await diff.patches();

        const changes = [];
        for (const patch of patches) {
            const path = patch.newFile().path();
            const match = path.match(/^routines\/(.+)\.sql$/);
            if (!match) continue;

            changes.push({
                mark: patch.isDeleted() ? '-' : '+',
                path: match[1]
            });
        }
        
        return changes.sort(
            (a, b) => b.mark == '-' && b.mark != a.mark ? 1 : -1
        );
    }

    async cachedChanges() {
        const changes = [];
        const dumpDir = `${this.opts.workspace}/dump`;
        const dumpChanges = `${dumpDir}/.changes`;

        if (!await fs.pathExists(dumpChanges))
            return null;

        const readline = require('readline');
        const rl = readline.createInterface({
            input: fs.createReadStream(dumpChanges),
            //output: process.stdout,
            console: false
        });

        for await (const line of rl) {
            changes.push({
                mark: line.charAt(0),
                path: line.substr(1)
            });
        }

        return changes;
    }
}

module.exports = MyVC;

if (require.main === module)
    new MyVC().run();
