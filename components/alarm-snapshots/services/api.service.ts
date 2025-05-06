import type {
  ComponentContext,
  AgentDataAlarmOccurrence,
} from "@ixon-cdk/types";
import type { Alarm } from "../types";
import { DateTime } from "luxon";
import { parseSearchDate } from "../utils/search-utils";

interface CacheItem {
  data: any;
  timestamp: number;
  expiresAt: number;
}

export class ApiService {
  context: ComponentContext;
  headers: Record<string, string>;
  cache: Map<string, CacheItem> = new Map();
  cacheTTL: number = 5 * 60 * 1000; // 5 minutes in milliseconds

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
   * Get cache key for a request
   */
  getCacheKey(url: string, params?: Record<string, any>): string {
    let key = url;
    if (params) {
      key += JSON.stringify(params);
    }
    return key;
  }

  /**
   * Check if a cached item is valid
   */
  isCacheValid(cacheItem: CacheItem): boolean {
    return Date.now() < cacheItem.expiresAt;
  }

  /**
   * Get data from cache or fetch from API
   */
  async fetchWithCache(
    url: string,
    params?: Record<string, any>,
    forceFresh: boolean = false
  ): Promise<any> {
    const cacheKey = this.getCacheKey(url, params);

    // Return from cache if available and not force refreshing
    if (!forceFresh && this.cache.has(cacheKey)) {
      const cachedItem = this.cache.get(cacheKey)!;
      if (this.isCacheValid(cachedItem)) {
        console.log(`Using cached data for ${cacheKey}`);
        return cachedItem.data;
      }
    }

    // Fetch fresh data
    console.log(`Fetching fresh data for ${url}`);
    try {
      const requestUrl = new URL(url);
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach((item) => requestUrl.searchParams.append(key, item));
          } else if (value !== undefined) {
            requestUrl.searchParams.set(key, value.toString());
          }
        });
      }

      const response = await fetch(requestUrl.toString(), {
        method: "GET",
        headers: this.headers,
        cache: forceFresh ? "no-cache" : "default",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`HTTP error! status: ${response.status}`, errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Store in cache
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + this.cacheTTL,
      });

      return data;
    } catch (error) {
      console.error(`Error fetching from ${url}:`, error);
      throw error;
    }
  }

  /**
   * Clear the entire cache or specific items
   */
  clearCache(cacheKey?: string) {
    if (cacheKey) {
      this.cache.delete(cacheKey);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get alarms and occurrences with optimized pagination
   */
  async getAlarmsAndOccurrences(
    agentId: string,
    pageSize: number = 50,
    pageAfter?: string,
    searchQuery?: string,
    forceFresh: boolean = false
  ): Promise<{ alarms: Alarm[]; moreAfter?: string }> {
    console.log("getAlarmsAndOccurrences Input:", {
      agentId,
      pageSize,
      pageAfter,
      searchQuery,
      forceFresh,
    });

    try {
      // 1. Fetch alarms (this is usually a smaller dataset)
      const alarmsUrl = this.context.getApiUrl("AgentDataAlarmList", {
        agentId,
      });

      // Only request the fields we need
      const alarmsParams = {
        fields: ["publicId", "name", "severity"],
        "page-size": 500, // Get more alarms at once since it's typically a small dataset
      };

      // Cache alarms separately as they change less frequently
      const alarmsResponse = await this.fetchWithCache(
        alarmsUrl,
        alarmsParams,
        forceFresh
      );

      // 2. Fetch occurrences with pagination
      const occurrencesUrl = this.context.getApiUrl(
        "AgentDataAlarmOccurrenceList",
        { agentId }
      );

      const occurrencesParams: Record<string, any> = {
        fields: ["publicId", "occurredOn", "alarm"],
        "page-size": pageSize,
        // IXON uses this syntax for sorting - ensure newest first
        sort: "-occurredOn",
        // Force no-cache for occurrences to always get the latest data
        "cache-control": "no-cache",
        // Do not add custom filters that might break the API
      };

      // Add pagination parameters
      if (pageAfter) {
        occurrencesParams["page-after"] = pageAfter;
      }
      if (forceFresh) {
        // When force refreshing, clear all cache first
        this.clearCache();
      }
      // Add search filter if provided
      if (searchQuery && searchQuery.trim() !== "") {
        const trimmedQuery = searchQuery.trim();

        // Check if the search query is already a fully formed date range filter
        if (
          trimmedQuery.startsWith("(occurredOn ge") &&
          trimmedQuery.includes(" and occurredOn le")
        ) {
          // This is already a date range filter - use it directly
          occurrencesParams["filters"] = [trimmedQuery];
        } else {
          const filterConditions = [];

          // Check if the search query looks like a date
          const dateCheck = parseSearchDate(
            trimmedQuery,
            this.context.appData.timeZone
          );

          if (dateCheck.isDate && dateCheck.apiFilters.length > 0) {
            // Add date-specific filters
            filterConditions.push(...dateCheck.apiFilters);
          } else {
            // Regular search conditions - ID and name
            filterConditions.push(
              `contains(publicId,"${trimmedQuery}")`,
              `contains(alarm.name,"${trimmedQuery}")`
            );

            // Try to match partial IDs for longer search terms
            if (trimmedQuery.length >= 3) {
              // This is a simplified example - actual DB might not support this exact syntax
              filterConditions.push(`startswith(publicId,"${trimmedQuery}")`);
            }
          }

          // Join with 'or' to match any of the conditions
          occurrencesParams["filters"] = [`(${filterConditions.join(" or ")})`];
        }
      }

      // Always force fresh data for occurrences when specifically requested
      const occurrencesResponse = await this.fetchWithCache(
        occurrencesUrl,
        occurrencesParams,
        forceFresh || !!pageAfter // Always fetch fresh data when paginating or force refresh is requested
      );

      // Process alarms with their occurrences
      const processedAlarms: Alarm[] = [];
      const alarmMap = new Map<string, Alarm>();

      // Create a map of alarms by publicId for quick lookup
      alarmsResponse.data.forEach((alarm: any) => {
        alarmMap.set(alarm.publicId, {
          ...alarm,
          occurrences: [],
          agent: null as any,
          source: null,
        });
      });

      // Assign occurrences to their respective alarms
      const nullAlarmOccurrences: AgentDataAlarmOccurrence[] = [];

      occurrencesResponse.data.forEach(
        (occurrence: AgentDataAlarmOccurrence) => {
          if (occurrence.alarm && occurrence.alarm.publicId) {
            const alarm = alarmMap.get(occurrence.alarm.publicId);
            if (alarm) {
              alarm.occurrences.push(occurrence);
            }
          } else {
            nullAlarmOccurrences.push(occurrence);
          }
        }
      );

      // Convert map back to array and filter alarms with occurrences
      alarmMap.forEach((alarm) => {
        if (alarm.occurrences.length > 0) {
          processedAlarms.push(alarm);
        }
      });

      // Add occurrences with null alarms if any
      if (nullAlarmOccurrences.length > 0) {
        processedAlarms.push({
          publicId: "null-alarm-occurrences",
          name: "Unbound Alarm",
          severity: "unknown",
          occurrences: nullAlarmOccurrences,
          agent: null as any,
          source: null,
        });
      }

      return {
        alarms: processedAlarms,
        moreAfter: occurrencesResponse.moreAfter,
      };
    } catch (error) {
      console.error("Error in getAlarmsAndOccurrences:", error);
      return {
        alarms: [],
        moreAfter: undefined,
      };
    }
  }
}
