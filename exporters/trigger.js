
module.exports = {
    schemaCol: 'TRIGGER_SCHEMA',
    nameCol: 'TRIGGER_NAME',
    defaults: {
        actionTiming: 'AFTER',
        actionType: 'INSERT',
        table: 'table'
    }
};
