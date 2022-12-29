
const sqlFormatter = require('@sqltools/formatter');

module.exports = {
    schemaCol: 'TABLE_SCHEMA',
    nameCol: 'TABLE_NAME',
    defaults: {
        securityType: 'DEFINER',
        checkOption: 'NONE'
    },
    formatter(params) {
        params.definition = sqlFormatter.format(params.definition, {
            indent: '\t',
            reservedWordCase: 'upper'
        });

        let algorithm;
        switch (params.isUpdatable) {
        case 'YES':
            algorithm = 'MERGE';
            break;
        case 'NO':
            algorithm = 'TEMPTABLE';
            break;
        default:
            algorithm = 'UNDEFINED';
        }
    }
};
