#!/bin/node
const execFileSync = require('child_process').execFileSync;
const spawn = require('child_process').spawn;

module.exports = function(command) {
    const buildArgs = [
        'build',
        '-t', 'vn-db-client',
        '-f', `${__dirname}/Dockerfile.client`,
        `${__dirname}/`
    ];
    execFileSync('docker', buildArgs);

    let args = [
        'run',
        '-v', `${process.cwd()}:/workdir`,
        'vn-db-client',
        command
    ];
    args = args.concat(process.argv.slice(2));

    const child = spawn('docker', args, {
        stdio: [
            process.stdin,
            process.stdout,
            process.stderr
        ]
    });
    child.on('exit', code => process.exit(code));
};
