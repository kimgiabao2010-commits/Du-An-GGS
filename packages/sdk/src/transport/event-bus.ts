import { EventEmitter } from 'events';
import { UDMEvent } from '../types/index.js';

/**
 * EventBus cơ bản dạng In-Memory.
 * Sau này sẽ được nâng cấp lên gRPC stream hoặc RabbitMQ pub/sub.
 */
export class EventBus extends EventEmitter {
    private static instance: EventBus;

    private constructor() {
        super();
    }

    public static getInstance(): EventBus {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }

    public publish(topic: string, message: UDMEvent | any): void {
        this.emit(topic, message);
    }

    public subscribe(topic: string, listener: (message: any) => void): void {
        this.on(topic, listener);
    }
    
    public unsubscribe(topic: string, listener: (message: any) => void): void {
        this.off(topic, listener);
    }
}
