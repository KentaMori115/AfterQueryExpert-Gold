import type { EpochMillis } from "../../clock.js";
import type { DecisionExplanation } from "../../explain.js";
import type { DomainEvent } from "../../events/types.js";

export interface AuditEntry {
  readonly at: EpochMillis;
  readonly actor: string;
  readonly action: string;
  readonly subject: string;
  readonly explanation: DecisionExplanation;
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  record(entry: AuditEntry): void {
    this.entries.push(Object.freeze({ ...entry }));
  }

  fromEvent(event: DomainEvent, actor = "system"): void {
    this.record({
      at: event.at,
      actor,
      action: event.type,
      subject: event.streamId,
      explanation: event.explanation,
    });
  }

  forSubject(subject: string): AuditEntry[] {
    return this.entries.filter((entry) => entry.subject === subject);
  }

  forActor(actor: string): AuditEntry[] {
    return this.entries.filter((entry) => entry.actor === actor);
  }

  between(from: EpochMillis, to: EpochMillis): AuditEntry[] {
    return this.entries.filter((entry) => entry.at >= from && entry.at <= to);
  }

  all(): AuditEntry[] {
    return [...this.entries].sort((a, b) => a.at - b.at || a.action.localeCompare(b.action));
  }

  clear(): void {
    this.entries.splice(0, this.entries.length);
  }
}

export function summarizeAudit(entries: readonly AuditEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.action] = (counts[entry.action] ?? 0) + 1;
  }
  return counts;
}
