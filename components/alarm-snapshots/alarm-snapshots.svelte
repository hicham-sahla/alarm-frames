<script lang="ts">
  import { onMount } from "svelte";
  import { AlarmsManager } from "./services/alarms-manager";
  import { ApiService } from "./services/api.service";
  import type { ComponentContext, Alarm } from "@ixon-cdk/types";

  export let context: ComponentContext;

  let apiService: ApiService;
  let alarmsManager: AlarmsManager;
  let alarms: Alarm[] = [];
  let loading = true;

  onMount(async () => {
    if (!context || !context.appData) {
      console.error("Context or appData is undefined");
      return;
    }
    apiService = new ApiService(context);
    alarmsManager = new AlarmsManager(context);

    loading = true;
    try {
      const agentId = "specified-agent-public-id"; // Replace with actual or fetched ID
      console.log("Fetching all alarms for agent:", agentId);
      alarms = await alarmsManager.getAllAlarmOccurrencesForAgent(agentId);
      console.log("Alarms fetched:", alarms);
    } catch (error) {
      console.error("Failed to fetch alarms:", error);
    }
    loading = false;
  });
</script>

<main>
  {#if loading}
    <p>Loading...</p>
  {:else}
    <ul>
      {#each alarms as alarm}
        <li>
          <p>Alarm: {alarm.name}</p>
          <p>Date: {alarm.occurrence?.occurredOn}</p>
          <p>Severity: {alarm.severity}</p>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style lang="scss">
  $heading-color: #ff3e00;

  main {
    text-align: center;
    padding: 1em;
    max-width: 240px;
    margin: 0 auto;
  }
  @media (min-width: 640px) {
    main {
      max-width: none;
    }
  }
</style>
