
const getopts = require('getopts');
const colors = require('colors');
const package = require('./package.json');
const dockerRun = require('./docker-run');

const options = getopts(process.argv.slice(2), {
    alias: {
        dir: 'd',
        env: 'e',
        help: 'h'
    },
    default: {}
})

if (options.help) {
    console.log('usage: myvc [-d|--dir] [-e|--env] [-h|--help] action');
    process.exit(0)
}

let action = options._[0];
console.log('MyVC (MySQL Version Control)'.green, `v${package.version}`.blue);
console.log('Action:'.gray, action.magenta);

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
}
