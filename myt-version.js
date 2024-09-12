const Myt = require('./myt');
const Command = require('./lib/command');
const fs = require('fs-extra');
const SqlString = require('sqlstring');

/**
 * Creates a new version.
 */
class Version extends Command {
    static usage = {
        description: 'Creates a new version',
        params: {
            name: 'Name for the new version',
            deprecate: 'Whether to generate sql to delete deprecated objects'
        },
        operand: 'name'
    };

    static opts = {
        alias: {
            name: 'n',
            deprecate: 'p'
        },
        string: [
            'name'
        ],
        boolean: [
            'deprecate'
        ],
        default: {
            remote: 'production'
        }
    };

    static reporter = {
        dbInfo: function(number, lastNumber) {
            console.log(
                `Database information:`
                + `\n -> Version: ${number}`
                + `\n -> Last version: ${lastNumber}`
            );
        },
        versionCreated: function(versionName) {
            console.log(`New version created: ${versionName}`);
        },
        deprecate: 'Generating SQL for deprecated objects deletion.'
    };

    async run(myt, opts) {
        let newVersionDir;

        // Fetch last version number

        const conn = await myt.dbConnect();

        try {
            await conn.query('START TRANSACTION');

            const [[row]] = await conn.query(
                `SELECT number, lastNumber
                    FROM version
                    WHERE code = ?
                    FOR UPDATE`,
                [opts.code]
            );
            const number = row && row.number;
            const lastNumber = row && row.lastNumber;
            this.emit('dbInfo', number, lastNumber);

            let newVersion;
            if (lastNumber)
                newVersion = Math.max(
                    parseInt(number) || 0,
                    parseInt(lastNumber) || 0
                ) + 1;
            else
                newVersion = 1;

            const versionDigits = number
                ? number.length
                : opts.versionDigits;

            newVersion = String(newVersion).padStart(versionDigits, '0');

            // Get version name

            let versionName = opts.name;

            const versionNames = new Set();
            const versionDirs = await fs.readdir(opts.versionsDir);
            for (const versionDir of versionDirs) {
                const version = myt.parseVersionDir(versionDir);
                if (!version) continue;
                versionNames.add(version.name);
            }

            if (!versionName) {
                let attempts;
                const maxAttempts = 1000;

                for (attempts = 0; attempts < maxAttempts; attempts++) {
                    versionName = randomName();
                    if (!versionNames.has(versionName)) break;
                }

                if (attempts === maxAttempts)
                    throw new Error(`Cannot create a unique version name after ${attempts} attempts`);
            } else {
                const isNameValid = typeof versionName === 'string'
                    && /^[a-zA-Z0-9]+$/.test(versionName);
                if (!isNameValid)
                    throw new Error('Version name can only contain letters or numbers');
                if (versionNames.has(versionName))
                    throw new Error('Version with same name already exists');
            }

            // Create version

            const versionFolder = `${newVersion}-${versionName}`;
            newVersionDir = `${opts.versionsDir}/${versionFolder}`;

            await conn.query(
                `INSERT INTO version
                    SET code = ?,
                        lastNumber = ?
                    ON DUPLICATE KEY UPDATE
                        lastNumber = VALUES(lastNumber)`,
                [opts.code, newVersion]
            );
            await fs.mkdir(newVersionDir);

            if (opts.deprecate) {
                this.emit('deprecate');
                await deprecate(conn, opts, newVersionDir);
            } else
                await fs.writeFile(
                    `${newVersionDir}/00-firstScript.sql`,
                    '-- Place your SQL code here\n'
                );

            this.emit('versionCreated', versionFolder);

            await conn.query('COMMIT');
        } catch (err) {
            await conn.query('ROLLBACK');
            if (newVersionDir && await fs.pathExists(newVersionDir))
                await fs.remove(newVersionDir);
            throw err;
        }
    }
}

