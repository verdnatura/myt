
require('colors');
const getopts = require('getopts');
const package = require('./package.json');
const dockerRun = require('./docker-run');
const fs = require('fs-extra');

console.log('MyVC (MySQL Version Control)'.green, `v${package.version}`.blue);

const options = getopts(process.argv.slice(2), {
    alias: {
        dir: 'd',
        env: 'e',
        help: 'h',
        version: 'v'
    },
    default: {}
})

function usage() {
    console.log('Usage:'.gray, 'myvc [-d|--dir] [-e|--env] [-h|--help] action'.magenta);
    process.exit(0);
}

if (options.help) usage();
if (options.version) process.exit(0);

let config;
let container;

let action = options._[0];
if (action) {
    console.log('Action:'.gray, action.magenta);

    const configFile = 'myvc.config.json';
    if (!fs.existsSync(configFile)) {
        console.error('Error:'.gray, `Config file '${configFile}' not found in working directory`.red);
        process.exit(1);
    }

    config = require(`${process.cwd()}/${configFile}`);
}

switch (action) {
    case 'structure':
        dockerRun('export-structure.sh');
        break;
    case 'fixtures':
        dockerRun('export-fixtures.sh');
        break;
    case 'routines':
        require('./export-routines');
        break;
    case 'apply':
        dockerRun('apply-changes.sh');
        break;
    case 'run': {
        const Docker = require('./docker');
        container = new Docker();
        container.run();
        break;
    }
    case 'start': {
        const Docker = require('./docker');
        container = new Docker();
        container.start();
        break;
    }
    default:
        usage();
}
