const Myt = require('./myt');
const Command = require('./lib/command');
const fs = require('fs-extra');

class Init extends Command {
    static usage = {
        description: 'Initialize an empty workspace'
    };

    async run(myt, opts) {
        const templateDir = `${__dirname}/template`;
        const templates = await fs.readdir(templateDir);
        for (let template of templates) {
            const dst = `${opts.mytDir}/${template}`;
            if (!await fs.pathExists(dst))
                await fs.copy(`${templateDir}/${template}`, dst);
        }
    }
}

module.exports = Init;

if (require.main === module)
    new Myt().run(Init);
