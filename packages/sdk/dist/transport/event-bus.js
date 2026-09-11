import { EventEmitter } from 'events';
/**
 * EventBus cơ bản dạng In-Memory.
 * Sau này sẽ được nâng cấp lên gRPC stream hoặc RabbitMQ pub/sub.
 */
export class EventBus extends EventEmitter {
    static instance;
    constructor() {
        super();
    }
    static getInstance() {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }
    publish(topic, message) {
        this.emit(topic, message);
    }
    subscribe(topic, listener) {
        this.on(topic, listener);
    }
    unsubscribe(topic, listener) {
        this.off(topic, listener);
    }
}
//# sourceMappingURL=event-bus.js.map