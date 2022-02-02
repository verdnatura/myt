
const sqlFormatter = require('@sqltools/formatter');

module.exports = {
    schemaCol: 'TABLE_SCHEMA',
    nameCol: 'TABLE_NAME',
    formatter(params) {
        params.definition = sqlFormatter.format(params.definition, {
            indent: '\t',
            reservedWordCase: 'upper'
        });
    }
};
