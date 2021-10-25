
const MyVC = require('./myvc');
const fs = require('fs-extra');

class Init {
    get usage() {
        return {
            description: 'Initialize an empty workspace'
        };
    }

    async run(myvc, opts) {
        const templateDir = `${__dirname}/template`;
        const templates = await fs.readdir(templateDir);
        for (let template of templates) {
            const dst = `${opts.myvcDir}/${template}`;
            if (!await fs.pathExists(dst))
                await fs.copy(`${templateDir}/${template}`, dst);
        }
    }
}

module.exports = Init;

if (require.main === module)
    new MyVC().run(Init);
