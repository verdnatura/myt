
require('colors');
const getopts = require('getopts');
const package = require('./package.json');
const fs = require('fs-extra');
const ini = require('ini');
const path = require('path');
const dockerRun = require('./docker-run');

console.log('MyVC (MySQL Version Control)'.green, `v${package.version}`.magenta);

const argv = process.argv.slice(2);
const cliOpts = getopts(argv, {
    alias: {
        env: 'e',
        workspace: 'w',
        help: 'h',
        version: 'v'
    },
    default: {
        workspace: process.cwd(),
        env: 'production'
    }
})

if (cliOpts.version)
    process.exit(0);

const command = cliOpts._[0];
if (!command) {
    console.log('Usage:'.gray, '[npx] myvc [-w|--workspace] [-e|--env] [-h|--help] command'.blue);
    process.exit(0);
}

const commandArgs = {
    push: {
        alias: {
            force: 'f',
            user: 'u'
        },
        default: {
            force: false,
            user: false,
            env: 'test'
        }
    }
};
const commandOpts = getopts(argv, commandArgs[command]);
Object.assign(cliOpts, commandOpts);

const opts = {};
for (let opt in cliOpts) {
    if (opt.length > 1 || opt == '_')
        opts[opt] = cliOpts[opt];
}

function parameter(parameter, value) {
    console.log(parameter.gray, value.blue);
}

parameter('Environment:', opts.env);
parameter('Workspace:', opts.workspace);
parameter('Command:', command);

class MyVC {
    async init(opts) {
        // Configuration file
        
        const configFile = 'myvc.config.json';
        const configPath = path.join(opts.workspace, configFile);
        if (!await fs.pathExists(configPath)) 
            throw new Error(`Config file not found: ${configFile}`);
        const config = require(configPath);

        Object.assign(opts, config);
        opts.configFile = configFile;
        
        // Database configuration
        
        let iniFile = 'db.ini';
        let iniDir = __dirname;
        if (opts.env) {
            iniFile = `db.${opts.env}.ini`;
            iniDir = opts.workspace;
        }
        const iniPath = path.join(iniDir, iniFile);
        
        if (!await fs.pathExists(iniPath))
            throw new Error(`Database config file not found: ${iniFile}`);
        
        const iniConfig = ini.parse(await fs.readFile(iniPath, 'utf8')).client;
        const dbConfig = {
            host: !opts.env ? 'localhost' : iniConfig.host,
            port: iniConfig.port,
            user: iniConfig.user,
            password: iniConfig.password,
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

        Object.assign(opts, {
            iniFile,
            dbConfig
        });
    }

    async pull(opts) {
        const pull = require('./myvc-pull');
        await pull(
            opts.workspace,
            opts.schemas,
            opts.dbConfig
        );
    }

    async push(opts) {
        let args = [];
        if (opts.force) args.push('-f');
        if (opts.user) args.push('-u');
        if (opts.env) args = args.concat(['-e', opts.env]);

        await dockerRun('myvc-push.sh',
            opts.workspace,
            ...args
        );
    }

    async dump (opts) {
        await dockerRun('myvc-dump.sh',
            opts.workspace,
            opts.configFile,
            opts.iniFile
        );
    }

    async run(opts) {
        const Docker = require('./docker');
        const container = new Docker(opts.code, opts.workspace);
        await container.run();
    }

    async start(opts) {
        const Docker = require('./docker');
        const container = new Docker(opts.code, opts.workspace);
        await container.start();
    }
}

(async function() {
    try {
        const myvc = new MyVC();

        if (myvc[command]) {
            await myvc.init(opts);
            await myvc[command](opts);
        } else
            throw new Error (`Unknown command '${command}'`);
    } catch (err) {
        if (err.name == 'Error')
            console.error('Error:'.gray, err.message.red);
        else
            throw err;
    }
})();

module.exports = MyVC;
