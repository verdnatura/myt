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

    static args = {
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

    async cli() {
        await super.cli();
        console.log('Routine created.');
    }

    async _run(myt, ctx, cfg, opts) {
        const {type} = opts;

        const match = opts.name.match(/^(\w+)\.(\w+)$/);
        if (!match)
            throw new Error('Invalid object name, should contain schema and routine name');

        const schema = match[1];
        const name = match[2];

        const params = {
            schema,
            name,
            definer: cfg.defaultDefiner
        };

        switch (type) {
            case 'event':
            case 'procedure':
            case 'trigger':
                params.body = "BEGIN\n\t-- Your code goes here\nEND";
                break;
            case 'function':
                params.body = "BEGIN\n\tRETURN 1;\nEND";
                break;
            case 'view':
                params.definition = "SELECT TRUE"
                break;
        }

        const exporter = new Exporter(type, cfg.replace);
        await exporter.init();
        const sql = exporter.format(params);

        const routineDir = `${ctx.routinesDir}/${schema}/${type}s`;
        if (!await fs.pathExists(routineDir))
            await fs.mkdir(routineDir, {recursive: true});

        const routineFile = `${routineDir}/${name}.sql`;

        if (await fs.exists(routineFile))
            throw new Error('Routine already exists');
        
        await fs.writeFile(routineFile, sql);
    }
}

module.exports = Create;

if (require.main === module)
    new Myt().cli(Create);
