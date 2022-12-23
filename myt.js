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
const docker = require('./lib/docker');
const Command = require('./lib/command');

class Myt {
    get usage() {
        return {
            description: 'Utility for database versioning',
            params: {
                remote: 'Name of remote to use',
                workspace: 'The base directory of the project',
                socket: 'Wether to connect to database via socket',
                debug: 'Wether to enable debug mode',
                version: 'Display the version number and exit',
                help: 'Display this help message'
            }
        };
    }

    get localOpts() {
        return {
            alias: {
                remote: 'r',
                workspace: 'w',
                socket: 'k',
                debug: 'd',
                version: 'v',
                help: 'h'
            },
            boolean: [
                'debug',
                'version',
                'help'
            ],
            default: {
                workspace: process.cwd()
            }
        };
    }

    async run(CommandClass) {
        console.log(
            'Myt'.green,
            `v${packageJson.version}`.magenta
        );

        const baseOpts = this.localOpts;
        const opts = this.getopts(baseOpts);

        if (opts.debug) {
            console.warn('Debug mode enabled.'.yellow);
            console.log('Global options:'.magenta, opts);
        }

        if (opts.version)
            process.exit(0);

        try {
            const commandName = opts._[0];
            if (!CommandClass && commandName) {
                if (!/^[a-z]+$/.test(commandName))
                    throw new Error (`Invalid command name '${commandName}'`);

                const commandFile = path.join(__dirname, `myt-${commandName}.js`);

                if (!await fs.pathExists(commandFile))
                    throw new Error (`Unknown command '${commandName}'`);
                CommandClass = require(commandFile);
            }

            if (!CommandClass) {
                this.showHelp(baseOpts, this.usage);
                process.exit(0);
            }

            const allOpts = Object.assign({}, baseOpts);

            if (CommandClass.localOpts)
            for (const key in CommandClass.localOpts) {
                const baseValue = baseOpts[key];
                const cmdValue = CommandClass.localOpts[key];
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

            const operandToOpt = CommandClass.usage.operand;
            if (opts._.length >= 2 && operandToOpt)
                opts[operandToOpt] = opts._[1];

            if (opts.debug)
                console.log('Final options:'.magenta, opts);

            if (opts.help) {
                this.showHelp(CommandClass.localOpts, CommandClass.usage, commandName);
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
                        .dependencies
                        .myt.match(versionRegex);
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
            await this.runCommand(CommandClass, opts);
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

    async runCommand(CommandClass, opts) {
        const command = new CommandClass();
        command.opts = opts;
        return await command.run(this, opts);
    }

    async load(opts) {
        // Configuration file

        const config = require(`${__dirname}/assets/myt.default.yml`);
        
        const configFile = 'myt.config.yml';
        const configPath = path.join(opts.workspace, configFile);
        if (await fs.pathExists(configPath))
            Object.assign(config, require(configPath));

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
            const iniConfig = ini.parse(await fs.readFile(iniPath, 'utf8')).client;
            dbConfig = {
                host: iniConfig.host,
                port: iniConfig.port,
                user: iniConfig.user,
                password: iniConfig.password,
                multipleStatements: true,
                authPlugins: {
                    mysql_clear_password() {
                        return () => iniConfig.password + '\0';
                    }
                }
            };
            if (iniConfig.ssl_ca) {
                dbConfig.ssl = {
                    ca: await fs.readFile(`${opts.mytDir}/${iniConfig.ssl_ca}`),
                    rejectUnauthorized: iniConfig.ssl_verify_server_cert != undefined
                }
            }
        } catch(err) {
            const newErr = Error(`Cannot process the ini file, check that the syntax is correct: ${iniPath}`);
            newErr.stack += `\nCaused by: ${err.stack}`;
            throw newErr;
        }

        if (opts.socket)
            dbConfig.socketPath = '/var/run/mysqld/mysqld.sock';

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

    async changedRoutines(commitSha) {
        const repo = await this.openRepo();
        const changes = [];
        const changesMap = new Map();

        async function pushChanges(diff) {
            if (!diff) return;
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

        await pushChanges(await this.getUnstaged(repo));
        await pushChanges(await this.getStaged(repo));

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

    async initDump(dumpFile) {
        const dumpDir = this.opts.dumpDir;
        if (!await fs.pathExists(dumpDir))
            await fs.mkdir(dumpDir);

        const dumpPath = path.join(dumpDir, dumpFile);

        // FIXME: If it's called after docker.build() statement it creates an 
        // "invalid" WriteStream
        const dumpStream = await fs.createWriteStream(dumpPath);

        await docker.build(__dirname, {
            tag: 'myt/client',
            file: path.join(__dirname, 'server', 'Dockerfile.client')
        }, this.opts.debug);

        return dumpStream;
    }

    async dumpFixtures(dumpStream, tables, replace) {
        const fixturesArgs = [
            '--no-create-info',
            '--skip-triggers',
            '--skip-extended-insert',
            '--skip-disable-keys',
            '--skip-add-locks',
            '--skip-set-charset',
            '--skip-comments',
            '--skip-tz-utc'
        ];

        if (replace)
            fixturesArgs.push('--replace');

        for (const schema in tables) {
            const escapedSchema = '`'+ schema.replace('`', '``') +'`';
            await dumpStream.write(
                `USE ${escapedSchema};\n`,
                'utf8'
            );

            const args = fixturesArgs.concat([schema], tables[schema]);
            await this.runDump('mysqldump', args, dumpStream);
        }
    }

    async runDump(command, args, dumpStream) {
        const iniPath = path.join(this.opts.subdir || '', 'remotes', this.opts.iniFile);
        const myArgs = [
            `--defaults-file=${iniPath}`
        ];
        const execOptions = {
            stdio: [
                process.stdin,
                dumpStream,
                process.stderr
            ] 
        };
        const commandArgs = [command].concat(myArgs, args);
        await docker.run('myt/client', commandArgs, {
            addHost: 'host.docker.internal:host-gateway',
            volume: `${this.opts.mytDir}:/workspace`,
            rm: true
        }, execOptions);
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

    /**
     * Executes an SQL script.
     *
     * @param {Connection} conn MySQL connection object
     * @returns {Array<Result>} The resultset
     */
    async queryFromFile(conn, file) {
        const sql = await fs.readFile(file, 'utf8');
        return await this.multiQuery(conn, sql);
    }

    /**
     * Executes a multi-query string.
     *
     * @param {Connection} conn MySQL connection object
     * @param {String} sql SQL multi-query string
     * @returns {Array<Result>} The resultset
     */
    async multiQuery(conn, sql) {
        let results = [];
        const stmts = this.querySplit(sql);

        for (const stmt of stmts)
            results = results.concat(await conn.query(stmt));

        return results;
    }

    /**
     * Splits an SQL muti-query into a single-query array, it does an small 
     * parse to correctly handle the DELIMITER statement.
     *
     * @param {Array<String>} stmts The splitted SQL statements
     */
    querySplit(sql) {
        const stmts = [];
        let i,
            char,
            token,
            escaped,
            stmtStart;

        let delimiter = ';';
        const delimiterRe = /\s*delimiter\s+(\S+)[^\S\r\n]*(?:\r?\n|\r|$)/yi;

        function begins(str) {
            let j;
            for (j = 0; j < str.length; j++)
                if (sql[i + j] != str[j])
                    return false;
            i += j;
            return true;
        }

        for (i = 0; i < sql.length;) {
            stmtStart = i;

            delimiterRe.lastIndex = i;
            const match = sql.match(delimiterRe);
            if (match) {
                delimiter = match[1];
                i += match[0].length;
                continue;
            }

            let delimiterFound = false;
            while (i < sql.length) {
                char = sql[i];

                if (token) {
                    if (!escaped && begins(token.end))
                        token = null;
                    else {
                        escaped = !escaped && token.escape(char);
                        i++;
                    }
                } else {
                    delimiterFound = begins(delimiter);
                    if (delimiterFound) break;

                    const tok = tokenIndex.get(char);
                    if (tok && begins(tok.start))
                        token = tok;
                    else
                        i++;
                }
            }

            let len = i - stmtStart;
            if (delimiterFound) len -= delimiter.length;
            const stmt = sql.substr(stmtStart, len);

            if (!/^\s*$/.test(stmt))
                stmts.push(stmt);
        }

        return stmts;
    }
}

const tokens = {
    string: {
        start: '\'',
        end: '\'',
        escape: char => char == '\'' || char == '\\'
    },
    quotedString: {
        start: '"',
        end: '"',
        escape: char => char == '"' || char == '\\'
    },
    id: {
        start: '`',
        end: '`',
        escape: char => char == '`'
    },
    multiComment: {
        start: '/*',
        end: '*/',
        escape: () => false
    },
    singleComment: {
        start: '-- ',
        end: '\n',
        escape: () => false
    }
};

const tokenIndex = new Map();
for (const tokenId in tokens) {
    const token = tokens[tokenId];
    tokenIndex.set(token.start[0], token);
}

module.exports = Myt;

if (require.main === module)
    new Myt().run();
