
require('colors');
const getopts = require('getopts');
const package = require('./package.json');
const dockerRun = require('./docker-run');
const fs = require('fs-extra');
const path = require('path');
const ini = require('ini');

console.log('MyVC (MySQL Version Control)'.green, `v${package.version}`.magenta);

const argv = process.argv.slice(2);
const opts = getopts(argv, {
    alias: {
        env: 'e',
        workdir: 'w',
        help: 'h',
        version: 'v'
    },
    default: {
        workdir: process.cwd(),
        env: 'production'
    }
})

if (opts.version)
    process.exit(0);

function usage() {
    console.log('Usage:'.gray, 'myvc [-w|--workdir] [-e|--env] [-h|--help] action'.magenta);
    process.exit(0);
}
function error(message) {
    console.error('Error:'.gray, message.red);
    process.exit(1);
}
function parameter(parameter, value) {
    console.log(parameter.gray, value.blue);
}

const action = opts._[0];
if (!action) usage();

const actionArgs = {
    apply: {
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
const actionOpts = getopts(argv, actionArgs[action]);
Object.assign(opts, actionOpts);

parameter('Environment:', opts.env);
parameter('Workdir:', opts.workdir);
parameter('Action:', action);

// Configuration file

const configFile = 'myvc.config.json';
const configPath = path.join(opts.workdir, configFile);
if (!fs.existsSync(configPath)) 
    error(`Config file not found: ${configFile}`);
const config = require(configPath);

// Database configuration

let iniFile = 'db.ini';
let iniDir = __dirname;
if (opts.env) {
    iniFile = `db.${opts.env}.ini`;
    iniDir = opts.workdir;
}
const iniPath = path.join(iniDir, iniFile);

if (!fs.existsSync(iniPath))
    error(`Database config file not found: ${iniFile}`);

const iniConfig = ini.parse(fs.readFileSync(iniPath, 'utf8')).client;
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
        ca: fs.readFileSync(`${opts.workdir}/${iniConfig.ssl_ca}`),
        rejectUnauthorized: iniConfig.ssl_verify_server_cert != undefined
    }
}

// Actions

switch (action) {
    case 'structure':
        dockerRun('export-structure.sh', opts.workdir, configFile, iniFile);
        break;
    case 'fixtures':
        dockerRun('export-fixtures.sh', opts.workdir, configFile, iniFile);
        break;
    case 'routines':
        require('./export-routines')(opts, config, dbConfig);
        break;
    case 'apply':
        dockerRun('apply-changes.sh', opts.workdir, ...argv);
        break;
    case 'run': {
        const Docker = require('./docker');
        const container = new Docker(config.code, opts.workdir);
        container.run();
        break;
    }
    case 'start': {
        const Docker = require('./docker');
        const container = new Docker(config.code, opts.workdir);
        container.start();
        break;
    }
    default:
        usage();
}
