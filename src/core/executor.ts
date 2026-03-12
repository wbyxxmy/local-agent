import { eventBus } from './event-bus';

export const executeTask = async (task: Function) => {
    eventBus.emit('taskStarting', task);
    await task();
    eventBus.emit('taskCompleted', task);
};
