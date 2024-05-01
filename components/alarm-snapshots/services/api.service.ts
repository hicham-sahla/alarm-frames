import type {
  ComponentContext,
  AgentDataAlarmOccurrence,
} from "@ixon-cdk/types";
import type { Alarm } from "../types";

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
    const baseUrl = `https://portal.ixon.cloud:443/api/agents/${agentId}`;
    const alarmsUrl = `${baseUrl}/data-alarms`;
    const occurrencesUrl = `${baseUrl}/alarm-occurences`;

    const [alarmsResponse, occurrencesResponse] = await Promise.all([
      this.recursiveFetch(alarmsUrl),
      this.recursiveFetch(occurrencesUrl),
    ]);

    return alarmsResponse.map((alarm: any) => ({
      ...alarm,
      occurrences: occurrencesResponse.filter(
        (occ: AgentDataAlarmOccurrence) =>
          occ.alarm && occ.alarm.publicId === alarm.publicId
      ),
    }));
  }

  async recursiveFetch(
    url: string,
    items: any[] = [],
    pageAfter?: string
  ): Promise<any[]> {
    const requestUrl = new URL(url);
    if (pageAfter) {
      requestUrl.searchParams.set("page-after", pageAfter);
    }

    const response = await this.fetch(requestUrl.toString());
    const newData = items.concat(response.data);

    if (response.moreAfter) {
      return this.recursiveFetch(url, newData, response.moreAfter);
    }

    return newData;
  }
}
