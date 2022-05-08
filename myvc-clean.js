
const MyVC = require('./myvc');
const fs = require('fs-extra');

/**
 * Cleans old applied versions.
 */
class Clean {
    get usage() {
        return {
            description: 'Cleans old applied versions'
        };
    }

    get localOpts() {
        return {
            default: {
                remote: 'production'
            }
        };
    }

    async run(myvc, opts) {
        await myvc.dbConnect();
        const version = await myvc.fetchDbVersion() || {};
        const number = version.number;

        const verionsDir =`${opts.myvcDir}/versions`;
        const oldVersions = [];
        const versionDirs = await fs.readdir(verionsDir);
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
                await fs.remove(`${verionsDir}/${oldVersion}`,
                    {recursive: true});

            console.log(`Old versions deleted: ${oldVersions.length}`);
        } else
            console.log(`No versions to delete.`);
    }
}

module.exports = Clean;

if (require.main === module)
    new MyVC().run(Clean);
