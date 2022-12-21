/**
 * Base class for Myt commands.
 */
module.exports = class MytCommand {
    get usage() {
        return {};
    }

    get localOpts() {
        return {};
    }

    async run(myt, opts) {
        throw new Error('run command not defined');
    }
}
