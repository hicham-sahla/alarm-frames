import type {
  ComponentContext,
  AgentDataAlarmOccurrence,
} from "@ixon-cdk/types";
import type { Alarm } from "../types";
import { DateTime } from "luxon";

export interface PageInfo {
  page: number;
  limit: number;
}

export interface PagedResult<T> {
  items: T[];
  hasMore: boolean;
  totalCount: number;
}

export class ApiService {
  context: ComponentContext;
  headers: {};
  // Cache results to avoid repeated API calls
  private cache: Map<string, any> = new Map();
  // Track ongoing requests to prevent duplicate fetches
  private pendingRequests: Map<string, Promise<any>> = new Map();
  // Maximum batch size for API requests
  private readonly MAX_BATCH_SIZE = 100;
  // Cache expiration time in milliseconds (5 minutes)
  private readonly CACHE_EXPIRATION = 5 * 60 * 1000;

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

  /**
   * Fetch data from the API with caching and request deduplication
   */
  async fetch(url: string): Promise<any> {
    // Check if we have a cached result
    if (this.cache.has(url)) {
      const cachedData = this.cache.get(url);
      const now = Date.now();

      // If the cache isn't expired, return it
      if (now - cachedData.timestamp < this.CACHE_EXPIRATION) {
        return cachedData.data;
      } else {
        // Clean up expired cache entry
        this.cache.delete(url);
      }
    }

    // Check if we already have a pending request for this URL
    if (this.pendingRequests.has(url)) {
      return this.pendingRequests.get(url);
    }

    // Create a new request
    console.log(`Fetching from URL: ${url}`);
    const requestPromise = fetch(url, { method: "GET", headers: this.headers })
      .then((response) => {
        if (!response.ok)
          throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
      })
      .then((data) => {
        // Cache the result with a timestamp
        this.cache.set(url, {
          data,
          timestamp: Date.now(),
        });
        // Remove from pending requests
        this.pendingRequests.delete(url);
        return data;
      })
      .catch((error) => {
        console.error(`Error fetching from ${url}:`, error);
        // Remove from pending requests on error too
        this.pendingRequests.delete(url);
        throw error;
      });

    // Store the pending request
    this.pendingRequests.set(url, requestPromise);

    return requestPromise;
  }

  /**
   * Get paginated alarm occurrences with improved debugging for fixing Ardagh agent
   */
  async getPagedAlarmOccurrences(
    agentId: string,
    from: Date,
    to: Date,
    pageInfo: PageInfo
  ): Promise<PagedResult<Alarm>> {
    const startDate = DateTime.fromJSDate(from).toUTC();
    const endDate = DateTime.fromJSDate(to).toUTC();
    console.log("Startdate and Enddate API", startDate, endDate);

    const alarmsUrl = this.context.getApiUrl("AgentDataAlarmList", { agentId });
    const occurrencesUrl = this.context.getApiUrl(
      "AgentDataAlarmOccurrenceList",
      { agentId }
    );

    const dateFilter = [
      `gte(occurredOn,"${startDate
        .set({ milliseconds: 0 })
        .toISO({ suppressMilliseconds: true })}")`,
      `lte(occurredOn,"${endDate
        .set({ milliseconds: 0 })
        .toISO({ suppressMilliseconds: true })}")`,
    ];
    console.log("Date Filter", dateFilter);

    // Determine the number of items to fetch and where to start
    const limit = pageInfo.limit;
    const offset = (pageInfo.page - 1) * limit;

    try {
      // First get all alarms (typically a small dataset)
      const alarms = await this.fetchLimitedData(
        alarmsUrl,
        ["name", "severity"],
        [],
        0,
        1000
      );

      console.log("Raw alarms response:", alarms);

      // Check if we have any alarms before proceeding
      if (!alarms || alarms.length === 0) {
        console.log("No alarms found for agent:", agentId);
        return {
          items: [],
          hasMore: false,
          totalCount: 0,
        };
      }

      // Get occurrences count first
      const countUrl = new URL(occurrencesUrl);
      countUrl.searchParams.set("fields", "alarm.publicId,occurredOn");
      dateFilter.forEach((filter) => {
        countUrl.searchParams.append("filters", filter);
      });
      countUrl.searchParams.set("limit", "0");

      // Then get occurrences with pagination
      const dataUrl = new URL(occurrencesUrl);
      dataUrl.searchParams.set("fields", "alarm.publicId,occurredOn");
      dateFilter.forEach((filter) => {
        dataUrl.searchParams.append("filters", filter);
      });
      dataUrl.searchParams.set("offset", offset.toString());
      dataUrl.searchParams.set("limit", limit.toString());

      // Run both requests in parallel
      const [countResponse, occurrencesResponse] = await Promise.all([
        this.fetch(countUrl.toString()),
        this.fetch(dataUrl.toString()),
      ]);

      console.log("Occurrences count response:", countResponse);
      console.log("Occurrences data response:", occurrencesResponse);

      const totalCount = countResponse.meta?.totalCount || 0;
      const occurrences = occurrencesResponse.data || [];

      // Join alarms with their occurrences
      let alarmsWithOccurrences = alarms.map((alarm: any) => {
        const alarmOccurrences = occurrences.filter(
          (occ: AgentDataAlarmOccurrence) =>
            occ.alarm && occ.alarm.publicId === alarm.publicId
        );

        return {
          ...alarm,
          occurrences: alarmOccurrences,
        };
      });

      // Important: For debugging, log all alarms before filtering
      console.log(
        "Alarms with occurrences (before filtering):",
        alarms.map((a: any) => ({
          name: a.name,
          id: a.publicId,
          hasOccurrences:
            alarmsWithOccurrences.find(
              (awo: any) => awo.publicId === a.publicId
            )?.occurrences.length > 0,
        }))
      );

      // For empty first page, include all alarms even with no occurrences
      if (
        pageInfo.page === 1 &&
        alarmsWithOccurrences.every(
          (alarm: any) => alarm.occurrences.length === 0
        )
      ) {
        console.log("No occurrences found, but returning alarms anyway");

        // Create an empty occurrence for each alarm to make the UI work properly
        alarmsWithOccurrences = alarmsWithOccurrences.map((alarm: any) => {
          if (alarm.occurrences.length === 0) {
            // Create a dummy occurrence for this alarm with the current date
            alarm.occurrences = [
              {
                publicId: `dummy-${alarm.publicId}`,
                occurredOn: DateTime.now().toISO(),
                alarm: { publicId: alarm.publicId },
              },
            ];
          }
          return alarm;
        });

        return {
          items: alarmsWithOccurrences,
          hasMore: false,
          totalCount: alarmsWithOccurrences.length,
        };
      }

      // Only filter out empty alarms if we found some with occurrences
      alarmsWithOccurrences = alarmsWithOccurrences.filter(
        (alarm: any) => alarm.occurrences.length > 0
      );

      return {
        items: alarmsWithOccurrences,
        hasMore: offset + limit < totalCount,
        totalCount: totalCount,
      };
    } catch (error) {
      console.error("Error fetching paged alarm occurrences:", error);
      throw error;
    }
  }

