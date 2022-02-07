
module.exports = {
    schemaCol: 'db',
    nameCol: 'name',
    escapeCols: [
        'comment'
    ],
    formatter(params) {
        let dataAccess;
        switch(params.dataAccess) {
        case 'NO_SQL':
            dataAccess = 'NO SQL';
            break;
        case 'READS_SQL_DATA':
            dataAccess = 'READS SQL DATA';
            break;
        case 'MODIFIES_SQL_DATA':
            dataAccess = 'MODIFIES SQL DATA';
            break;
        }
        params.dataAccess = dataAccess;
    }
};
