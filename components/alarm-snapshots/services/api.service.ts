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
    pageSize: number = 50,
    pageAfter?: string,
    searchQuery?: string
  ): Promise<{ alarms: Alarm[]; moreAfter?: string }> {
    const alarmsUrl = this.context.getApiUrl("AgentDataAlarmList", { agentId });
    const occurrencesUrl = this.context.getApiUrl(
      "AgentDataAlarmOccurrenceList",
      { agentId }
    );

    // Create filters array for search if provided
    const filters: string[] = [];

    // Add search filter if a query is provided
    if (searchQuery && searchQuery.trim() !== "") {
      const searchTerms = searchQuery.toLowerCase().trim().split(" ");
      const searchFilters = searchTerms.map(
        (term) =>
          `or(contains(publicId,"${term}"),contains(alarm.name,"${term}"))`
      );
      if (searchFilters.length > 0) {
        filters.push(searchFilters.join(","));
      }
    }

    // Get all alarms (non-paginated)
    const alarmsResponse = await this.recursiveFetch(alarmsUrl, [
      "name",
      "severity",
    ]);

    // Get occurrences with pagination
    const occurrencesResponse = await this.recursiveFetch(
      occurrencesUrl,
      ["alarm.publicId", "occurredOn", "publicId"],
      filters,
      [],
      pageAfter,
      pageSize,
      true // single page mode
    );

    // Map occurrences to alarms
    const alarms = alarmsResponse.map((alarm: any) => ({
      ...alarm,
      occurrences: occurrencesResponse.data.filter(
        (occ: AgentDataAlarmOccurrence) =>
          occ.alarm && occ.alarm.publicId === alarm.publicId
      ),
    }));

    return {
      alarms,
      moreAfter: occurrencesResponse.moreAfter,
    };
  }

  async recursiveFetch(
    url: string,
    fields: string[] = [],
    filters: string[] = [],
    items: any[] = [],
    pageAfter?: string,
    pageSize: number = 50,
    singlePage: boolean = false
  ): Promise<any> {
    const requestUrl = new URL(url);

    if (pageAfter) {
      requestUrl.searchParams.set("page-after", pageAfter);
    }

    // Set page size parameter
    requestUrl.searchParams.set("page-size", pageSize.toString());

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

    // If singlePage is true, return the current page with pagination info
    if (singlePage) {
      return {
        data: response.data,
        moreAfter: response.moreAfter,
      };
    }

    // Otherwise, continue recursive fetching for all pages
    if (response.moreAfter) {
      return this.recursiveFetch(
        url,
        fields,
        filters,
        newData,
        response.moreAfter,
        pageSize
      );
    }

    return newData;
  }
}
