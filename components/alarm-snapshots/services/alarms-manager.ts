import { ApiService } from "./api.service";
import type { ComponentContext } from "@ixon-cdk/types";
import type { Alarm } from "../types";

export class AlarmsManager {
  apiService: ApiService;
  context: ComponentContext;

  constructor(context: ComponentContext) {
    this.context = context;
    this.apiService = new ApiService(context);
  }

  async getAllAlarmOccurrencesForAgent(
    agentId: string,
    pageSize: number = 50,
    pageAfter?: string,
    searchQuery?: string
  ): Promise<{ alarms: Alarm[]; moreAfter?: string }> {
    console.log(
      "Fetching alarm data and occurrences for agent ID:",
      agentId,
      "with pageAfter:",
      pageAfter,
      "and searchQuery:",
      searchQuery
    );
    return this.apiService.getAlarmsAndOccurrences(
      agentId,
      pageSize,
      pageAfter,
      searchQuery
    );
  }
}
