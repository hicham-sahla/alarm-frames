import type {
  ComponentContext,
  AgentDataAlarmOccurrence,
  ResLink, // Zorg ervoor dat deze import aanwezig is
} from "@ixon-cdk/types";
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
    // console.log("getAlarmsAndOccurrences Input:", { // Uitgecommentarieerd voor schonere logs
    //   agentId,
    //   pageSize,
    //   pageAfter,
    //   searchQuery,
    // });

    try {
      const alarmsUrl = this.context.getApiUrl("AgentDataAlarmList", {
        agentId,
      });
      const alarmsParams = {
        fields: ["publicId", "name", "severity"],
        "page-size": 500,
      };
      const alarmsResponse = await this.fetchWithCache(
        alarmsUrl,
        alarmsParams,
        forceFresh
      );

      const occurrencesUrl = this.context.getApiUrl(
        "AgentDataAlarmOccurrenceList",
        { agentId }
      );
      const occurrencesParams: Record<string, any> = {
        fields: ["publicId", "occurredOn", "alarm"],
        "page-size": pageSize,
        sort: "-occurredOn",
      };

      if (pageAfter) {
        occurrencesParams["page-after"] = pageAfter;
      }

      if (searchQuery && searchQuery.trim() !== "") {
        const trimmedQuery = searchQuery.trim();
        if (
          trimmedQuery.startsWith("(occurredOn ge") && // API filter keys (occurredOn) zijn hoofdlettergevoelig
          trimmedQuery.includes(" and occurredOn le")
        ) {
          occurrencesParams["filters"] = [trimmedQuery];
        } else {
          const filterConditions = [];
          const dateCheck = parseSearchDate(
            trimmedQuery.toLowerCase(), // parseSearchDate werkt met lowercase voor flexibiliteit
            this.context.appData.timeZone
          );

          if (dateCheck.isDate && dateCheck.apiFilters.length > 0) {
            filterConditions.push(...dateCheck.apiFilters);
          } else {
            // Gebruik de originele casing voor filter waarden, tenzij API tolower ondersteunt
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

      const processedAlarms: Alarm[] = [];
      const alarmMap = new Map<string, Alarm>();
      alarmsResponse.data.forEach((alarm: any) => {
        alarmMap.set(alarm.publicId, {
          ...alarm,
          occurrences: [],
          agent: null as any,
          source: null,
        });
      });

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

      alarmMap.forEach((alarm) => {
        if (alarm.occurrences.length > 0) {
          processedAlarms.push(alarm);
        }
      });

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
  // EINDE VAN BESTAANDE getAlarmsAndOccurrences

  // NIEUWE METHODE voor een platte, gesorteerde lijst van occurrences
  async getFlatSortedOccurrences(
    agentId: string,
    pageSize: number = 50,
    pageAfter?: string,
    searchQuery?: string,
    forceFresh: boolean = false
  ): Promise<{ occurrences: Occurrence[]; moreAfter?: string }> {
    // console.log("getFlatSortedOccurrences Input:", { // Uitgecommentarieerd voor schonere logs
    //   agentId,
    //   pageSize,
    //   pageAfter,
    //   searchQuery,
    //   forceFresh
    // });

    try {
      // 1. Haal alarmdefinities op (cache deze effectief)
      const alarmsUrl = this.context.getApiUrl("AgentDataAlarmList", {
        agentId,
      });
      const alarmsParams = {
        fields: ["publicId", "name", "severity"],
        "page-size": 500,
      };
      const alarmsResponse = await this.fetchWithCache(
        alarmsUrl,
        alarmsParams,
        forceFresh
      );
      const alarmDetailsMap = new Map<
        string,
        { name: string; severity: string }
      >();
      alarmsResponse.data.forEach((alarm: any) => {
        alarmDetailsMap.set(alarm.publicId, {
          name: alarm.name,
          severity: alarm.severity,
        });
      });

      // 2. Haal occurrences op met paginering, wereldwijd gesorteerd
      const occurrencesUrl = this.context.getApiUrl(
        "AgentDataAlarmOccurrenceList",
        { agentId }
      );
      const occurrencesParams: Record<string, any> = {
        fields: ["publicId", "occurredOn", "alarm.publicId", "alarm.name"],
        "page-size": pageSize,
        sort: "-occurredOn",
      };

      if (pageAfter) {
        occurrencesParams["page-after"] = pageAfter;
      }

      if (searchQuery && searchQuery.trim() !== "") {
        const trimmedQueryOriginalCase = searchQuery.trim();
        const trimmedQueryForParsing = trimmedQueryOriginalCase.toLowerCase();

        if (
          trimmedQueryOriginalCase.startsWith("(occurredOn ge") &&
          trimmedQueryOriginalCase.includes(" and occurredOn le")
        ) {
          occurrencesParams["filters"] = [trimmedQueryOriginalCase];
        } else {
          const filterConditions = [];
          const dateCheck = parseSearchDate(
            trimmedQueryForParsing,
            this.context.appData.timeZone
          );

          if (dateCheck.isDate && dateCheck.apiFilters.length > 0) {
            filterConditions.push(...dateCheck.apiFilters);
          } else {
            filterConditions.push(
              `contains(publicId,"${trimmedQueryOriginalCase}")`,
              `contains(alarm.name,"${trimmedQueryOriginalCase}")`
            );
            if (trimmedQueryOriginalCase.length >= 3) {
              filterConditions.push(
                `startswith(publicId,"${trimmedQueryOriginalCase}")`
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

      // 3. Transformeer ruwe occurrences naar de gewenste Occurrence[] structuur
      const enrichedOccurrences: Occurrence[] = [];
      rawOccurrencesResponse.data.forEach(
        (
          rawOcc: AgentDataAlarmOccurrence & {
            alarm?: ResLink & { publicId?: string; name?: string };
          }
        ) => {
          const alarmId = rawOcc.alarm?.publicId;
          const alarmDetail = alarmId
            ? alarmDetailsMap.get(alarmId)
            : undefined;

          const formattedDate = AlarmsManager.formatDate(rawOcc.occurredOn);

          enrichedOccurrences.push({
            publicId: rawOcc.publicId,
            name: alarmDetail?.name || rawOcc.alarm?.name || "Unknown Alarm",
            occurredOn: formattedDate,
            severity: alarmDetail?.severity || "Unknown",
          });
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
