/**
 * Base class for Myt commands.
 */
module.exports = class MytCommand{
    constructor(myt, opts) {
        Object.assign(this, {
            myt,
            ctx: myt.ctx,
            cfg: myt.cfg,
            opts: opts || {}
        });
        this.handlers = {};
    }

    async cli() {
        const reporter = this.constructor.reporter;
        if (reporter)
        for (const event in reporter) {
            const handler = reporter[event];
            if (typeof handler == 'string') {
                this.on(event, () => console.log(handler));
            } else if (handler instanceof Function)
                this.on(event, handler);
        }

        return await this.run();
    }

    async run() {
        return await this._run(this.myt, this.ctx, this.cfg, this.opts);
    }

    async _run(myt, ctx, cfg, opts) {
        throw new Error('run method not defined');
    }

    on(event, handler) {
        this.handlers[event] = handler;
    }

    emit(event, ...args) {
        const handler = this.handlers[event];
        if (handler) handler (...args);
    }
}
