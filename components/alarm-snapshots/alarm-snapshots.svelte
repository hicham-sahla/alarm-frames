<script lang="ts">
  import { onMount } from "svelte";
  import { AlarmsManager } from "./services/alarms-manager";
  import type { ComponentContext } from "@ixon-cdk/types";
  import type { Alarm } from "./types";

  export let context: ComponentContext;

  let alarmsManager: AlarmsManager;
  let alarms: Alarm[] = [];
  let loading = true;
  let agentId: string | null = sessionStorage.getItem("pv-preview-agent-id"); // Nullable string aanpassen met resource data client

  onMount(() => {
    if (!context) {
      console.error("Context is not initialized.");
      return;
    }
    if (!agentId) {
      console.error("Agent ID is not found in sessionStorage.");
      return;
    }
    alarmsManager = new AlarmsManager(context);
    fetchData(agentId);
  });

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
