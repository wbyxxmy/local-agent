class Router {
    private routes: {[key: string]: Function} = {};

    addRoute(path: string, handler: Function) {
        this.routes[path] = handler;
    }

    handleRequest(path: string, request: any) {
        const handler = this.routes[path];
        if (handler) {
            handler(request);
        }
    }
}

export const router = new Router();
