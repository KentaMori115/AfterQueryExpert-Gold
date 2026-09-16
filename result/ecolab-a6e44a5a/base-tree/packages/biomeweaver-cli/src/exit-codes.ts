export const ExitCode = {
  OK: 0,
  ECOLOGICAL_ALERTS: 2,
  INVALID_INPUT: 3,
  INTEGRITY_FAILURE: 4,
  INVALID_INVOCATION: 5,
  INTERNAL_FAILURE: 10,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
