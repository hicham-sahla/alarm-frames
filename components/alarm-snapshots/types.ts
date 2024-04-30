import type { Agent, AgentDataAlarmOccurrence, ResLink } from "@ixon-cdk/types";

export interface Alarm {
  publicId: string;
  name: string;
  occurrence: AgentDataAlarmOccurrence | null;
  agent: Agent;
  severity: string;
  source: ResLink | null;
}
