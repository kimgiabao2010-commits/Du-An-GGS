export declare class GrafanaSyncModule {
    private baseUrl;
    private serviceAccountToken;
    constructor(baseUrl: string, serviceAccountToken: string);
    upsert(dashboardJson: any): Promise<any>;
    get(uid: string): Promise<any>;
}
//# sourceMappingURL=grafana-sync.d.ts.map