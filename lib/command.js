/**
 * Base class for Myt commands.
 */
module.exports = class MytCommand {
    constructor(myt, opts) {
        this.myt = myt;
        this.opts = opts;
    }

    async run(myt, opts) {
        throw new Error('run command not defined');
    }
}
