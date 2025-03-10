import { ApiService } from "./api.service";
import type { ComponentContext } from "@ixon-cdk/types";
import type { Alarm } from "../types";

export class AlarmsManager {
  apiService: ApiService;
  context: ComponentContext;
  private isLoading: boolean = false;
  private lastRequestId: number = 0;
  private fallbackAttempted: boolean = false;

  constructor(context: ComponentContext) {
    this.context = context;
    this.apiService = new ApiService(context);
  }

  async getAllAlarmOccurrencesForAgent(
    agentId: string,
    from: Date,
    to: Date,
    forceRefresh: boolean = false
  ): Promise<Alarm[]> {
    if (this.isLoading) {
      console.log(
        "A request is already in progress, cancelling previous request"
      );
      this.lastRequestId++;
    }

    this.isLoading = true;
    const currentRequestId = this.lastRequestId;
    this.fallbackAttempted = false;

    console.log(
      "Fetching alarm data and occurrences for agent ID:",
      agentId,
      "Force refresh:",
      forceRefresh
    );

    try {
      // Try the main request with potential fallback
      const result = await this.apiService.getAlarmsWithFallback(
        agentId,
        from,
        to,
        forceRefresh
      );

      // Check if this request is still the current one
      if (currentRequestId !== this.lastRequestId) {
        console.log("Request was superseded by a newer request");
        return [];
      }

      return result;
    } catch (error) {
      console.error("Error fetching alarm data:", error);

      // If this is the first attempt to fallback, try one more time with a much smaller range
      if (!this.fallbackAttempted && currentRequestId === this.lastRequestId) {
        this.fallbackAttempted = true;
        console.log(
          "Critical error occurred, attempting emergency fallback with 24-hour window"
        );

        try {
          // Try with just the last 24 hours as a last resort
          const toDate = new Date(to);
          const emergencyFromDate = new Date(toDate);
          emergencyFromDate.setHours(emergencyFromDate.getHours() - 24);

          // Clear any cached data
          this.apiService.clearCache();

          return await this.apiService.getAlarmsAndOccurrences(
            agentId,
            emergencyFromDate,
            toDate,
            true
          );
        } catch (fallbackError) {
          console.error("Emergency fallback also failed:", fallbackError);
          return [];
        }
      }

      return [];
    } finally {
      if (currentRequestId === this.lastRequestId) {
        this.isLoading = false;
      }
    }
  }

  // Method to refresh data by clearing cache
  refreshData(): void {
    this.apiService.clearCache();
  }

  // Method to check if an agent is known to be problematic
  isProblematicAgent(agentId: string): boolean {
    const problematicAgents = ["jQI6ueiRSQQl"]; // Add your problematic agent IDs here
    return problematicAgents.includes(agentId);
  }

  // Get recommended time range for an agent
  getRecommendedTimeRange(agentId: string): number {
    // For problematic agents, recommend a shorter time range in days
    if (this.isProblematicAgent(agentId)) {
      return 3; // 3 days
    }
    return 28; // Default 4 weeks (28 days)
  }
}
