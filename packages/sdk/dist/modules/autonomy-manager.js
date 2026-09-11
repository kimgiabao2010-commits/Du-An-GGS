export class AutonomyManagerModule {
    ws;
    constructor(ws) {
        this.ws = ws;
    }
    setLevel(level, approvers) {
        this.ws.publish('autonomy:set', { level, approvers });
    }
    getLevel(callback) {
        this.ws.subscribe('autonomy:get:response', callback);
        this.ws.publish('autonomy:get', {});
    }
    onLevelChange(callback) {
        this.ws.subscribe('autonomy:changed', callback);
    }
}
//# sourceMappingURL=autonomy-manager.js.map