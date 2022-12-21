
const MyVC = require('./myvc');
const Command = require('./lib/command');
const fs = require('fs-extra');

/**
 * Cleans old applied versions.
 */
class Clean extends Command {
    static usage = {
        description: 'Cleans old applied versions'
    };

    static localOpts = {
        default: {
            remote: 'production'
        }
    };

    async run(myvc, opts) {
        await myvc.dbConnect();
        const version = await myvc.fetchDbVersion() || {};
        const number = version.number;

        const oldVersions = [];
        const versionDirs = await fs.readdir(opts.versionsDir);
        for (const versionDir of versionDirs) {
            const dirVersion = myvc.parseVersionDir(versionDir);
            if (!dirVersion) continue;

            if (parseInt(dirVersion.number) < parseInt(number))
                oldVersions.push(versionDir);
        }

        if (opts.maxOldVersions
        && oldVersions.length > opts.maxOldVersions) {
            oldVersions.splice(-opts.maxOldVersions);

            for (const oldVersion of oldVersions)
                await fs.remove(`${opts.versionsDir}/${oldVersion}`,
                    {recursive: true});

            console.log(`Old versions deleted: ${oldVersions.length}`);
        } else
            console.log(`No versions to delete.`);
    }
}

module.exports = Clean;

if (require.main === module)
    new MyVC().run(Clean);
