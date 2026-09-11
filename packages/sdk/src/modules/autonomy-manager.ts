import { ASQWebSocketClient } from '../transport/ws-client.js';

export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export class AutonomyManagerModule {
  constructor(private ws: ASQWebSocketClient) {}

  public setLevel(level: AutonomyLevel, approvers: string[]): void {
    this.ws.publish('autonomy:set', { level, approvers });
  }

  public getLevel(callback: (levelInfo: { level: AutonomyLevel }) => void): void {
    this.ws.subscribe('autonomy:get:response', callback);
    this.ws.publish('autonomy:get', {});
  }

  public onLevelChange(callback: (event: { newLevel: AutonomyLevel, user: string }) => void): void {
    this.ws.subscribe('autonomy:changed', callback);
  }
}
