// alarms-manager.ts
import { ApiService } from "./api.service";
import type { ComponentContext, Alarm } from "@ixon-cdk/types";

export class AlarmsManager {
  apiService: ApiService;
  context: ComponentContext;

  constructor(context: ComponentContext) {
    this.context = context;
    this.apiService = new ApiService(context);
  }

  async getAllAlarmOccurrencesForAgent(agentId: string): Promise<Alarm[]> {
    console.log("Fetching alarms for agent ID:", agentId);
    return this.apiService
      .getAllAlarmOccurrences(agentId)
      .then((alarmOccurrences) =>
        alarmOccurrences.map((occ) => ({
          publicId: occ.publicId,
          name: occ.alarm.name,
          occurrence: occ,
          agent: { publicId: agentId, name: "Unknown" }, // Simplification, add more details as needed
          severity: occ.alarm.severity,
          source: occ.alarm.source,
        }))
      )
      .catch((error) => {
        console.error("Error fetching alarms:", error);
        return [];
      });
  }
}
