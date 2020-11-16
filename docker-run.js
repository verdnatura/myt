
const path = require('path');
const execFile = require('child_process').execFile;
const spawn = require('child_process').spawn;

module.exports = async function(command, workdir, ...args) {
    const buildArgs = [
        'build',
        '-t', 'myvc/client',
        '-f', path.join(__dirname, 'Dockerfile.client'),
        __dirname
    ];
    await new Promise((resolve, reject) => {
        execFile('docker', buildArgs, (err, stdout, stderr) => {
            if (err)
                return reject(err);
            resolve({stdout, stderr});
        });
    })

    let runArgs = [
        'run',
        '-v', `${workdir}:/workdir`,
        'myvc/client',
        command
    ];
    runArgs = runArgs.concat(args);

    await new Promise((resolve, reject) => {
        const child = spawn('docker', runArgs, {
            stdio: [
                process.stdin,
                process.stdout,
                process.stderr
            ]
        });
        child.on('exit', code => resolve(code));
    })
};
