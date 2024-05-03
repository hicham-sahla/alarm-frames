<script lang="ts">
  import { onMount } from "svelte";
  import { AlarmsManager } from "./services/alarms-manager";
  import type {
    ComponentContext,
    ResourceData,
    ResourceDataResult,
  } from "@ixon-cdk/types";
  import type { Alarm } from "./types";

  export let context: ComponentContext;

  let alarmsManager: AlarmsManager;
  let alarms: Alarm[] = [];
  let loading = true;
  let agentId: string | null = null;

  onMount(async () => {
    if (!context) {
      console.error("Context is not initialized.");
      return;
    }

    const client = context.createResourceDataClient();
    // Properly handling the result based on the ResourceData interface
    client.query(
      [{ selector: "Agent", fields: ["publicId"] }],
      (results: ResourceDataResult<ResourceData.Agent>[]) => {
        if (
          results &&
          results.length > 0 &&
          results[0].data &&
          results[0].data.publicId
        ) {
          agentId = results[0].data.publicId;
          if (agentId) {
            initializeAndFetchData(agentId);
          } else {
            console.error("Agent ID retrieved is null.");
          }
        } else {
          console.error(
            "Failed to retrieve Agent ID or data is structured incorrectly."
          );
        }
      }
    );
  });

  async function initializeAndFetchData(agentId: string) {
    alarmsManager = new AlarmsManager(context);
    await fetchData(agentId);
  }

  async function fetchData(agentId: string) {
    loading = true;
    try {
      console.log("Fetching all alarms and occurrences for agent ID:", agentId);
      alarms = await alarmsManager.getAllAlarmOccurrencesForAgent(agentId);
      console.log("Alarms and occurrences retrieved:", alarms);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    loading = false;
  }
</script>

<main>
  {#if loading}
    <p>Loading...</p>
  {:else}
    {#each alarms as alarm}
      <li>
        <p>Alarm: {alarm.name}</p>
        <p>Date: {alarm.occurrences.map((occ) => occ.occurredOn).join(", ")}</p>
        <p>Severity: {alarm.severity}</p>
      </li>
    {/each}
  {/if}
</main>
