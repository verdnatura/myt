const Myt = require('./myt');
const Command = require('./lib/command');
const fs = require('fs-extra');
const path = require('path');

/**
 * Cleans old applied versions.
 */
class Clean extends Command {
    static usage = {
        description: 'Cleans old applied versions'
    };

    static opts = {
        default: {
            remote: 'production'
        }
    };

    async run(myt, opts) {
        await myt.dbConnect();
        const version = await myt.fetchDbVersion() || {};
        const number = version.number;

        const oldVersions = [];
        const versionDirs = await fs.readdir(opts.versionsDir);
        for (const versionDir of versionDirs) {
            const dirVersion = myt.parseVersionDir(versionDir);
            if (!dirVersion) continue;

            if (parseInt(dirVersion.number) < parseInt(number))
                oldVersions.push(versionDir);
        }

        if (opts.maxOldVersions
        && oldVersions.length > opts.maxOldVersions) {
            oldVersions.splice(-opts.maxOldVersions);

            const archiveDir = path.join(opts.versionsDir, '.archive');
            if (!await fs.pathExists(archiveDir))
                await fs.mkdir(archiveDir);

            for (const oldVersion of oldVersions)
                await fs.move(
                    path.join(opts.versionsDir, oldVersion),
                    path.join(archiveDir, oldVersion)
                );

            console.log(`Old versions deleted: ${oldVersions.length}`);
        } else
            console.log(`No versions to delete.`);
    }
}

module.exports = Clean;

if (require.main === module)
    new Myt().run(Clean);
