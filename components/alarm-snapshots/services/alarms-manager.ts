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
    from: Date,
    to: Date
  ): Promise<Alarm[]> {
    console.log(
      "Fetching all alarm data and occurrences for agent ID:",
      agentId
    );
    return this.apiService.getAlarmsAndOccurrences(agentId, from, to); // Ensure ApiService is adjusted to handle from and to dates
  }
}
