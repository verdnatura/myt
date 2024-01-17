const Myt = require('./myt');
const Command = require('./lib/command');
const fs = require('fs-extra');
const path = require('path');

/**
 * Cleans old applied versions.
 */
class Clean extends Command {
    static usage = {
        description: 'Cleans old applied versions',
        params: {
            purge: 'Wether to remove non-existent scripts from DB log'
        }
    };

    static opts = {
        alias: {
            purge: 'p'
        },
        boolean: [
            'purge'
        ],
        default: {
            remote: 'production'
        }
    };

    async run(myt, opts) {
        const conn = await myt.dbConnect();
        const versionDirs = await fs.readdir(opts.versionsDir);
        const archiveDir = path.join(opts.versionsDir, '.archive');

        const dbVersion = await myt.fetchDbVersion() || {};
        const number = parseInt(dbVersion.number);

        const oldVersions = [];
        for (const versionDir of versionDirs) {
            const version = await myt.loadVersion(versionDir);
            const shouldArchive = version
                && !version.apply
                && parseInt(version.number) < number;

            if (shouldArchive)
                oldVersions.push(versionDir);
        }

        if (opts.maxOldVersions
        && oldVersions.length > opts.maxOldVersions) {
            oldVersions.splice(-opts.maxOldVersions);

            if (!await fs.pathExists(archiveDir))
                await fs.mkdir(archiveDir);

            for (const oldVersion of oldVersions)
                await fs.move(
                    path.join(opts.versionsDir, oldVersion),
                    path.join(archiveDir, oldVersion)
                );

            console.log(`Old versions archived: ${oldVersions.length}`);
        } else
            console.log(`No versions to archive.`);

        if (opts.purge) {
            const versionDb = new VersionDb(myt, opts.versionsDir);
            versionDb.load();

            const archiveDb = new VersionDb(myt, archiveDir);
            archiveDb.load();

            const [res] = await conn.query(
                `SELECT number, file FROM versionLog
                    WHERE code = ?
                    ORDER BY number, file`,
                [opts.code]
            );

            for (const script of res) {
                const hasVersion = await versionDb.hasScript(script);
                const hasArchive = await archiveDb.hasScript(script);
    
                if (!hasVersion && !hasArchive) {
                    await conn.query(
                        `DELETE FROM versionLog
                            WHERE code = ? AND number = ? AND file = ?`,
                        [opts.code, script.number, script.file]
                    );
                }
            }
        }
    }
}

class VersionDb {
    constructor(myt, baseDir) {
        Object.assign(this, {myt, baseDir});
    }

    async load() {
        const versionMap = this.versionMap = new Map();
        if (await fs.pathExists(this.baseDir)) {
            const dirs = await fs.readdir(this.baseDir);
            for (const dir of dirs) {
                const version = this.myt.parseVersionDir(dir);
                if (!version) continue;
                versionMap.set(version.number, dir);
            }
        }
        return versionMap;
    }

    async hasScript(script) {
        const dir = this.versionMap.get(script.number);
        if (!dir) return false;
        const scriptPath = path.join(this.baseDir, dir, script.file);
        return await fs.pathExists(scriptPath);
    }
}

module.exports = Clean;

if (require.main === module)
    new Myt().run(Clean);
