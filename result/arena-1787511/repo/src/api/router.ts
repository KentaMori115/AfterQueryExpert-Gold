import { errorResponse, parsePath, type HttpRequest, type HttpResponse } from "./http.js";

export type RouteHandler = (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;

export interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), pattern, handler });
  }

  async handle(method: string, path: string, body: unknown = {}, query: Record<string, string> = {}): Promise<HttpResponse> {
    const normalizedMethod = method.toUpperCase();
    const pathname = path.split("?")[0] ?? path;
    for (const route of this.routes) {
      if (route.method !== normalizedMethod) {
        continue;
      }
      const params = parsePath(route.pattern, pathname);
      if (!params) {
        continue;
      }
      try {
        return await route.handler({ method: normalizedMethod, path: pathname, body, params, query });
      } catch (error) {
        return errorResponse(error);
      }
    }
    return { status: 404, body: { name: "NotFoundError", message: `no route for ${normalizedMethod} ${pathname}` } };
  }
}
