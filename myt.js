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
const camelToSnake = require('./lib/util').camelToSnake;

class Myt {
    static usage = {
        description: 'Utility for database versioning',
        params: {
            remote: 'Name of remote to use',
            workspace: 'The base directory of the project',
            debug: 'Wether to enable debug mode',
            version: 'Display the version number and exit',
            help: 'Display this help message'
        }
    };

    static opts = {
        alias: {
            remote: 'r',
            workspace: 'w',
            debug: 'd',
            version: 'v',
            help: 'h'
        },
        boolean: [
            'debug',
            'version',
            'help'
        ]
    };

    async run(Command) {
        console.log(
            'Myt'.green,
            `v${packageJson.version}`.magenta
        );
        this.packageJson = packageJson;

        let baseOpts = this.constructor.opts;
        baseOpts.default = Object.assign(baseOpts.default || {}, {
            workspace: process.cwd()
        });
        const opts = this.getopts(baseOpts);

        if (opts.debug) {
            console.warn('Debug mode enabled.'.yellow);
            console.log('Global options:'.magenta, opts);
        }

        if (opts.version)
            process.exit(0);

        try {
            const commandName = opts._[0];
            if (!Command && commandName) {
                if (!/^[a-z]+$/.test(commandName))
                    throw new Error (`Invalid command name '${commandName}'`);

                const commandFile = path.join(__dirname, `myt-${commandName}.js`);

                if (!await fs.pathExists(commandFile))
                    throw new Error (`Unknown command '${commandName}'`);
                Command = require(commandFile);
            }

            if (!Command) {
                this.showHelp(baseOpts, this.constructor.usage);
                process.exit(0);
            }

            const allOpts = Object.assign({}, baseOpts);

            if (Command.opts)
            for (const key in Command.opts) {
                const baseValue = baseOpts[key];
                const cmdValue = Command.opts[key];
                if (Array.isArray(baseValue))
                    allOpts[key] = baseValue.concat(cmdValue);
                else if (typeof baseValue == 'object')
                    allOpts[key] = Object.assign({}, baseValue, cmdValue);
                else
                    allOpts[key] = cmdValue;
            }

            const commandOpts = this.getopts(allOpts);
            if (opts.debug)
                console.log('Command options:'.magenta, commandOpts);
            Object.assign(opts, commandOpts);

            const operandToOpt = Command.usage.operand;
            if (opts._.length >= 2 && operandToOpt)
                opts[operandToOpt] = opts._[1];

            if (opts.debug)
                console.log('Final options:'.magenta, opts);

            if (opts.help) {
                this.showHelp(Command.opts, Command.usage, commandName);
                process.exit(0);
            }

            // Check version

            let depVersion;
            const versionRegex = /^[^~]?([0-9]+)\.([0-9]+).([0-9]+)$/;
            const wsPackageFile = path.join(opts.workspace, 'package.json');

            if (await fs.pathExists(wsPackageFile)) {
                const wsPackageJson = require(wsPackageFile);
                try {
                    depVersion = wsPackageJson
                        .dependencies[packageJson.name]
                        .match(versionRegex);
                } catch (e) {}
            }

            if (depVersion) {
                const myVersion = packageJson.version.match(versionRegex);

                const isSameVersion =
                    depVersion[1] === myVersion[1] &&
                    depVersion[2] === myVersion[2];
                if (!isSameVersion)
                    throw new Error(`Myt version differs a lot from package.json, please run 'npm i' first to install the proper version.`);

                const isSameMinor = depVersion[3] === myVersion[3];
                if (!isSameMinor)
                    console.warn(`Warning! Myt minor version differs from package.json, maybe you shoud run 'npm i' to install the proper version.`.yellow);
            }

            // Load method

            parameter('Workspace:', opts.workspace);
            parameter('Remote:', opts.remote || 'local');

            await this.load(opts);
            await this.runCommand(Command, opts);
            await this.unload();
        } catch (err) {
            if (err.name == 'Error' && !opts.debug) {
                console.error('Error:'.gray, err.message.red);
                console.log(`You can get more details about the error by passing the 'debug' option.`.yellow);
            } else
                console.log(err.stack.magenta);

            process.exit(1);
        }

        function parameter(parameter, value) {
            console.log(parameter.gray, (value || 'null').blue);
        }

        process.exit();
    }

    async runCommand(Command, opts) {
        const command = new Command(this, opts);
        return await command.run(this, opts);
    }

