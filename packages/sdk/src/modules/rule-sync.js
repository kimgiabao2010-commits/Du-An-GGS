export class RuleSyncModule {
    ws;
    constructor(ws) {
        this.ws = ws;
    }
    update(ruleId, rulePayload) {
        this.ws.publish('rule:update', { ruleId, payload: rulePayload });
    }
    list() {
        // Request a sync list from the server
        this.ws.publish('rule:list', {});
    }
    onListReceived(callback) {
        this.ws.subscribe('rule:list:response', callback);
    }
}
//# sourceMappingURL=rule-sync.js.map