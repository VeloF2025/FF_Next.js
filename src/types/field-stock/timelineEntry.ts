export type TimelineEntry =
  | {
      kind: 'event';
      id: string;
      eventType: string;
      fromState: string | null;
      toState: string | null;
      occurredAt: string;
      sourceTable: string | null;
      sourceId: string | null;
      actorName: string | null;
      payload: Record<string, unknown>;
    }
  | {
      kind: 'pseudo';
      id: string;
      label: string;
      occurredAt: string;
      description: string;
    };
