
const log = require('fancy-log');
const path = require('path');
const docker = require('../docker');

module.exports = class Server {
    constructor(name, context) {
        Object.assign(this, {
            id: name,
            name,
            isRandom: name == null,
            dbConf: {
                host: 'localhost',
                port: '3306',
                username: 'root',
                password: 'root'
            },
            imageTag: name || 'myvc/dump',
            context
        });
    }

    wait() {
        return new Promise((resolve, reject) => {
            const mysql = require('mysql2');

            let interval = 100;
            let elapsedTime = 0;
            let maxInterval = 4 * 60 * 1000;

            let myConf = {
                user: this.dbConf.username,
                password: this.dbConf.password,
                host: this.dbConf.host,
                port: this.dbConf.port
            };

            log('Waiting for MySQL init process...');

            async function checker() {
                elapsedTime += interval;
                let status;

                try {
                    status =  await docker.inspect(this.id, {
                        filter: '{{json .State.Status}}'
                    });
                } catch (err) {
                    return reject(new Error(err.message));
                }

                if (status === 'exited')
                    return reject(new Error('Docker exited, please see the docker logs for more info'));

                let conn = mysql.createConnection(myConf);
                conn.on('error', () => {});
                conn.connect(err => {
                    conn.destroy();
                    if (!err) {
                        log('MySQL process ready.');
                        return resolve();
                    }

                    if (elapsedTime >= maxInterval)
                        reject(new Error(`MySQL not initialized whithin ${elapsedTime / 1000} secs`));
                    else
                        setTimeout(bindedChecker, interval);
                });
            }
            let bindedChecker = checker.bind(this);
            bindedChecker();
        });
    }

    async rm() {
        try {
            await docker.stop(this.id);
            await docker.rm(this.id, {volumes: true});
        } catch (e) {}
    }
};
