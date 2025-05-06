import { ApiService } from "./api.service";
import type { ComponentContext } from "@ixon-cdk/types";
import type { Alarm } from "../types";
import { DateTime } from "luxon";

export class AlarmsManager {
  apiService: ApiService;
  context: ComponentContext;

  constructor(context: ComponentContext) {
    this.context = context;
    this.apiService = new ApiService(context);
  }

  /**
   * Get alarm occurrences for an agent with pagination support
   */
  async getAllAlarmOccurrencesForAgent(
    agentId: string,
    pageSize: number = 50,
    pageAfter?: string,
    searchQuery?: string,
    forceFresh: boolean = false
  ): Promise<{ alarms: Alarm[]; moreAfter?: string }> {
    console.log(
      "Fetching alarm data and occurrences for agent ID:",
      agentId,
      "with pageAfter:",
      pageAfter,
      "and searchQuery:",
      searchQuery,
      "forceFresh:",
      forceFresh
    );

    try {
      // Get data with pagination
      const result = await this.apiService.getAlarmsAndOccurrences(
        agentId,
        pageSize,
        pageAfter,
        searchQuery,
        forceFresh
      );

      // Process the alarms for display
      const processedAlarms = this.processAlarmsForDisplay(result.alarms);

      return {
        alarms: processedAlarms,
        moreAfter: result.moreAfter,
      };
    } catch (error) {
      console.error("Error in getAllAlarmOccurrencesForAgent:", error);
      throw error;
    }
  }

  /**
   * Process alarms for display - moved from Svelte component
   */
  private processAlarmsForDisplay(alarms: Alarm[]): Alarm[] {
    // Additional processing logic can be moved here
    // This centralizes the data transformation logic
    return alarms.map((alarm) => ({
      ...alarm,
      // Sort occurrences by date descending (newest first)
      occurrences: [...alarm.occurrences].sort((a, b) => {
        const dateA = a.occurredOn ? new Date(a.occurredOn).getTime() : 0;
        const dateB = b.occurredOn ? new Date(b.occurredOn).getTime() : 0;
        return dateB - dateA;
      }),
    }));
  }

  /**
   * Refresh cache and fetch fresh data
   */
  refreshData() {
    this.apiService.clearCache();
  }

  /**
   * Format date for display with proper time zone handling
   */
  static formatDate(dateString: string | undefined, timeZone?: string) {
    if (!dateString) {
      return {
        fullDate: "No Date Provided",
        dateOnly: "No Date Provided",
        timeOnly: "No Time Provided",
        formattedDate: "No Date Provided",
      };
    }

    // Use the provided time zone or UTC as fallback
    const dt = DateTime.fromISO(dateString, {
      zone: timeZone || "UTC",
    });

    if (!dt.isValid) {
      console.warn(`Invalid date format: ${dateString}`);
      return {
        fullDate: dateString,
        dateOnly: "Invalid Date",
        timeOnly: "Invalid Time",
        formattedDate: "Invalid Date/Time",
      };
    }

    return {
      fullDate: dt.toISO(),
      dateOnly: dt.toFormat("dd-MM-yyyy"),
      timeOnly: dt.toFormat("HH:mm"),
      formattedDate: dt.toFormat("dd-MM-yyyy HH:mm"),
    };
  }
}
