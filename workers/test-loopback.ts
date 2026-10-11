import http from "node:http";

const createServer = http.createServer;
/** Test-only equivalent of cloudflare/workers-sdk#14850 for the pinned Vitest 3 toolchain. */
export function stabilizeTestLoopback(): void {
  http.createServer = ((...args: Parameters<typeof createServer>) => {
    const server = Reflect.apply(createServer,http,args) as http.Server;
    const listener = args.find(arg => typeof arg === "function");
    if (typeof listener === "function" && listener.name === "#handleLoopback") server.keepAliveTimeout = 0;
    return server;
  }) as typeof createServer;
}
