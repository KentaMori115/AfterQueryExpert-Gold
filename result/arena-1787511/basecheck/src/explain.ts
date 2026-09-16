export interface DecisionExplanation {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface Explained<T> {
  readonly value: T;
  readonly explanation: DecisionExplanation;
}

export function explain(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): DecisionExplanation {
  return {
    code,
    message,
    details: Object.freeze({ ...details }),
  };
}

export function explained<T>(
  value: T,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): Explained<T> {
  return { value, explanation: explain(code, message, details) };
}

export function joinExplanations(items: readonly DecisionExplanation[]): DecisionExplanation {
  return explain(
    items.map((item) => item.code).join("+") || "empty",
    items.map((item) => item.message).join("; ") || "no explanations",
    { count: items.length, items },
  );
}
