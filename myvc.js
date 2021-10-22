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
            multipleStatements: true,
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

    async changedRoutines(commitSha) {
        const repo = await this.openRepo();
        const changes = [];
        const changesMap = new Map();

        async function pushChanges(diff) {
            const patches = await diff.patches();

            for (const patch of patches) {
                const path = patch.newFile().path();
                const match = path.match(/^routines\/(.+)\.sql$/);
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
            const commit = await repo.getCommit(commitSha);
            const commitTree = await commit.getTree();

            const headTree = await head.getTree();
            const diff = await headTree.diff(commitTree);
            await pushChanges(diff);
        }

        await pushChanges(await this.getUnstaged(repo));

        const stagedDiff = await this.getStaged(repo);
        if (stagedDiff) await pushChanges(stagedDiff);

        return changes.sort((a, b) => {
            if (b.mark != a.mark)
                return b.mark == '-' ? 1 : -1;
            return a.path.localeCompare(b.path);
            
        });
    }

    async openRepo() {
        const {opts} = this;

        if (!await fs.pathExists(`${opts.workspace}/.git`))
            throw new Error ('Git not initialized');

        return await nodegit.Repository.open(opts.workspace);
    }

    async getStaged(repo) {
        const head = await repo.getHeadCommit();

        try {
            const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
            const headTree = await (head
                ? head.getTree()
                : nodegit.Tree.lookup(repo, emptyTree)
            );
            return await nodegit.Diff.treeToIndex(repo, headTree, null);
        } catch (err) {
            console.warn('Cannot fetch staged changes:', err.message);
        }
    }

    async getUnstaged(repo) {
        return await nodegit.Diff.indexToWorkdir(repo, null, {
            flags: nodegit.Diff.OPTION.SHOW_UNTRACKED_CONTENT
                | nodegit.Diff.OPTION.RECURSE_UNTRACKED_DIRS
        });
    }

    async cachedChanges() {
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

        const changes = [];
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
