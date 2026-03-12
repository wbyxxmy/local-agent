class Registry {
    private services: {[key: string]: any} = {};

    register(name: string, service: any) {
        this.services[name] = service;
    }

    get(name: string) {
        return this.services[name];
    }
}

export const registry = new Registry();
