export interface SessionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
}

export class SessionMemory {
  private readonly messages: SessionMessage[] = [];
  private readonly maxMessages: number;

  constructor(maxMessages = 50) {
    this.maxMessages = maxMessages;
  }

  add(message: SessionMessage) {
    this.messages.push(message);
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
  }

  list() {
    return [...this.messages];
  }

  getRecent(limit = 20) {
    return this.messages.slice(-limit);
  }
}