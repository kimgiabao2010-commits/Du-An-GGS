import { WebSocket } from 'ws';

export class ASQWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private callbacks: Map<string, ((data: any) => void)[]> = new Map();

  constructor(url: string, token: string, maxReconnectAttempts = 5) {
    this.url = url;
    this.token = token;
    this.maxReconnectAttempts = maxReconnectAttempts;
  }

  public connect(): void {
    const headers = { Authorization: `Bearer ${this.token}` };
    this.ws = new WebSocket(this.url, { headers });

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.emit('system:connected', { status: 'Connected to ASQ C2' });
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString());
        this.emit(parsed.event, parsed.payload);
      } catch (e) {
        // Drop malformed frame
      }
    });

    this.ws.on('close', () => this.handleDisconnect());
    this.ws.on('error', () => this.handleDisconnect());
  }

  private handleDisconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.pow(2, this.reconnectAttempts) * 1000;
      this.reconnectAttempts++;
      setTimeout(() => this.connect(), delay);
    } else {
      this.emit('system:error', { error: 'Max reconnect attempts reached' });
    }
  }

  public subscribe(event: string, callback: (data: any) => void): void {
    const cbs = this.callbacks.get(event) || [];
    cbs.push(callback);
    this.callbacks.set(event, cbs);
  }

  public publish(event: string, payload: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, payload }));
    } else {
        throw new Error('WebSocket is not connected');
    }
  }

  private emit(event: string, data: any): void {
    const cbs = this.callbacks.get(event);
    if (cbs) {
      cbs.forEach(cb => cb(data));
    }
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}
