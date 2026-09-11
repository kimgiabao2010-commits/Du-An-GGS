import { EventEmitter } from 'events';
import { UDMEvent } from '../types/index.js';
/**
 * EventBus cơ bản dạng In-Memory.
 * Sau này sẽ được nâng cấp lên gRPC stream hoặc RabbitMQ pub/sub.
 */
export declare class EventBus extends EventEmitter {
    private static instance;
    private constructor();
    static getInstance(): EventBus;
    publish(topic: string, message: UDMEvent | any): void;
    subscribe(topic: string, listener: (message: any) => void): void;
    unsubscribe(topic: string, listener: (message: any) => void): void;
}
//# sourceMappingURL=event-bus.d.ts.map