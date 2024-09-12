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
            purge: 'Whether to remove non-existent scripts from DB log'
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

    static reporter = {
        versionsArchived: function(nVersions) {
            if (nVersions)
                console.log(` -> ${nVersions} versions archived.`);
            else
                console.log(` -> No versions archived.`);
        },
        versionLogPurged: function(nPurged) {
            if (nPurged)
                console.log(` -> ${nPurged} changes purged from log.`);
            else
                console.log(` -> No logs purged.`);
        }
    };

    async run(myt, opts) {
        const conn = await myt.dbConnect();
        const archiveDir = path.join(opts.versionsDir, '.archive');

        const dbVersion = await myt.fetchDbVersion() || {};
        const number = parseInt(dbVersion.number);

        const oldVersions = [];
        const versionDirs = await fs.readdir(opts.versionsDir);
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

            for (const oldVersion of oldVersions) {
                const srcDir = path.join(opts.versionsDir, oldVersion);
                const dstDir = path.join(archiveDir, oldVersion);

                if (!await fs.pathExists(dstDir))
                    await fs.mkdir(dstDir);

                const scripts = await fs.readdir(srcDir);
                for (const script of scripts) {
                    await fs.move(
                        path.join(srcDir, script),
                        path.join(dstDir, script),
                        {overwrite: true}
                    );
                }

                await fs.rmdir(srcDir);
            }

            this.emit('versionsArchived', oldVersions.length);
        } else
            this.emit('versionsArchived');

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

            let nPurged = 0;
            for (const script of res) {
                const hasVersion = await versionDb.hasScript(script);
                const hasArchive = await archiveDb.hasScript(script);
    
                if (!hasVersion && !hasArchive) {
                    await conn.query(
                        `DELETE FROM versionLog
                            WHERE code = ? AND number = ? AND file = ?`,
                        [opts.code, script.number, script.file]
                    );
                    nPurged++;
                }
            }

            this.emit('versionLogPurged', nPurged);
        }
    }
}

class VersionDb {
    constructor(myt, baseDir) {
        Object.assign(this, {myt, baseDir});
    }

    async load() {
        const map = this.map = new Map();
        if (await fs.pathExists(this.baseDir)) {
            const dirs = await fs.readdir(this.baseDir);
            for (const dir of dirs) {
                const version = this.myt.parseVersionDir(dir);
                if (!version) continue;
                let subdirs = map.get(version.number);
                if (!subdirs) map.set(version.number, subdirs = []);
                subdirs.push(dir);
            }
        }
        return map;
    }

    async hasScript(script) {
        const dirs = this.map.get(script.number);
        if (dirs)
            for (const dir of dirs) {
                const scriptPath = path.join(this.baseDir, dir, script.file);
                if (await fs.pathExists(scriptPath)) return true;
            }
        return false;
    }
}

module.exports = Clean;

if (require.main === module)
    new Myt().cli(Clean);
