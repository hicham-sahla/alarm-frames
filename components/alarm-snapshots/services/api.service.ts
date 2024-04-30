import type { ComponentContext, Agent } from "@ixon-cdk/types";

export class ApiService {
  private context: ComponentContext;
  private headers: {};

  constructor(context: ComponentContext) {
    if (!context || !context.appData) {
      throw new Error("Context is not initialized or appData is missing");
    }
    this.context = context;
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${context.appData.accessToken.secretId}`,
      "Api-Application": context.appData.apiAppId,
      "Api-Company": context.appData.company.publicId,
      "Api-Version": "2",
    };
  }

  async fetch(url: string): Promise<any> {
    console.log("Fetching from URL:", url);
    return fetch(url, {
      method: "GET",
      headers: this.headers,
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("Data fetched:", data);
        return data.data;
      })
      .catch((error) => {
        console.error("API fetch error:", error);
        throw error;
      });
  }

  async getAgentDetails(agentId: string): Promise<any> {
    const url = `${this.context.componentBaseUrl}/api/agents/${agentId}`;
    return this.fetch(url);
  }

  async getAllAlarmOccurrences(
    agentId: string
  ): Promise<AgentDataAlarmOccurrence[]> {
    const url = `${this.context.componentBaseUrl}/api/agents/${agentId}/alarm-occurrences`;
    return this.fetch(url);
  }
}
