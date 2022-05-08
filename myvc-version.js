
const MyVC = require('./myvc');
const fs = require('fs-extra');

/**
 * Creates a new version.
 */
class Version {
    get usage() {
        return {
            description: 'Creates a new version',
            params: {
                name: 'Name for the new version'
            },
            operand: 'name'
        };
    }

    get localOpts() {
        return {
            alias: {
                name: 'n'
            },
            string: [
                'name'
            ],
            default: {
                remote: 'production'
            }
        };
    }

    async run(myvc, opts) {
        let newVersionDir;
        const verionsDir =`${opts.myvcDir}/versions`;

        // Fetch last version number

        const conn = await myvc.dbConnect();

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

            console.log(
                `Database information:`
                + `\n -> Version: ${number}`
                + `\n -> Last version: ${lastNumber}`
            );

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
            const versionDirs = await fs.readdir(verionsDir);
            for (const versionDir of versionDirs) {
                const dirVersion = myvc.parseVersionDir(versionDir);
                if (!dirVersion) continue;
                versionNames.add(dirVersion.name);
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
            newVersionDir = `${verionsDir}/${versionFolder}`;

            await conn.query(
                `INSERT INTO version
                    SET code = ?,
                        lastNumber = ?
                    ON DUPLICATE KEY UPDATE
                        lastNumber = VALUES(lastNumber)`,
                [opts.code, newVersion]
            );
            await fs.mkdir(newVersionDir);
            await fs.writeFile(
                `${newVersionDir}/00-firstScript.sql`,
                '-- Place your SQL code here\n'
            );
            console.log(`New version created: ${versionFolder}`);

            await conn.query('COMMIT');
        } catch (err) {
            await conn.query('ROLLBACK');
            if (newVersionDir && await fs.pathExists(newVersionDir))
                await fs.remove(newVersionDir, {recursive: true});
            throw err;
        }
    }
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
    new MyVC().run(Version);
