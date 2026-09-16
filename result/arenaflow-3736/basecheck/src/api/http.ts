import { ArenaFlowError } from "../errors.js";

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export function json(status: number, body: unknown): HttpResponse {
  return { status, body };
}

export function errorResponse(error: unknown): HttpResponse {
  if (error instanceof ArenaFlowError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : error.code === "ANTI_CHEAT" || error.code === "INELIGIBLE" || error.code === "RULE_VIOLATION"
            ? 403
            : error.code === "ILLEGAL_STATE"
              ? 409
              : 400;
    return json(status, error.toJSON());
  }
  return json(500, {
    name: "InternalError",
    message: error instanceof Error ? error.message : "unknown error",
  });
}

export function parsePath(pattern: string, path: string): Record<string, string> | undefined {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("?")[0]!.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i]!;
    const actual = pathParts[i]!;
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}
