
function camelToSnake(str) {
    return str.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}

module.exports.camelToSnake = camelToSnake;
