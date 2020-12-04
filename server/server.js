
const mysql = require('mysql2/promise');

module.exports = class Server {
    constructor(ct, dbConfig) {
        Object.assign(this, {
            ct,
            dbConfig
        });
    }

    wait() {
        return new Promise((resolve, reject) => {
            const mysql = require('mysql2');

            let interval = 100;
            let elapsedTime = 0;
            let maxInterval = 4 * 60 * 1000;

            const dbConfig = this.dbConfig;
            let myConf = {
                user: dbConfig.user,
                password: dbConfig.password,
                host: dbConfig.host,
                port: dbConfig.port
            };

            console.log('Waiting for MySQL init process...');

            async function checker() {
                elapsedTime += interval;
                let status;

                try {
                    status =  await this.ct.inspect({
                        format: '{{json .State.Status}}'
                    });
                } catch (err) {
                    return reject(new Error(err.message));
                }

                if (status === 'exited')
                    return reject(new Error('Docker exited, please see the docker logs for more info'));

                const conn = mysql.createConnection(myConf);
                conn.on('error', () => {});
                conn.connect(err => {
                    conn.destroy();
                    if (!err) {
                        console.log('MySQL process ready.');
                        return resolve();
                    }

                    if (elapsedTime >= maxInterval)
                        reject(new Error(`MySQL not initialized whithin ${elapsedTime / 1000} secs`));
                    else
                        setTimeout(bindedChecker, interval);
                });
            }
            const bindedChecker = checker.bind(this);
            bindedChecker();
        });
    }

    async rm() {
        try {
            await this.ct.stop();
            await this.ct.rm({volumes: true});
        } catch (e) {}
    }
};
