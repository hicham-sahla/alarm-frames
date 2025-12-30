import type { ComponentContext } from "@ixon-cdk/types";
// Zorg ervoor dat Occurrence geïmporteerd is vanuit je types
import type { Alarm, Occurrence } from "../types"; // Occurrence is nodig
import { DateTime } from "luxon";
import { parseSearchDate } from "../utils/search-utils";
// Importeer AlarmsManager om de statische formatDate methode te gebruiken
import { AlarmsManager } from "./alarms-manager"; // Zorg ervoor dat deze import aanwezig is

interface CacheItem {
  data: any;
  timestamp: number;
  expiresAt: number;
}

export class ApiService {
  context: ComponentContext;
  headers: Record<string, string>;
  cache: Map<string, CacheItem> = new Map();
  cacheTTL: number = 5 * 60 * 1000; // 5 minuten in milliseconden

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

  getCacheKey(url: string, params?: Record<string, any>): string {
    let key = url;
    if (params) {
      key += JSON.stringify(params);
    }
    return key;
  }

  isCacheValid(cacheItem: CacheItem): boolean {
    return Date.now() < cacheItem.expiresAt;
  }

  async fetchWithCache(
    url: string,
    params?: Record<string, any>,
    forceFresh: boolean = false
  ): Promise<any> {
    const cacheKey = this.getCacheKey(url, params);
    if (!forceFresh && this.cache.has(cacheKey)) {
      const cachedItem = this.cache.get(cacheKey)!;
      if (this.isCacheValid(cachedItem)) {
        // console.log(`Using cached data for ${cacheKey}`); // Uitgecommentarieerd voor schonere logs
        return cachedItem.data;
      }
    }
    // console.log(`Workspaceing fresh data for ${url}`); // Uitgecommentarieerd voor schonere logs
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
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`HTTP error! status: ${response.status}`, errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
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

  clearCache(cacheKey?: string) {
    if (cacheKey) {
      this.cache.delete(cacheKey);
    } else {
      this.cache.clear();
    }
  }

  // De bestaande getAlarmsAndOccurrences methode blijft hier ongewijzigd.
  async getAlarmsAndOccurrences(
    agentId: string,
    pageSize: number = 50,
    pageAfter?: string,
    searchQuery?: string,
    forceFresh: boolean = false
  ): Promise<{ alarms: Alarm[]; moreAfter?: string }> {
    try {
      // Single API call with alarm subresource
      const occurrencesUrl = this.context.getApiUrl(
        "AgentDataAlarmOccurrenceList",
        { agentId }
      );

      const occurrencesParams: Record<string, any> = {
        fields: [
          "publicId",
          "occurredOn",
          "alarm.publicId",
          "alarm.name",
          "alarm.severity",
        ],
        "page-size": pageSize,
        sort: "-occurredOn",
      };

      if (pageAfter) {
        occurrencesParams["page-after"] = pageAfter;
      }

      if (searchQuery && searchQuery.trim() !== "") {
        const trimmedQuery = searchQuery.trim();

        if (
          trimmedQuery.startsWith("(occurredOn ge") &&
          trimmedQuery.includes(" and occurredOn le")
        ) {
          occurrencesParams["filters"] = [trimmedQuery];
        } else {
          const filterConditions: string[] = [];
          const dateCheck = parseSearchDate(
            trimmedQuery.toLowerCase(),
            this.context.appData.timeZone
          );

          if (dateCheck.isDate && dateCheck.apiFilters.length > 0) {
            filterConditions.push(...dateCheck.apiFilters);
          } else {
            filterConditions.push(
              `contains(publicId,"${trimmedQuery}")`,
              `contains(alarm.name,"${trimmedQuery}")`
            );
            if (trimmedQuery.length >= 3) {
              filterConditions.push(`startswith(publicId,"${trimmedQuery}")`);
            }
          }

          if (filterConditions.length > 0) {
            occurrencesParams["filters"] = [
              `(${filterConditions.join(" or ")})`,
            ];
          }
        }
      }

      const occurrencesResponse = await this.fetchWithCache(
        occurrencesUrl,
        occurrencesParams,
        forceFresh || !!pageAfter
      );

      // Group occurrences by alarm
      const alarmMap = new Map<string, Alarm>();

      occurrencesResponse.data.forEach((occurrence: any) => {
        const alarmId = occurrence.alarm?.publicId;

        if (alarmId) {
          if (!alarmMap.has(alarmId)) {
            alarmMap.set(alarmId, {
              publicId: alarmId,
              name: occurrence.alarm?.name || "Unknown Alarm",
              severity: occurrence.alarm?.severity || "unknown",
              occurrences: [],
              agent: null as any,
              source: null,
            });
          }
          alarmMap.get(alarmId)!.occurrences.push(occurrence);
        }
      });

      const processedAlarms: Alarm[] = Array.from(alarmMap.values());

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
  // EINDE VAN BESTAANDE getAlarmsAndOccurrences

  // NIEUWE METHODE voor een platte, gesorteerde lijst van occurrences
  async getFlatSortedOccurrences(
    agentId: string,
    pageSize: number = 50,
    pageAfter?: string,
    searchQuery?: string,
    forceFresh: boolean = false
  ): Promise<{ occurrences: Occurrence[]; moreAfter?: string }> {
    try {
      // Single API call - alarm data now comes as subresource
      const occurrencesUrl = this.context.getApiUrl(
        "AgentDataAlarmOccurrenceList",
        { agentId }
      );

      const occurrencesParams: Record<string, any> = {
        // Request alarm subresource fields directly
        fields: [
          "publicId",
          "occurredOn",
          "alarm.publicId",
          "alarm.name",
          "alarm.severity",
        ],
        "page-size": pageSize,
        sort: "-occurredOn",
      };

      if (pageAfter) {
        occurrencesParams["page-after"] = pageAfter;
      }

      // Build search filters
      if (searchQuery && searchQuery.trim() !== "") {
        const trimmedQueryOriginalCase = searchQuery.trim();
        const trimmedQueryForParsing = trimmedQueryOriginalCase.toLowerCase();

        if (
          trimmedQueryOriginalCase.startsWith("(occurredOn ge") &&
          trimmedQueryOriginalCase.includes(" and occurredOn le")
        ) {
          occurrencesParams["filters"] = [trimmedQueryOriginalCase];
        } else {
          const filterConditions: string[] = [];
          const dateCheck = parseSearchDate(
            trimmedQueryForParsing,
            this.context.appData.timeZone
          );

          if (dateCheck.isDate && dateCheck.apiFilters.length > 0) {
            filterConditions.push(...dateCheck.apiFilters);
          } else {
            // Search in occurrence ID and alarm subresource fields
            filterConditions.push(
              `contains(publicId,"${trimmedQueryOriginalCase}")`,
              `contains(alarm.name,"${trimmedQueryOriginalCase}")`,
              `contains(alarm.severity,"${trimmedQueryOriginalCase}")`
            );

            if (trimmedQueryOriginalCase.length >= 2) {
              filterConditions.push(
                `startswith(publicId,"${trimmedQueryOriginalCase}")`,
                `contains(publicId,"-${trimmedQueryOriginalCase}")`
              );
            }
          }

          if (filterConditions.length > 0) {
            occurrencesParams["filters"] = [
              `(${filterConditions.join(" or ")})`,
            ];
          }
        }
      }

      const rawOccurrencesResponse = await this.fetchWithCache(
        occurrencesUrl,
        occurrencesParams,
        forceFresh || !!pageAfter
      );

      // Transform response - alarm data now comes directly from response
      const enrichedOccurrences: Occurrence[] = rawOccurrencesResponse.data.map(
        (rawOcc: any) => {
          const formattedDate = AlarmsManager.formatDate(rawOcc.occurredOn);

          return {
            publicId: rawOcc.publicId,
            name: rawOcc.alarm?.name || "Unknown Alarm",
            occurredOn: formattedDate,
            severity: rawOcc.alarm?.severity || "Unknown",
          };
        }
      );

      return {
        occurrences: enrichedOccurrences,
        moreAfter: rawOccurrencesResponse.moreAfter,
      };
    } catch (error) {
      console.error("Error in getFlatSortedOccurrences:", error);
      return {
        occurrences: [],
        moreAfter: undefined,
      };
    }
  }
}
