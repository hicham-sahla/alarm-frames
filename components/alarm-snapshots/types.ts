import type { Agent, AgentDataAlarmOccurrence, ResLink } from "@ixon-cdk/types";

export interface Alarm {
  publicId: string;
  name: string;
  occurrences: AgentDataAlarmOccurrence[];
  agent: Agent;
  severity: string;
  source: ResLink | null;
}

export interface PageInfo {
  page: number;
  limit: number;
}

export interface PagedResult<T> {
  items: T[];
  hasMore: boolean;
  totalCount: number;
}
