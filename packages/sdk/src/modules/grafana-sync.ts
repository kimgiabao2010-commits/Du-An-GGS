export class GrafanaSyncModule {
  private baseUrl: string;
  private serviceAccountToken: string;

  constructor(baseUrl: string, serviceAccountToken: string) {
    this.baseUrl = baseUrl;
    this.serviceAccountToken = serviceAccountToken;
  }

  public async upsert(dashboardJson: any): Promise<any> {
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

  public async get(uid: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/dashboards/uid/${uid}`, {
      headers: {
        'Authorization': `Bearer ${this.serviceAccountToken}`
      }
    });
    return response.json();
  }
}
