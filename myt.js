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
const repoExt = require('./lib/repo');

const scriptRegex = /^[0-9]{2}-[a-zA-Z0-9_]+(?:\.(?!undo)([a-zA-Z0-9_]+))?(\.undo)?\.sql$/;

class Myt {
    static usage = {
        description: 'Utility for database versioning',
        params: {
            remote: 'Name of remote to use',
            workspace: 'The base directory of the project',
            debug: 'Whether to enable debug mode',
            version: 'Display the version number and exit',
            help: 'Display this help message',
        }
    };

    static args = {
        alias: {
            remote: 'r',
            workspace: 'w',
            debug: 'd',
            version: 'v',
            help: 'h'
        },
        string: [
            'remote',
            'workspace'
        ],
        boolean: [
            'debug',
            'version',
            'help'
        ]
    };

    /**
     * Run myt command from CLI.
     * @param {Command} Command class reference
     */
    async cli(Command) {
        this.cliMode = true;

        console.log(
            'Myt'.green,
            `v${packageJson.version}`.magenta
        );
        this.packageJson = packageJson;

        const args = Object.assign({}, this.constructor.args);
        args.default = Object.assign(args.default || {}, {
            workspace: process.cwd()
        });
        const argv = process.argv.slice(2);

        // Temporal until args is merged with command args
        let opts = getopts(argv, args);

        if (opts.debug)
            console.warn('Debug mode enabled.'.yellow);

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
                this.showHelp(args, this.constructor.usage);
                process.exit(0);
            }

            const allArgs = Object.assign({}, args);

            if (Command.args)
            for (const key in Command.args) {
                const baseValue = args[key];
                const cmdValue = Command.args[key];
                if (Array.isArray(baseValue))
                    allArgs[key] = baseValue.concat(cmdValue);
                else if (typeof baseValue == 'object')
                    allArgs[key] = Object.assign({}, baseValue, cmdValue);
                else
                    allArgs[key] = cmdValue;
            }

            const allOpts = getopts(argv, allArgs);

            const operandToOpt = Command.usage.operand;
            if (allOpts._.length >= 2 && operandToOpt)
                allOpts[operandToOpt] = allOpts._[1];

            function fetchOpts(Class) {
                const opts = {};
                for (const param in Class.usage.params)
                    opts[param] = allOpts[param];
                return opts;
            }

            opts = fetchOpts(this.constructor);
            const copts = fetchOpts(Command);

            if (opts.debug) {
                console.debug('Global options:'.magenta, opts);
                console.debug('Command options:'.magenta, copts);
            }

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

            await this.init(opts, !Command.skipConf);

            parameter('Workspace:', this.cfg.workspace);
            parameter('Remote:', this.cfg.remote || 'local');

            await this.run(Command, copts);
            await this.deinit();
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

    /**
     * Run myt command.
     * @param {Command} Command class reference
     * @param {Object} opts Command options
     * @returns Command execution result
     */
    async run(Command, opts) {
        const command = new Command(this, opts);
        if (this.cliMode)
            return await command.cli();
        else
            return await command.run();
    }

