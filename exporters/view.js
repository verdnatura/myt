
const sqlFormatter = require('@sqltools/formatter');

module.exports = function(params) {
    params.definition = sqlFormatter.format(params.definition, {
        indent: '\t',
        reservedWordCase: 'upper'
    });
}
