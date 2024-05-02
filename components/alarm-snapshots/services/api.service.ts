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
    console.log(context);
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
    const alarmsUrl = this.context.getApiUrl("AgentDataAlarmList", { agentId });
    const occurrencesUrl = this.context.getApiUrl(
      "AgentDataAlarmOccurrenceList",
      { agentId }
    );

    const [alarmsResponse, occurrencesResponse] = await Promise.all([
      this.recursiveFetch(alarmsUrl, ["name", "severity"]),
      this.recursiveFetch(
        occurrencesUrl,
        ["alarm.publicId", "occurredOn"],
        [
          'gte(occurredOn,"2024-04-01T00:00:00Z")',
          'lte(occurredOn,"2024-05-02T00:00:00Z")',
        ]
      ),
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
    fields: string[] = [],
    filters: string[] = [],
    items: any[] = [],
    pageAfter?: string
  ): Promise<any[]> {
    const requestUrl = new URL(url);
    if (pageAfter) {
      requestUrl.searchParams.set("page-after", pageAfter);
    }
    if (fields.length) {
      requestUrl.searchParams.set("fields", fields.join(","));
    }
    if (filters.length) {
      // for each filter set filters=filter1&filters=filter2
      filters.forEach((filter) => {
        requestUrl.searchParams.append("filters", filter);
      });
    }

    const response = await this.fetch(requestUrl.toString());
    const newData = items.concat(response.data);

    if (response.moreAfter) {
      return this.recursiveFetch(
        url,
        fields,
        filters,
        newData,
        response.moreAfter
      );
    }

    return newData;
  }
}
