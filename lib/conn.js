const fs = require('fs-extra');

/**
 * Executes an SQL script.
 *
 * @param {Connection} conn MySQL connection object
 * @returns {Array<Result>} The resultset
 */
async function queryFromFile(conn, file) {
    const sql = await fs.readFile(file, 'utf8');
    return await this.multiQuery(conn, sql);
}

/**
 * Executes a multi-query string.
 *
 * @param {Connection} conn MySQL connection object
 * @param {String} sql SQL multi-query string
 * @returns {Array<Result>} The resultset
 */
async function multiQuery(conn, sql) {
    let results = [];
    const stmts = this.querySplit(sql);

    for (const stmt of stmts)
        results = results.concat(await conn.query(stmt));

    return results;
}

/**
 * Splits an SQL muti-query into a single-query array, it does an small 
 * parse to correctly handle the DELIMITER statement.
 *
 * @param {Array<String>} stmts The splitted SQL statements
 */
function querySplit(sql) {
    const stmts = [];
    let i,
        char,
        token,
        escaped,
        stmtStart;

    let delimiter = ';';
    const delimiterRe = /\s*delimiter\s+(\S+)[^\S\r\n]*(?:\r?\n|\r|$)/yi;

    function begins(str) {
        let j;
        for (j = 0; j < str.length; j++)
            if (sql[i + j] != str[j])
                return false;
        i += j;
        return true;
    }

    for (i = 0; i < sql.length;) {
        stmtStart = i;

        delimiterRe.lastIndex = i;
        const match = sql.match(delimiterRe);
        if (match) {
            delimiter = match[1];
            i += match[0].length;
            continue;
        }

        let delimiterFound = false;
        while (i < sql.length) {
            char = sql[i];

            if (token) {
                if (!escaped && begins(token.end))
                    token = null;
                else {
                    escaped = !escaped && token.escape(char);
                    i++;
                }
            } else {
                delimiterFound = begins(delimiter);
                if (delimiterFound) break;

                const tok = tokenIndex.get(char);
                if (tok && begins(tok.start))
                    token = tok;
                else
                    i++;
            }
        }

        let len = i - stmtStart;
        if (delimiterFound) len -= delimiter.length;
        const stmt = sql.substr(stmtStart, len);

        if (!/^\s*$/.test(stmt))
            stmts.push(stmt);
    }

    return stmts;
}

const tokens = {
    string: {
        start: '\'',
        end: '\'',
        escape: char => char == '\'' || char == '\\'
    },
    quotedString: {
        start: '"',
        end: '"',
        escape: char => char == '"' || char == '\\'
    },
    id: {
        start: '`',
        end: '`',
        escape: char => char == '`'
    },
    multiComment: {
        start: '/*',
        end: '*/',
        escape: () => false
    },
    singleComment: {
        start: '-- ',
        end: '\n',
        escape: () => false
    }
};

const tokenIndex = new Map();
for (const tokenId in tokens) {
    const token = tokens[tokenId];
    tokenIndex.set(token.start[0], token);
}

module.exports = {
    queryFromFile,
    multiQuery,
    querySplit,
    tokens
};
