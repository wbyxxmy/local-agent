import EventEmitter from "eventemitter3";
import type { ToolEvent } from "../types/tool.js";

export class EventBus {
  private readonly emitter = new EventEmitter();

  emit(event: ToolEvent) {
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  on(type: string, listener: (event: ToolEvent) => void) {
    this.emitter.on(type, listener);
  }
}