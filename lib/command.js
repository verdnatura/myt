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

    emit(event) {
        const messages = this.constructor.messages;
        if (messages && messages[event])
            console.log(messages[event]);
    }
}
