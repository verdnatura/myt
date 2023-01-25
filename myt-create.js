const Myt = require('./myt');
const Command = require('./lib/command');
const Exporter = require('./lib/exporter');
const fs = require('fs-extra');

class Create extends Command {
    static usage = {
        description: 'Creates a new DB object',
        params: {
            type: 'The object type',
            name: 'The object name, including schema'
        },
        operand: 'name'
    };

    static opts = {
        alias: {
            type: 't',
            name: 'n'
        },
        string: [
            'type',
            'name'
        ],
        default: {
            type: 'procedure'
        }
    };

    async run(myt, opts) {
        const match = opts.name.match(/^(\w+)\.(\w+)$/);
        if (!match)
            throw new Error('Invalid object name, should contain schema and routine name');

        const schema = match[1];
        const name = match[2];

        const params = {
            schema,
            name,
            definer: 'root@localhost'
        };

        switch (opts.type) {
            case 'event':
            case 'function':
            case 'procedure':
            case 'trigger':
                params.body = "BEGIN\n-- Your code goes here\nEND";
                break;
            case 'view':
                params.definition = "SELECT TRUE"
                break;
        }

        const exporter = new Exporter(opts.type, opts.replace);
        await exporter.init();
        const sql = exporter.format(params);

        const routineDir = `${opts.routinesDir}/${schema}/${opts.type}s`;
        if (!await fs.pathExists(routineDir))
            await fs.mkdir(routineDir);

        const routineFile = `${routineDir}/${name}.sql`;
        await fs.writeFile(routineFile, sql);

        console.log('Routine created.');
    }
}

module.exports = Create;

if (require.main === module)
    new Myt().run(Create);
