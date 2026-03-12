export interface SessionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
}

export class SessionMemory {
  private readonly messages: SessionMessage[] = [];

  add(message: SessionMessage) {
    this.messages.push(message);
  }

  list() {
    return [...this.messages];
  }

  getRecent(limit = 20) {
    return this.messages.slice(-limit);
  }
}