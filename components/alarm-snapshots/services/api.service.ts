import type {
  ComponentContext,
  AgentDataAlarmOccurrence,
} from "@ixon-cdk/types";
import type { Alarm } from "../types";
import { DateTime } from "luxon";

// Add a cache to avoid repeated API calls
interface CacheItem {
  data: any[];
  timestamp: number;
  params: string; // Serialized parameters
}

export class ApiService {
  context: ComponentContext;
  headers: {};
  // Cache responses for 5 minutes
  private cache: Map<string, CacheItem> = new Map();
  private CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes in milliseconds
  private MAX_PAGES = 5; // Reduced from 10 to 5 to avoid excessive requests
  private PAGE_SIZE = 50; // Reduced from 100 to 50 for better stability
  private FETCH_TIMEOUT = 15000; // 15 seconds timeout for API calls
  private MAX_RETRIES = 2; // Number of retries for failed requests

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

  // Fetch with timeout and retry logic
  async fetch(url: string, retryCount = 0): Promise<any> {
    console.log(`Fetching from URL: ${url}`);

    // Create an abort controller for the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.headers,
        signal: controller.signal,
      });

      // Clear the timeout since request completed
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return response.json();
    } catch (error: any) {
      // Clear timeout in case of error
      clearTimeout(timeoutId);

      console.error(`Error fetching from ${url}:`, error);

      // If it's an abort error (timeout) or we have retries left
      if (
        (error.name === "AbortError" || error.name === "TypeError") &&
        retryCount < this.MAX_RETRIES
      ) {
        console.log(`Retry attempt ${retryCount + 1} for ${url}`);
        // Exponential backoff - wait longer between each retry
        const backoffTime = Math.pow(2, retryCount) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        return this.fetch(url, retryCount + 1);
      }

      // If we've exhausted retries or it's another error, throw it
      throw error;
    }
  }

  // Create cache key from parameters
  private getCacheKey(
    url: string,
    fields: string[],
    filters: string[]
  ): string {
    return `${url}|${fields.join(",")}|${filters.join(",")}`;
  }

  // Check if cached data is valid
  private getCachedData(key: string): any[] | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_EXPIRY) {
      console.log("Using cached data");
      return cached.data;
    }
    return null;
  }

  // Reduce date range size for problematic agents
  private adjustDateRangeIfNeeded(
    agentId: string,
    from: Date,
    to: Date
  ): [Date, Date] {
    // List of agent IDs known to have data volume issues
    const problematicAgents = ["jQI6ueiRSQQl"]; // Add your problematic agent IDs here

    if (problematicAgents.includes(agentId)) {
      const toDateTime = DateTime.fromJSDate(to);
      const fromDateTime = DateTime.fromJSDate(from);

      // Calculate duration in days
      const durationDays = toDateTime.diff(fromDateTime, "days").days;

      // If time range is greater than 7 days for problematic agents, limit to 7 days
      if (durationDays > 7) {
        console.log(
          `Limiting date range for problematic agent ${agentId} from ${durationDays} to 7 days`
        );
        // Set new from date to 7 days before to date
        const newFrom = toDateTime.minus({ days: 7 }).toJSDate();
        return [newFrom, to];
      }
    }

    return [from, to];
  }

  async getAlarmsAndOccurrences(
    agentId: string,
    from: Date,
    to: Date,
    forceRefresh = false
  ): Promise<Alarm[]> {
    // Adjust date range for problematic agents
    [from, to] = this.adjustDateRangeIfNeeded(agentId, from, to);

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

    // Generate cache keys
    const alarmsCacheKey = this.getCacheKey(
      alarmsUrl,
      ["name", "severity"],
      []
    );
    const occurrencesCacheKey = this.getCacheKey(
      occurrencesUrl,
      ["alarm.publicId", "occurredOn"],
      dateFilter
    );

    // Check cache first if not forcing refresh
    let alarmsResponse, occurrencesResponse;
    if (!forceRefresh) {
      alarmsResponse = this.getCachedData(alarmsCacheKey);
      occurrencesResponse = this.getCachedData(occurrencesCacheKey);
    }

    // If not in cache or forcing refresh, fetch data
    const fetchPromises = [];
    if (!alarmsResponse) {
      fetchPromises.push(
        this.recursiveFetch(alarmsUrl, ["name", "severity"], [])
          .then((data) => {
            this.cache.set(alarmsCacheKey, {
              data,
              timestamp: Date.now(),
              params: alarmsCacheKey,
            });
            return data;
          })
          .catch((error) => {
            console.error("Error fetching alarms:", error);
            // Return an empty array if fetch fails
            return [];
          })
      );
    } else {
      fetchPromises.push(Promise.resolve(alarmsResponse));
    }

    if (!occurrencesResponse) {
      fetchPromises.push(
        this.recursiveFetch(
          occurrencesUrl,
          ["alarm.publicId", "occurredOn"],
          dateFilter
        )
          .then((data) => {
            this.cache.set(occurrencesCacheKey, {
              data,
              timestamp: Date.now(),
              params: occurrencesCacheKey,
            });
            return data;
          })
          .catch((error) => {
            console.error("Error fetching occurrences:", error);
            // Return an empty array if fetch fails
            return [];
          })
      );
    } else {
      fetchPromises.push(Promise.resolve(occurrencesResponse));
    }

    try {
      // Wait for both promises to resolve
      const [alarms, occurrences] = await Promise.all(fetchPromises);

      // If we have no alarms, return empty array
      if (!alarms || alarms.length === 0) {
        return [];
      }

      // Process data in chunks to avoid UI blocking
      const results: Alarm[] = [];
      const chunkSize = 50;

      for (let i = 0; i < alarms.length; i += chunkSize) {
        const alarmChunk = alarms.slice(i, i + chunkSize);

        const processedChunk = alarmChunk.map((alarm: any) => ({
          ...alarm,
          occurrences: (occurrences || []).filter(
            (occ: AgentDataAlarmOccurrence) =>
              occ && occ.alarm && occ.alarm.publicId === alarm.publicId
          ),
        }));

        results.push(...processedChunk);
      }

      return results;
    } catch (error) {
      console.error("Error in getAlarmsAndOccurrences:", error);
      // Return empty array in case of critical error
      return [];
    }
  }

  async recursiveFetch(
    url: string,
    fields: string[] = [],
    filters: string[] = [],
    items: any[] = [],
    pageAfter?: string,
    pageCount = 0
  ): Promise<any[]> {
    // Safety limit to prevent infinite recursion
    if (pageCount >= this.MAX_PAGES) {
      console.warn(
        `Reached maximum page limit (${this.MAX_PAGES}). Some data may be missing.`
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
      filters.forEach((filter) => {
        requestUrl.searchParams.append("filters", filter);
      });
    }

    // Add page size to limit data per request
    requestUrl.searchParams.set("page-size", this.PAGE_SIZE.toString());

    try {
      const response = await this.fetch(requestUrl.toString());

      // Check if we got valid data
      if (!response || !response.data) {
        console.warn("Received invalid response data:", response);
        return items; // Return what we have so far
      }

      const newData = items.concat(response.data || []);

      if (response.moreAfter && response.data && response.data.length > 0) {
        // Add a small delay between requests to avoid overwhelming the API
        await new Promise((resolve) => setTimeout(resolve, 300));

        // If we have more pages, recursively fetch them
        return this.recursiveFetch(
          url,
          fields,
          filters,
          newData,
          response.moreAfter,
          pageCount + 1
        );
      }
      return newData;
    } catch (error) {
      console.error("Error in recursive fetch:", error);
      // Return what we have so far in case of error
      return items;
    }
  }

  // Method to clear cache
  clearCache(): void {
    this.cache.clear();
    console.log("Cache cleared");
  }

  // Method to get alarms with fallback to shorter time periods
  async getAlarmsWithFallback(
    agentId: string,
    from: Date,
    to: Date,
    forceRefresh = false
  ): Promise<Alarm[]> {
    try {
      // Try with the full date range first
      const alarms = await this.getAlarmsAndOccurrences(
        agentId,
        from,
        to,
        forceRefresh
      );

      // If we got successful results, return them
      if (alarms && alarms.length > 0) {
        return alarms;
      }

      // If the original request failed or returned no data, try with a smaller date range
      console.log("Falling back to a smaller date range");
      const toDate = new Date(to);
      const fallbackFromDate = new Date(toDate);
      fallbackFromDate.setDate(fallbackFromDate.getDate() - 3); // Try with just 3 days

      // Clear cache for this specific request to ensure fresh data
      this.clearCache();

      return this.getAlarmsAndOccurrences(
        agentId,
        fallbackFromDate,
        toDate,
        true
      );
    } catch (error) {
      console.error("Error in getAlarmsWithFallback:", error);
      return [];
    }
  }
}
