import type { ComponentContext } from "@ixon-cdk/types";
import type { Alarm } from "../types"; // Ensure Alarm type is imported

export class ApiService {
  context: ComponentContext;
  headers: {};

  constructor(context: ComponentContext) {
    this.context = context;
    this.headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + context.appData.accessToken.secretId,
      "Api-Application": context.appData.apiAppId,
      "Api-Company": context.appData.company.publicId,
      "Api-Version": "2",
    };
    console.log("ApiService initialized with headers:", this.headers);
  }

  async fetch(url: string): Promise<any> {
    console.log(`Fetching from URL: ${url}`);
    return fetch(url, { method: "GET", headers: this.headers })
      .then((response) => {
        if (!response.ok)
          throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
      })
      .catch((error) => {
        console.error(`Error fetching from ${url}:`, error);
        throw error;
      });
  }

  async getAlarmsAndOccurrences(agentId: string): Promise<Alarm[]> {
    const alarmsUrl = `${this.context.componentBaseUrl}/api/agents/${agentId}/data-alarms`;
    const occurrencesUrl = `${this.context.componentBaseUrl}/api/agents/${agentId}/alarm-occurrences`;
    try {
      const [alarms, occurrences] = await Promise.all([
        this.fetch(alarmsUrl),
        this.fetch(occurrencesUrl),
      ]);
      return alarms.data.map((alarm: any) => ({
        ...alarm,
        occurrences: occurrences.data.filter(
          (occ: any) => occ.alarm.publicId === alarm.publicId
        ),
      }));
    } catch (error) {
      console.error("Failed to fetch alarms or occurrences:", error);
      throw error;
    }
  }
}
