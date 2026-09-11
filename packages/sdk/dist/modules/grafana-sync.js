export class GrafanaSyncModule {
    baseUrl;
    serviceAccountToken;
    constructor(baseUrl, serviceAccountToken) {
        this.baseUrl = baseUrl;
        this.serviceAccountToken = serviceAccountToken;
    }
    async upsert(dashboardJson) {
        const response = await fetch(`${this.baseUrl}/api/dashboards/db`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.serviceAccountToken}`
            },
            body: JSON.stringify({ dashboard: dashboardJson, overwrite: true })
        });
        return response.json();
    }
    async get(uid) {
        const response = await fetch(`${this.baseUrl}/api/dashboards/uid/${uid}`, {
            headers: {
                'Authorization': `Bearer ${this.serviceAccountToken}`
            }
        });
        return response.json();
    }
}
//# sourceMappingURL=grafana-sync.js.map