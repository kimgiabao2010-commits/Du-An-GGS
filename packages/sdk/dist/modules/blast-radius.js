export class BlastRadiusModule {
    ws;
    constructor(ws) {
        this.ws = ws;
    }
    getRadius(incidentId, callback) {
        this.ws.subscribe(`blast:radius:response:${incidentId}`, callback);
        this.ws.publish('blast:radius:get', { incidentId });
    }
    onRadiusAlert(callback) {
        this.ws.subscribe('blast:radius:alert', callback);
    }
}
//# sourceMappingURL=blast-radius.js.map