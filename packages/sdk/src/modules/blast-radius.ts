import { ASQWebSocketClient } from '../transport/ws-client.js';

export class BlastRadiusModule {
  constructor(private ws: ASQWebSocketClient) {}

  public getRadius(incidentId: string, callback: (radiusData: any) => void): void {
    this.ws.subscribe(`blast:radius:response:${incidentId}`, callback);
    this.ws.publish('blast:radius:get', { incidentId });
  }
  
  public onRadiusAlert(callback: (alertData: any) => void): void {
    this.ws.subscribe('blast:radius:alert', callback);
  }
}
