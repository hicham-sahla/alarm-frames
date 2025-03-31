import type { Agent, AgentDataAlarmOccurrence, ResLink } from "@ixon-cdk/types";

export interface Alarm {
  publicId: string;
  name: string;
  occurrences: AgentDataAlarmOccurrence[];
  agent: Agent;
  severity: string;
  source: ResLink | null;
}

export interface Occurrence {
  name: string;
  occurredOn: {
    fullDate: string;
    dateOnly: string;
    timeOnly: string;
    formattedDate: string; // User-friendly formatted date
  };
  severity: string;
  publicId: string;
}
