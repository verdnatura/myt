
const MyVC = require('./myvc');
const fs = require('fs-extra');

class Init {
    async run(myvc, opts) {
        const templateDir = `${__dirname}/template`;
        const templates = await fs.readdir(templateDir);
        for (let template of templates) {
            const dst = `${opts.workspace}/${template}`;
            if (!await fs.pathExists(dst))
                await fs.copy(`${templateDir}/${template}`, dst);
        }
    }
}

module.exports = Init;

if (require.main === module)
    new MyVC().run(Init);