    /**
     * Initialize myt, should be called before running any command.
     * @param {Object} opts Myt options
     */
    async init(opts, loadConf) {
        const ctx = {version: packageJson.version};

        // Myt directory

        let subdir;
        const configFile = 'myt.config.yml';

        if (loadConf) {
            const checkDirs = ['.', 'myt', 'db'];
            for (const dir of checkDirs) {
                const cfgPath = path.join(opts.workspace, dir, configFile);
                if (await fs.pathExists(cfgPath)) {
                    subdir = dir;
                    break;
                }
            }

            if (!subdir)
                throw new Error (`Cannot find Myt config file '${configFile}': ${JSON.stringify(checkDirs)}`);
        } else {
            subdir = '.';
        }

        ctx.subdir = subdir;
        const mytDir = ctx.mytDir = path.join(opts.workspace, subdir);

        // Configuration file

        const defaultConfig = require(`${__dirname}/assets/myt.default.yml`);
        const cfg = Object.assign({}, defaultConfig);

        const configFiles = [
            configFile,
            'myt.local.yml'
        ];
        const mergeKeys = new Set([
            'privileges'
        ]);

        for (const file of configFiles) {
            const configPath = path.join(mytDir, file);
            if (!await fs.pathExists(configPath)) continue;

            const wsConfig = require(configPath);
            for (const key in wsConfig) {
                if (!mergeKeys.has(key)) {
                    cfg[key] = wsConfig[key];
                } else {
                    cfg[key] = Object.assign({},
                        cfg[key],
                        wsConfig[key]
                    );
                }
            }
        }

        Object.assign(cfg, opts);
        ctx.configFile = configFile;

        // Database configuration

        let iniDir = path.join(__dirname, 'assets');
        let iniFile = 'db.ini';

        if (cfg.remote) {
            iniDir = `${mytDir}/remotes`;
            iniFile = `${cfg.remote}.ini`;
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
                multipleStatements: true
            };
            const params = ['host', 'port', 'user', 'password'];
            for (const param of params) {
                if (iniConfig[param])
                    dbConfig[param] = iniConfig[param];
            }
            if (iniConfig.enable_cleartext_plugin) {
                dbConfig.authPlugins = {
                    mysql_clear_password() {
                        return () => iniConfig.password + '\0';
                    }
                };
            }
            if (iniConfig.ssl_ca) {
                dbConfig.ssl = {
                    ca: await fs.readFile(`${mytDir}/${iniConfig.ssl_ca}`),
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

        // Context configuration

        const routinesBaseRegex = subdir == '.'
            ? 'routines'
            : `${subdir}\/routines`;

        Object.assign(ctx, {
            iniFile,
            routinesRegex: new RegExp(`^${routinesBaseRegex}\/(.+)\.sql$`),
            routinesDir: path.join(mytDir, 'routines'),
            versionsDir: path.join(mytDir, 'versions'),
            structureDir: path.join(mytDir, 'structure'),
            dumpDir: path.join(mytDir, 'structure', '.dump'),
            fixturesDir: path.join(mytDir, 'fixtures'),
            realmsDir: path.join(mytDir, 'realms'),
            dockerDir: path.join(mytDir, 'docker'),
            isProtectedRemote: cfg.protectedRemotes?.includes(cfg.remote),
            isLocalRemote: cfg.localRemotes?.includes(cfg.remote)
        });

        if (cfg.debug)
            console.debug('Context:'.magenta, ctx);

        // Don't print sensitive data when debugging
        Object.assign(ctx, {dbConfig});

        this.ctx = ctx;
        this.cfg = cfg;
    }

    async deinit() {
        if (this.conn)
            await this.conn.end();
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

    async dbConnect() {
        if (this.conn)
            return this.conn;

        const {versionSchema} = this.cfg;
        const conn = this.conn = await this.createConnection();

        const [[schema]] = await conn.query(
            `SHOW DATABASES LIKE ?`, [versionSchema]
        );

        if (!schema)
            await conn.query(`CREATE DATABASE ??`, [versionSchema]);
        await conn.query(`USE ??`, [versionSchema]);

        const [[res]] = await conn.query(
            `SELECT COUNT(*) > 0 tableExists
                FROM information_schema.tables
                WHERE TABLE_SCHEMA = ?
                    AND TABLE_NAME = 'version'`,
            [versionSchema]
        );

        if (!res.tableExists) {
            const structure = await fs.readFile(
                `${__dirname}/assets/structure.sql`, 'utf8');
            await conn.query(structure);
        }

        const [[realm]] = await conn.query(
            `SELECT realm FROM versionConfig`
        );
        this.realm = realm;

        return this.conn;
    }

    async createConnection() {
        return await mysql.createConnection(this.ctx.dbConfig);
    }

    async fetchDbVersion() {
        const [[version]] = await this.conn.query(
            `SELECT number, gitCommit
                FROM version WHERE code = ?`,
            [this.cfg.code]
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

    async loadVersion(versionDir) {
        const {cfg, ctx} = this;

        const info = this.parseVersionDir(versionDir);
        if (!info) return null;

        const versionsDir = ctx.versionsDir;
        const scriptsDir = `${versionsDir}/${versionDir}`;
        const scriptList = await fs.readdir(scriptsDir);

        const [res] = await this.conn.query(
            `SELECT file, errorNumber IS NOT NULL hasError
                FROM versionLog
                WHERE code = ?
                    AND number = ?`,
            [cfg.code, info.number]
        );
        const versionLog = new Map();
        res.map(x => versionLog.set(x.file, x));

        let applyVersion = false;
        const scripts = [];

        for (const file of scriptList) {
            const match = file.match(scriptRegex);
            if (match) {
                const scriptRealm = match[1];
                const isUndo = !!match[2];

                if ((scriptRealm && scriptRealm !== this.realm) || isUndo)
                    continue;
            }

            const matchRegex = !!match;
            const logInfo = versionLog.get(file);
            const apply = !logInfo || logInfo.hasError;
            const push = apply && matchRegex;
            if (apply) applyVersion = true;

            scripts.push({
                file,
                matchRegex,
                apply,
                push
            });
        }

        return {
            number: info.number,
            name: info.name,
            scripts,
            apply: applyVersion
        };
    }

    async openRepo() {
        const {cfg} = this;

        if (!await fs.pathExists(`${cfg.workspace}/.git`))
            throw new Error ('Git not initialized');

        return await nodegit.Repository.open(cfg.workspace);
    }

    async getChanges(commitSha, committed) {
        const repo = await this.openRepo();
        const changes = [];
        const changesMap = new Map();

        const {ctx} = this;
        async function pushChanges(diff) {
            if (!diff) return;
            const patches = await diff.patches();

            for (const patch of patches) {
                const path = patch.newFile().path();
                const match = path.match(ctx.routinesRegex);
                if (!match) continue;

                let change = changesMap.get(match[1]);
                if (!change) {
                    change = {path: match[1]};
                    changes.push(change);
                    changesMap.set(match[1], change);
                }
                change.mark = patch.isDeleted() ? '-' : '+';
            }
        }

        const head = await repo.getHeadCommit();

        if (head && commitSha) {
            let commit;
            let notFound;

            try {
                commit = await repo.getCommit(commitSha);
                notFound = false;
            } catch (err) {
                if (err.errorFunction == 'Commit.lookup')
                    notFound = true;
                else
                    throw err;
            }

            if (notFound) {
                console.warn(`Database commit not found, trying git fetch`.yellow);
                await repo.fetchAll();
                commit = await repo.getCommit(commitSha);
            }

            const commitTree = await commit.getTree();

            const headTree = await head.getTree();
            const diff = await headTree.diff(commitTree);
            await pushChanges(diff);
        }

        if (!committed) {
            await pushChanges(await repoExt.getUnstaged(repo));
            await pushChanges(await repoExt.getStaged(repo));
        }

        return changes;
    }
}

module.exports = Myt;

if (require.main === module)
    new Myt().cli();
