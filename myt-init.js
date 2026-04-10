const Myt = require('./myt');
const Command = require('./lib/command');
const fs = require('fs-extra');
const path = require('path');

class Init extends Command {
    static usage = {
        description: 'Initialize an empty workspace'
    };

    async _run(myt, ctx, cfg, opts) {
        const packageFile = path.join(ctx.mytDir, 'package.json');
        const packageExists = await fs.pathExists(packageFile);

        const templateDir = path.join(__dirname, 'template');
        const templates = await fs.readdir(templateDir);
        for (let template of templates) {
            const dst = path.join(ctx.mytDir, template);
            if (!await fs.pathExists(dst))
                await fs.copy(path.join(templateDir, template), dst);
        }

        if (!packageExists) {
            const packageJson = require(packageFile);
            packageJson.dependencies[myt.packageJson.name] =
                `^${myt.packageJson.version}`;
            await fs.writeFile(packageFile,
                JSON.stringify(packageJson, null, '  '));
        }
    }
}

module.exports = Init;

if (require.main === module)
    new Myt().cli(Init);
