class EventBus {
    private listeners: {[key: string]: Array<Function>} = {};

    on(event: string, listener: Function) {
        this.listeners[event] = this.listeners[event] || [];
        this.listeners[event].push(listener);
    }

    emit(event: string, data: any) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(listener => listener(data));
        }
    }
}

export const eventBus = new EventBus();