    async load(opts) {
        // Configuration file

        const defaultConfig = require(`${__dirname}/assets/myt.default.yml`);
        const config = Object.assign({}, defaultConfig);
        
        const configFile = 'myt.config.yml';
        const configPath = path.join(opts.workspace, configFile);

        if (await fs.pathExists(configPath)) {
            const mergeKeys = new Set([
                'privileges'
            ]);

            const wsConfig = require(configPath);
            for (const key in wsConfig) {
                if (!mergeKeys.has(key)) {
                    config[key] = wsConfig[key];
                } else {
                    config[key] = Object.assign({},
                        config[key],
                        wsConfig[key]
                    );
                }
            }
        }

        Object.assign(opts, config);
        opts.configFile = configFile;

        if (!opts.mytDir)
            opts.mytDir = path.join(opts.workspace, opts.subdir || '');

        opts.routinesDir = path.join(opts.mytDir, 'routines');
        opts.versionsDir = path.join(opts.mytDir, 'versions');
        opts.dumpDir = path.join(opts.mytDir, 'dump');

        // Database configuration
        
        let iniDir = path.join(__dirname, 'assets');
        let iniFile = 'db.ini';

        if (opts.remote) {
            iniDir = `${opts.mytDir}/remotes`;
            iniFile = `${opts.remote}.ini`;
        }
        const iniPath = path.join(iniDir, iniFile);
        
        if (!await fs.pathExists(iniPath))
            throw new Error(`Database config file not found: ${iniPath}`);
        
        let dbConfig;
        try {
            const iniData = ini.parse(await fs.readFile(iniPath, 'utf8')).client;
            const iniConfig = {};
            for (const key in iniData) {
                const value = iniData[key];
                const newKey = key.replace(/-/g, '_');
                iniConfig[newKey] = value !== undefined ? value : true;
            }
            dbConfig = {
                host: iniConfig.host,
                port: iniConfig.port,
                user: iniConfig.user,
                password: iniConfig.password,
                multipleStatements: true
            };
            if (iniConfig.enable_cleartext_plugin) {
                dbConfig.authPlugins = {
                    mysql_clear_password() {
                        return () => iniConfig.password + '\0';
                    }
                };
            }
            if (iniConfig.ssl_ca) {
                dbConfig.ssl = {
                    ca: await fs.readFile(`${opts.mytDir}/${iniConfig.ssl_ca}`),
                    rejectUnauthorized: iniConfig.ssl_verify_server_cert != undefined
                }
            }
            if (iniConfig.socket) {
                dbConfig.socketPath = iniConfig.socket;
            }
        } catch(err) {
            const newErr = Error(`Cannot process the ini file, check that the syntax is correct: ${iniPath}`);
            newErr.stack += `\nCaused by: ${err.stack}`;
            throw newErr;
        }

        Object.assign(opts, {
            iniFile,
            dbConfig
        });
        this.opts = opts;
    }

    async unload() {
        if (this.conn)
            await this.conn.end();
    }

    getopts(opts) {
        const argv = process.argv.slice(2);
        const values = getopts(argv, opts);
        const cleanValues = {};
        for (const opt in values)
            if (opt.length > 1 || opt == '_')
                cleanValues[opt] = values[opt];
        return cleanValues;
    }

    async dbConnect() {
        const {opts} = this;

        if (!this.conn) {
            const conn = this.conn = await this.createConnection();

            const [[schema]] = await conn.query(
                `SHOW DATABASES LIKE ?`, [opts.versionSchema]
            );

            if (!schema)
                await conn.query(`CREATE DATABASE ??`, [opts.versionSchema]);
            await conn.query(`USE ??`, [opts.versionSchema]);

            const [[res]] = await conn.query(
                `SELECT COUNT(*) > 0 tableExists
                    FROM information_schema.tables
                    WHERE TABLE_SCHEMA = ?
                        AND TABLE_NAME = 'version'`,
                [opts.versionSchema]
            );
    
            if (!res.tableExists) {
                const structure = await fs.readFile(
                    `${__dirname}/assets/structure.sql`, 'utf8');
                await conn.query(structure);
            }
        }

        return this.conn;
    }

    async createConnection() {
        return await mysql.createConnection(this.opts.dbConfig);
    }

    async fetchDbVersion() {
        const [[version]] = await this.conn.query(
            `SELECT number, gitCommit
                FROM version WHERE code = ?`,
            [this.opts.code]
        );
        return version;
    }

    parseVersionDir(versionDir) {
        const match = versionDir.match(/^([0-9]+)-([a-zA-Z0-9]+)?$/);
        if (!match) return null;
        return {
            number: match[1],
            name: match[2]
        };
    }

    async openRepo() {
        const {opts} = this;

        if (!await fs.pathExists(`${opts.workspace}/.git`))
            throw new Error ('Git not initialized');

        return await nodegit.Repository.open(opts.workspace);
    }

    showHelp(opts, usage, command) {
        const prefix = `${'Usage:'.gray} [npx] myt`;

        if (command) {
            let log = [prefix, command.blue];
            if (usage.operand) log.push(`[<${usage.operand}>]`);
            if (opts) log.push('[<options>]');
            console.log(log.join(' '))
        } else
            console.log(`${prefix} [<options>] ${'<command>'.blue} [<args>]`);

        if (usage.description)
            console.log(`${'Description:'.gray} ${usage.description}`);

        if (opts && opts.alias) {
            const alias = opts.alias;
            const boolean = opts.boolean || [];

            console.log('Options:'.gray);
            for (const opt in alias) {
                const paramDescription = usage.params[opt] || '';
                let longOpt = opt;
                if (boolean.indexOf(longOpt) === -1)
                    longOpt += ` <string>`;
                longOpt = camelToSnake(longOpt).padEnd(22, ' ')
                console.log(`  -${alias[opt]}, --${longOpt} ${paramDescription}`);
            }
        }
    }
}

module.exports = Myt;

if (require.main === module)
    new Myt().run();
