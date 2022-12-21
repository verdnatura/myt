const spawn = require('child_process').spawn;
const execFile = require('child_process').execFile;
const camelToSnake = require('./util').camelToSnake;

const docker = {
    async run(image, commandArgs, options, execOptions) {
        const args = commandArgs
            ? [image].concat(commandArgs)
            : image;
        const execMode = options.detach ? 'exec' : 'spawn';
        
        const child = await this.command('run',
            args,
            options,
            execMode,
            execOptions
        );
        return options.detach
            ? new Container(child.stdout.trim())
            : child;
    },

    async build(url, options, execOptions) {
        return await this.command('build',
            url,
            options,
            'spawn',
            execOptions
        );
    },

    async start(id, options) {
        const ct = new Container(id);
        await ct.start(options);
        return ct;
    },

    async stop(id, options) {
        const ct = new Container(id);
        return await ct.stop(options);
    },

    async rm(id, options) {
        const ct = new Container(id);
        return await ct.rm(options);
    },

    async inspect(id, options) {
        const ct = new Container(id);
        return await ct.inspect(options);
    },

    async command(command, args, options, execMode, execOptions) {
        const execArgs = [command];

        if (options)
            for (const option in options) {
                execArgs.push(`--${camelToSnake(option)}`);
                if (typeof options[option] !== 'boolean')
                    execArgs.push(options[option]);
            }

        if (Array.isArray(args))
            Array.prototype.push.apply(execArgs, args);
        else if (args)
            execArgs.push(args);

        return await new Promise((resolve, reject) => {
            if (execMode == 'spawn') {
                if (execOptions === true)
                    execOptions = {
                        stdio: [
                            process.stdin,
                            process.stdout,
                            process.stderr
                        ] 
                    };

                const child = spawn('docker', execArgs, execOptions || undefined);
                child.on('exit', code => {
                    if (code !== 0) {
                        const quotedArgs = execArgs
                            .map(x => /\s/g.test(x) ? `"${x}"` : x)
                            .join(' ');
                        reject(new Error(`Docker exit code ${code}: 'docker ${quotedArgs}'`));
                    } else
                        resolve(code);
                });
            } else {
                execFile('docker', execArgs, (err, stdout, stderr) => {
                    if (err)
                        reject(err);
                    else
                        resolve({stdout, stderr});
                });
            }
        });
    }
};

class Container {
    constructor(id) {
        if (!id)
            throw new Error('Container id argument is required');
        this.id = id;
    }

    async start(options) {
        await docker.command('start', this.id, options);
    }

    async stop(options) {
        await docker.command('stop', this.id, options);
    }

    async rm(options) {
        await docker.command('rm', this.id, options);
    }

    async inspect(options) {
        const child = await docker.command('inspect', this.id, options);
        return JSON.parse(child.stdout);
    }

    async exec(options, command, commandArgs, execMode, execOptions) {
        let args = [this.id, command];
        if (commandArgs) args = args.concat(commandArgs);
        await docker.command('exec', args, options, execMode, execOptions);
    }
}

module.exports = docker;
module.exports.Container = Container;
