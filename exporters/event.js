
module.exports = {
    schemaCol: 'EVENT_SCHEMA',
    nameCol: 'EVENT_NAME',
    escapeCols: [
        'starts',
        'ends',
        'executeAt',
        'comment'
    ],
    formatter(params) {
        let status;
        switch(params.status){
        case 'DISABLED':
            status = 'DISABLE';
            break;
        case 'SLAVESIDE_DISABLED':
            status = 'DISABLE ON SLAVE';
            break;
        default:
            status = 'ENABLE'
        }
        params.status = status;
    }
};
