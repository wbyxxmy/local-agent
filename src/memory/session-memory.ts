class SessionMemory {
    private memory: {[key: string]: any} = {};

    get(key: string) {
        return this.memory[key];
    }

    set(key: string, value: any) {
        this.memory[key] = value;
    }
}

export const sessionMemory = new SessionMemory();
