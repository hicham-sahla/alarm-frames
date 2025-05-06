import { ApiService } from "./api.service";
import type { ComponentContext } from "@ixon-cdk/types";
// Zorg ervoor dat Occurrence type geïmporteerd wordt
import type { Alarm, Occurrence } from "../types";
import { DateTime } from "luxon";

export class AlarmsManager {
  apiService: ApiService;
  context: ComponentContext;

  constructor(context: ComponentContext) {
    this.context = context;
    this.apiService = new ApiService(context);
  }

  // De bestaande getAllAlarmOccurrencesForAgent methode blijft hier ongewijzigd.
  async getAllAlarmOccurrencesForAgent(
    agentId: string,
    pageSize: number = 50,
    pageAfter?: string,
    searchQuery?: string,
    forceFresh: boolean = false
  ): Promise<{ alarms: Alarm[]; moreAfter?: string }> {
    // console.log( // Uitgecommentarieerd voor schonere logs
    //   "Fetching alarm data and occurrences for agent ID:",
    //   agentId,
    //   "with pageAfter:",
    //   pageAfter,
    //   "and searchQuery:",
    //   searchQuery
    // );

    try {
      const result = await this.apiService.getAlarmsAndOccurrences(
        agentId,
        pageSize,
        pageAfter,
        searchQuery,
        forceFresh
      );
      const processedAlarms = this.processAlarmsForDisplay(result.alarms);
      return {
        alarms: processedAlarms,
        moreAfter: result.moreAfter,
      };
    } catch (error) {
      console.error("Error in getAllAlarmOccurrencesForAgent:", error);
      // Gooi de error door of retourneer een lege state, afhankelijk van gewenst gedrag
      // throw error;
      return { alarms: [], moreAfter: undefined };
    }
  }
  // EINDE VAN BESTAANDE getAllAlarmOccurrencesForAgent

  // De bestaande processAlarmsForDisplay methode blijft hier ongewijzigd.
  private processAlarmsForDisplay(alarms: Alarm[]): Alarm[] {
    return alarms.map((alarm) => ({
      ...alarm,
      occurrences: [...alarm.occurrences].sort((a, b) => {
        // Zorg voor robuuste datuming checks
        const dateAValid =
          a.occurredOn && DateTime.fromISO(a.occurredOn).isValid;
        const dateBValid =
          b.occurredOn && DateTime.fromISO(b.occurredOn).isValid;

        // Gebruik toMillis() voor een numerieke vergelijking van datums
        const dateA = dateAValid
          ? DateTime.fromISO(a.occurredOn!).toMillis()
          : 0;
        const dateB = dateBValid
          ? DateTime.fromISO(b.occurredOn!).toMillis()
          : 0;
        return dateB - dateA; // Sorteer aflopend (nieuwste eerst)
      }),
    }));
  }
  // EINDE VAN BESTAANDE processAlarmsForDisplay

  /**
   * Haalt een platte lijst op van wereldwijd gesorteerde alarmgebeurtenissen voor een agent.
   * Deze nieuwe methode zal door de component worden gebruikt om de tabel weer te geven.
   */
  async getGloballySortedAlarmOccurrences(
    agentId: string,
    pageSize: number = 50,
    pageAfter?: string,
    searchQuery?: string,
    forceFresh: boolean = false
  ): Promise<{ occurrences: Occurrence[]; moreAfter?: string }> {
    // console.log( // Uitgecommentarieerd voor schonere logs
    //   "Fetching globally sorted occurrences for agent ID:",
    //   agentId,
    //   "with pageAfter:",
    //   pageAfter,
    //   "and searchQuery:",
    //   searchQuery,
    //   "forceFresh:",
    //   forceFresh
    // );

    try {
      // Roep de nieuwe API service methode aan
      const result = await this.apiService.getFlatSortedOccurrences(
        agentId,
        pageSize,
        pageAfter,
        searchQuery,
        forceFresh
      );

      // De data zou al in het correcte Occurrence formaat moeten zijn en gesorteerd.
      return result;
    } catch (error) {
      console.error("Error in getGloballySortedAlarmOccurrences:", error);
      return { occurrences: [], moreAfter: undefined }; // Retourneer lege state bij error
    }
  }

  refreshData() {
    this.apiService.clearCache();
  }

  // De formatDate methode is aangepast voor meer robuustheid.
  static formatDate(dateString: string | undefined | null): {
    fullDate: string;
    dateOnly: string;
    timeOnly: string;
    formattedDate: string;
  } {
    if (!dateString) {
      return {
        fullDate: "No Date Provided",
        dateOnly: "No Date Provided",
        timeOnly: "No Time Provided",
        formattedDate: "No Date Provided",
      };
    }
    const dt = DateTime.fromISO(dateString);
    if (!dt.isValid) {
      // console.warn("Invalid date string for Luxon:", dateString, dt.invalidReason, dt.invalidExplanation); // Uitgecommentarieerd
      return {
        fullDate: dateString,
        dateOnly: "Invalid Date",
        timeOnly: "Invalid Time",
        formattedDate: "Invalid Date Format",
      };
    }
    return {
      fullDate: dt.toISO()!,
      dateOnly: dt.toFormat("dd-MM-yyyy"),
      timeOnly: dt.toFormat("HH:mm"),
      formattedDate: dt.toFormat("dd-MM-yyyy HH:mm"),
    };
  }
}
