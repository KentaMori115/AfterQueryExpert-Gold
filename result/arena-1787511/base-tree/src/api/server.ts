import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { TournamentService } from "../engine/tournament/index.js";
import { MemoryPersistence } from "../persistence/memory/memory-store.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import { createApiRouter } from "./routes/index.js";
import type { Router } from "./router.js";

export interface ApiServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly store?: PersistenceAdapter;
}

export function createArena(store: PersistenceAdapter = new MemoryPersistence()) {
  const service = new TournamentService(store);
  const router = createApiRouter(service);
  return { store, service, router };
}

export function createApiServer(options: ApiServerOptions = {}): {
  server: Server;
  router: Router;
  service: TournamentService;
} {
  const { service, router } = createArena(options.store);
  const server = createServer((req, res) => {
    void dispatch(router, req, res);
  });
  return { server, router, service };
}

async function dispatch(router: Router, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://arenaflow.local");
  const body = await readBody(req);
  const query = Object.fromEntries(url.searchParams.entries());
  const response = await router.handle(req.method ?? "GET", url.pathname, body, query);
  res.statusCode = response.status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(response.body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}
