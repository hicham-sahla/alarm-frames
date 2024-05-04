import type {
  ComponentContext,
  AgentDataAlarmOccurrence,
} from "@ixon-cdk/types";
import type { Alarm } from "../types";
import { DateTime } from "luxon";

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

  async getAlarmsAndOccurrences(
    agentId: string,
    from: Date,
    to: Date
  ): Promise<Alarm[]> {
    const currentDate = DateTime.fromJSDate(to).toUTC();
    const fourWeeksAgo = DateTime.fromJSDate(from).toUTC();

    const alarmsUrl = this.context.getApiUrl("AgentDataAlarmList", { agentId });
    const occurrencesUrl = this.context.getApiUrl(
      "AgentDataAlarmOccurrenceList",
      { agentId }
    );

    const dateFilter = [
      `gte(occurredOn,"${fourWeeksAgo.toISO()}")`,
      `lte(occurredOn,"${currentDate.toISO()}")`,
    ];

    const [alarmsResponse, occurrencesResponse] = await Promise.all([
      this.recursiveFetch(alarmsUrl, ["name", "severity"]),
      this.recursiveFetch(
        occurrencesUrl,
        ["alarm.publicId", "occurredOn"],
        dateFilter
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

    const response = await this.fetch(requestUrl.toString());
    const newData = items.concat(response.data);

    if (response.moreAfter) {
      return this.recursiveFetch(url, fields, newData, response.moreAfter);
    }
    return newData;
  }
}