async function deprecate(conn, opts, newVersionDir) {
    const now = new Date();
    const minDeprecDate = new Date(now.getTime() - opts.deprecRetentionPeriod * 24 * 60 * 60 * 1000);    
    const deprecMarkRegex = opts.deprecMarkRegex;
    const deprecCommentRegex = opts.deprecCommentRegex;
    const deprecDateRegex = opts.deprecDateRegex;
    const filePath = `${newVersionDir}/00-deprecate.sql`;

    // Generate the drops of the primary keys
    const [primaryKeys] = await conn.query(`
        SELECT c.TABLE_SCHEMA 'schema', c.TABLE_NAME 'table'
            FROM information_schema.COLUMNS c
                LEFT JOIN information_schema.VIEWS v ON v.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND v.TABLE_NAME = c.TABLE_NAME
                JOIN information_schema.STATISTICS s ON s.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND s.TABLE_NAME = c.TABLE_NAME
                    AND s.COLUMN_NAME = c.COLUMN_NAME
            WHERE c.COLUMN_NAME REGEXP ? COLLATE utf8mb4_unicode_ci
                AND c.COLUMN_COMMENT REGEXP ? COLLATE utf8mb4_unicode_ci
                AND REGEXP_SUBSTR(c.COLUMN_COMMENT, ? COLLATE utf8mb4_unicode_ci) < ?
                AND v.TABLE_NAME IS NULL
                AND s.INDEX_NAME = 'PRIMARY'
    `, [deprecMarkRegex, deprecCommentRegex, deprecDateRegex, minDeprecDate]);

    primaryKeys.map(async row => {
        await fs.appendFile(
            filePath,
            'ALTER TABLE ' + SqlString.escapeId(row.schema, true) + '.' +
                SqlString.escapeId(row.table, true) + ' DROP PRIMARY KEY;\n'
        );
    });

    // Generate the drops of the foreign keys
    const [foreignKeys] = await conn.query(`
        SELECT c.TABLE_SCHEMA 'schema', c.TABLE_NAME 'table', kcu.CONSTRAINT_NAME 'constraint'
            FROM information_schema.COLUMNS c
                LEFT JOIN information_schema.VIEWS v ON v.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND v.TABLE_NAME = c.TABLE_NAME
                JOIN information_schema.KEY_COLUMN_USAGE kcu ON kcu.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND kcu.TABLE_NAME = c.TABLE_NAME
                    AND kcu.COLUMN_NAME = c.COLUMN_NAME
            WHERE c.COLUMN_NAME REGEXP ? COLLATE utf8mb4_unicode_ci
                AND c.COLUMN_COMMENT REGEXP ? COLLATE utf8mb4_unicode_ci
                AND REGEXP_SUBSTR(c.COLUMN_COMMENT, ? COLLATE utf8mb4_unicode_ci) < ?
                AND v.TABLE_NAME IS NULL
                AND kcu.REFERENCED_COLUMN_NAME IS NOT NULL
    `, [deprecMarkRegex, deprecCommentRegex, deprecDateRegex, minDeprecDate]);

    foreignKeys.map(async row => {
        await fs.appendFile(
            filePath,
            'ALTER TABLE ' + SqlString.escapeId(row.schema, true) + '.' + 
                SqlString.escapeId(row.table, true) + ' DROP FOREIGN KEY ' + 
                SqlString.escapeId(row.constraint, true) + ';\n'
        );
    });

    // Generate the drops of the columns
    const [columns] = await conn.query(`
        SELECT c.TABLE_SCHEMA 'schema', c.TABLE_NAME 'table', c.COLUMN_NAME 'column'
            FROM information_schema.COLUMNS c
                LEFT JOIN information_schema.VIEWS v ON v.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND v.TABLE_NAME = c.TABLE_NAME
                LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu ON kcu.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND kcu.TABLE_NAME = c.TABLE_NAME
                    AND kcu.COLUMN_NAME = c.COLUMN_NAME
            WHERE c.COLUMN_NAME REGEXP ? COLLATE utf8mb4_unicode_ci
                AND c.COLUMN_COMMENT REGEXP ? COLLATE utf8mb4_unicode_ci
                AND REGEXP_SUBSTR(c.COLUMN_COMMENT, ? COLLATE utf8mb4_unicode_ci) <?
                AND v.TABLE_NAME IS NULL
    `, [deprecMarkRegex, deprecCommentRegex, deprecDateRegex, minDeprecDate]);

    columns.map(async row => {
        await fs.appendFile(
            filePath,
            'ALTER TABLE ' + SqlString.escapeId(row.schema, true) + '.' + 
                SqlString.escapeId(row.table, true) + ' DROP COLUMN ' + 
                SqlString.escapeId(row.column, true) + ';\n'
        );
    });

    // Generate the drops of the tables
    const [tables] = await conn.query(`
        SELECT TABLE_SCHEMA 'schema', TABLE_NAME 'table'
            FROM information_schema.TABLES
            WHERE TABLE_NAME REGEXP ? COLLATE utf8mb4_unicode_ci
                AND TABLE_COMMENT REGEXP ? COLLATE utf8mb4_unicode_ci
                AND REGEXP_SUBSTR(TABLE_COMMENT, ? COLLATE utf8mb4_unicode_ci) < ?
    `, [deprecMarkRegex, deprecCommentRegex, deprecDateRegex, minDeprecDate]);

    tables.map(async row => {
        await fs.appendFile(
            filePath,
            'DROP TABLE ' + SqlString.escapeId(row.schema, true) + '.' + 
                SqlString.escapeId(row.table, true) + ';\n'
        );
    });
}

function randomName() {
    const color = random(colors);
    let plant = random(plants);
    plant = plant.charAt(0).toUpperCase() + plant.slice(1);
    return color + plant;
}

function random(array) {
    return array[Math.floor(Math.random() * array.length)];
}

const colors = [
    'aqua',
    'azure',
    'black',
    'blue',
    'bronze',
    'brown',
    'chocolate',
    'crimson',
    'golden',
    'gray',
    'green',
    'lime',
    'maroon',
    'navy',
    'orange',
    'pink',
    'purple',
    'red',
    'salmon',
    'silver',
    'teal',
    'turquoise',
    'yellow',
    'wheat',
    'white'
];

const plants = [
    'anthurium',
    'aralia',
    'arborvitae',
    'asparagus',
    'aspidistra',
    'bamboo',
    'birch',
    'carnation',
    'camellia',
    'cataractarum',
    'chico',
    'chrysanthemum',
    'cordyline',
    'cyca',
    'cymbidium',
    'dendro',
    'dracena',
    'erica',
    'eucalyptus',
    'fern',
    'galax',
    'gerbera',
    'hydrangea',
    'ivy',
    'laurel',
    'lilium',
    'mastic',
    'medeola',
    'monstera',
    'moss',
    'oak',
    'orchid',
    'palmetto',
    'paniculata',
    'phormium',
    'raphis',
    'roebelini',
    'rose',
    'ruscus',
    'salal',
    'tulip'
];

module.exports = Version;

if (require.main === module)
    new Myt().cli(Version);
