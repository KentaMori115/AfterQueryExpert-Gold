import type { HttpResponse } from "../api/http.js";
import type { Router } from "../api/router.js";

export interface ArenaFlowClientOptions {
  readonly router?: Router;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export class ArenaFlowRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`ArenaFlow request failed with status ${status}`);
    this.name = "ArenaFlowRequestError";
  }
}

export class ArenaFlowClient {
  constructor(private readonly options: ArenaFlowClientOptions) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.dispatch(method, path, body);
    if (response.status >= 400) {
      throw new ArenaFlowRequestError(response.status, response.body);
    }
    return response.body as T;
  }

  private async dispatch(method: string, path: string, body?: unknown): Promise<HttpResponse> {
    if (this.options.router) {
      return this.options.router.handle(method, path, body ?? {});
    }
    if (!this.options.baseUrl) {
      throw new Error("ArenaFlowClient requires a router or baseUrl");
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const init: RequestInit = {
      method,
      headers: { "content-type": "application/json" },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const result = await fetchImpl(new URL(path, this.options.baseUrl), init);
    return { status: result.status, body: await result.json() };
  }
}
