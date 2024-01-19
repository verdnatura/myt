/**
 * Base class for Myt commands.
 */
module.exports = class MytCommand{
    constructor(myt, opts) {
        this.myt = myt;
        this.opts = opts;
        this.handlers = {};
    }

    async cli(myt, opts) {
        const reporter = this.constructor.reporter;
        if (reporter)
        for (const event in reporter) {
            const handler = reporter[event];
            if (typeof handler == 'string') {
                this.on(event, () => console.log(handler));
            } else if (handler instanceof Function)
                this.on(event, handler);
        }

        await this.run(myt, opts);
    }

    async run(myt, opts) {
        throw new Error('run command not defined');
    }

    on(event, handler) {
        this.handlers[event] = handler;
    }

    emit(event, ...args) {
        const handler = this.handlers[event];
        if (handler) handler (...args);
    }
}
