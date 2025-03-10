import { DateTime } from "luxon";

// Utility class to manage special handling for agents with large data volumes
export class ProblematicAgentHandler {
  // List of agent IDs known to have performance issues
  private static problematicAgents = [
    "jQI6ueiRSQQl",
    // Add more agent IDs as you discover them
  ];

  // Check if an agent is in the problematic list
  static isProblematicAgent(agentId: string): boolean {
    return this.problematicAgents.includes(agentId);
  }

  // Get recommended time range in days for this agent
  static getRecommendedTimeRange(agentId: string): number {
    if (this.isProblematicAgent(agentId)) {
      return 3; // 3 days for problematic agents
    }
    return 28; // Default 4 weeks for normal agents
  }

  // Adjust any time range to a safe value for this agent
  static getSafeDateRange(
    agentId: string,
    endDate: Date
  ): { from: Date; to: Date } {
    const to = new Date(endDate);
    let from: Date;

    if (this.isProblematicAgent(agentId)) {
      // For problematic agents, limit to recommended days from now
      from = new Date(to);
      from.setDate(from.getDate() - this.getRecommendedTimeRange(agentId));
    } else {
      // Normal range for other agents
      from = new Date(to);
      from.setDate(from.getDate() - 28); // 4 weeks
    }

    return { from, to };
  }

  // Get appropriate API request options for this agent
  static getApiOptions(agentId: string): {
    pageSize: number;
    maxPages: number;
    timeout: number;
    retryDelay: number;
  } {
    if (this.isProblematicAgent(agentId)) {
      return {
        pageSize: 25, // Smaller page size
        maxPages: 3, // Fewer pages
        timeout: 10000, // 10 second timeout
        retryDelay: 1000, // 1 second between retries
      };
    }

    // Default options for normal agents
    return {
      pageSize: 100,
      maxPages: 10,
      timeout: 30000, // 30 seconds
      retryDelay: 500, // Half a second
    };
  }

  // Get warning message for users with problematic agents
  static getWarningMessage(agentId: string): string | null {
    if (this.isProblematicAgent(agentId)) {
      return "This agent has a large amount of data. For best performance, please use a time range of 3 days or less.";
    }
    return null;
  }

  // Check if current range exceeds recommendations
  static isTimeRangeExcessive(agentId: string, from: Date, to: Date): boolean {
    if (!this.isProblematicAgent(agentId)) {
      return false;
    }

    const fromDt = DateTime.fromJSDate(from);
    const toDt = DateTime.fromJSDate(to);
    const diffDays = toDt.diff(fromDt, "days").days;

    return diffDays > this.getRecommendedTimeRange(agentId);
  }
}
