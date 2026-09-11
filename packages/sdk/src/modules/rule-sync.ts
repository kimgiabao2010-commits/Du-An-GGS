import { ASQWebSocketClient } from '../transport/ws-client.js';

export class RuleSyncModule {
  constructor(private ws: ASQWebSocketClient) {}

  public update(ruleId: string, rulePayload: any): void {
    this.ws.publish('rule:update', { ruleId, payload: rulePayload });
  }

  public list(): void {
    // Request a sync list from the server
    this.ws.publish('rule:list', {});
  }

  public onListReceived(callback: (rules: any[]) => void): void {
    this.ws.subscribe('rule:list:response', callback);
  }
}