  /**
   * The original getAlarmsAndOccurrences method
   * (keeping it for backward compatibility)
   */
  async getAlarmsAndOccurrences(
    agentId: string,
    from: Date,
    to: Date
  ): Promise<Alarm[]> {
    const startDate = DateTime.fromJSDate(from).toUTC();
    const endDate = DateTime.fromJSDate(to).toUTC();
    console.log("Startdate and Enddate API", startDate, endDate);
    const alarmsUrl = this.context.getApiUrl("AgentDataAlarmList", { agentId });
    const occurrencesUrl = this.context.getApiUrl(
      "AgentDataAlarmOccurrenceList",
      { agentId }
    );

    const dateFilter = [
      `gte(occurredOn,"${startDate
        .set({ milliseconds: 0 })
        .toISO({ suppressMilliseconds: true })}")`,
      `lte(occurredOn,"${endDate
        .set({ milliseconds: 0 })
        .toISO({ suppressMilliseconds: true })}")`,
    ];
    console.log("Date Filter", dateFilter);

    try {
      const [alarmsResponse, occurrencesResponse] = await Promise.all([
        this.fetchLimitedData(alarmsUrl, ["name", "severity"], [], 0, 1000),
        this.fetchLimitedData(
          occurrencesUrl,
          ["alarm.publicId", "occurredOn"],
          dateFilter,
          0,
          500 // Limit to 500 occurrences to prevent excessive data loading
        ),
      ]);

      return alarmsResponse.map((alarm: any) => ({
        ...alarm,
        occurrences: occurrencesResponse.filter(
          (occ: AgentDataAlarmOccurrence) =>
            occ.alarm && occ.alarm.publicId === alarm.publicId
        ),
      }));
    } catch (error) {
      console.error("Error in getAlarmsAndOccurrences:", error);
      throw error;
    }
  }

  /**
   * Fetch data with a limit to prevent excessive loading
   */
  async fetchLimitedData(
    url: string,
    fields: string[] = [],
    filters: string[] = [],
    offset: number = 0,
    maxItems: number = 100
  ): Promise<any[]> {
    const requestUrl = new URL(url);
    if (fields.length) {
      requestUrl.searchParams.set("fields", fields.join(","));
    }
    filters.forEach((filter) => {
      requestUrl.searchParams.append("filters", filter);
    });
    requestUrl.searchParams.set("offset", offset.toString());
    requestUrl.searchParams.set("limit", maxItems.toString());

    try {
      const response = await this.fetch(requestUrl.toString());
      return response.data || [];
    } catch (error) {
      console.error("Error in fetchLimitedData:", error);
      throw error;
    }
  }

  /**
   * Legacy recursive fetch method (kept for reference, but not used in new code)
   * This method is deprecated - use fetchPagedData or fetchLimitedData instead
   */
  async recursiveFetch(
    url: string,
    fields: string[] = [],
    filters: string[] = [],
    items: any[] = [],
    pageAfter?: string,
    maxItems: number = 500, // Added a limit to prevent infinite recursion
    currentItems: number = 0 // Track how many items we've fetched so far
  ): Promise<any[]> {
    // If we've reached the maximum number of items, stop recursion
    if (currentItems >= maxItems) {
      console.warn(
        `Reached maximum item limit (${maxItems}). Stopping recursion.`
      );
      return items;
    }

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
    const newData = items.concat(response.data || []);
    const newCurrentItems = currentItems + (response.data?.length || 0);

    if (response.moreAfter && newCurrentItems < maxItems) {
      return this.recursiveFetch(
        url,
        fields,
        filters,
        newData,
        response.moreAfter,
        maxItems,
        newCurrentItems
      );
    }
    return newData;
  }
}
