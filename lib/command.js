/**
 * Base class for MyVC commands.
 */
module.exports = class MyVCCommand {
    get usage() {
        return {};
    }

    get localOpts() {
        return {};
    }

    async run(myvc, opts) {
        throw new Error('run command not defined');
    }
}
