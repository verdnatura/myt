
const MyVC = require('./myvc');
const fs = require('fs-extra');

/**
 * Creates a new version.
 */
class Version {
    mainOpt = 'name';
    get localOpts() {
        return {
            operand: 'name',
            name: {
                name: 'n'
            },
            default: {
                remote: 'production'
            }
        };
    }

    async run(myvc, opts) {
        const verionsDir =`${opts.workspace}/versions`;
        let versionDir;
        let versionName = opts.name;

        // Fetch last version number

        const conn = await myvc.dbConnect();
        const version = await myvc.fetchDbVersion() || {};

        try {
            await conn.query('START TRANSACTION');

            const [[row]] = await conn.query(
                `SELECT lastNumber FROM version WHERE code = ? FOR UPDATE`,
                [opts.code]
            );
            const lastVersion = row && row.lastNumber;

            console.log(
                `Database information:`
                + `\n -> Version: ${version.number}`
                + `\n -> Last version: ${lastVersion}`
            );

            let newVersion = lastVersion ? parseInt(lastVersion) + 1 : 1;
            newVersion = String(newVersion).padStart(opts.versionDigits, '0');

            // Get version name

            const versionNames = new Set();
            const versionDirs = await fs.readdir(verionsDir);
            for (const versionNameDir of versionDirs) {
                const split = versionNameDir.split('-');
                const versionName = split[1];
                if (versionName) versionNames.add(versionName);
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
            versionDir = `${verionsDir}/${versionFolder}`;

            await conn.query(
                `UPDATE version SET lastNumber = ? WHERE code = ?`,
                [newVersion, opts.code]
            );
            await fs.mkdir(versionDir);
            console.log(`New version folder created: ${versionFolder}`);

            await conn.query('COMMIT');
        } catch (err) {
            await conn.query('ROLLBACK');
            if (versionDir && await fs.pathExists(versionDir))
                await fs.remove(versionDir, {recursive: true});
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
