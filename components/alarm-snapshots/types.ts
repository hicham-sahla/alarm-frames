import type { Agent, AgentDataAlarmOccurrence, ResLink } from "@ixon-cdk/types";

export interface Alarm {
  publicId: string;
  name: string;
  occurrences: AgentDataAlarmOccurrence[];
  agent: Agent;
  severity: string;
  source: ResLink | null;
}
