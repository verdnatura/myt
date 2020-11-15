#!/bin/node
const execFileSync = require('child_process').execFileSync;
const spawn = require('child_process').spawn;

module.exports = function(command, workdir, ...args) {
    const buildArgs = [
        'build',
        '-t', 'myvc/client',
        '-f', `${__dirname}/Dockerfile.client`,
        `${__dirname}/`
    ];
    execFileSync('docker', buildArgs);

    let runArgs = [
        'run',
        '-v', `${workdir}:/workdir`,
        'myvc/client',
        command
    ];
    runArgs = runArgs.concat(args);

    const child = spawn('docker', runArgs, {
        stdio: [
            process.stdin,
            process.stdout,
            process.stderr
        ]
    });
    child.on('exit', code => process.exit(code));
};
