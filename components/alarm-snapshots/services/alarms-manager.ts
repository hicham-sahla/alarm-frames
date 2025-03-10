import { ApiService } from "./api.service";
import type { PageInfo, PagedResult } from "./api.service";
import type { ComponentContext } from "@ixon-cdk/types";
import type { Alarm } from "../types";

export class AlarmsManager {
  apiService: ApiService;
  context: ComponentContext;

  constructor(context: ComponentContext) {
    this.context = context;
    this.apiService = new ApiService(context);
  }

  /**
   * Get paginated alarm occurrences for an agent
   */
  async getPagedAlarmOccurrences(
    agentId: string,
    from: Date,
    to: Date,
    pageInfo: PageInfo
  ): Promise<PagedResult<Alarm>> {
    console.log(
      `Fetching page ${pageInfo.page} of alarm data for agent ID: ${agentId}`
    );
    return this.apiService.getPagedAlarmOccurrences(
      agentId,
      from,
      to,
      pageInfo
    );
  }

  /**
   * Legacy method to get all alarm occurrences for an agent
   * Kept for backward compatibility
   */
  async getAllAlarmOccurrencesForAgent(
    agentId: string,
    from: Date,
    to: Date
  ): Promise<Alarm[]> {
    console.log(
      "Fetching all alarm data and occurrences for agent ID:",
      agentId
    );
    return this.apiService.getAlarmsAndOccurrences(agentId, from, to);
  }
}
