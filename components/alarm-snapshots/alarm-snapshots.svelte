<script lang="ts">
  import { onMount } from "svelte";
  import { DateTime } from "luxon";
  import { AlarmsManager } from "./services/alarms-manager";
  import type {
    ComponentContext,
    AgentDataAlarmOccurrence,
  } from "@ixon-cdk/types";
  import type { Alarm } from "./types";

  export let context: ComponentContext;
  let alarmsManager: AlarmsManager;
  let occurrencesList: {
    name: string;
    occurredOn: string;
    severity: string;
    publicId: string;
  }[] = [];
  let loading = true;
  let agentId: string | null = null;

  onMount(async () => {
    alarmsManager = new AlarmsManager(context);
    if (context) {
      const from = DateTime.now().minus({ weeks: 4 }).toUTC();
      const to = DateTime.now().toUTC();

      const client = context.createResourceDataClient();
      client.query([{ selector: "Agent", fields: ["publicId"] }], (results) => {
        if (
          results &&
          results.length > 0 &&
          results[0].data &&
          results[0].data.publicId
        ) {
          agentId = results[0].data.publicId;
          if (agentId) {
            fetchData(agentId, from.toJSDate(), to.toJSDate());
          }
        }
      });
    } else {
      console.error("Context is not initialized.");
    }
  });

  async function fetchData(agentId: string, from: Date, to: Date) {
    loading = true;
    try {
      let alarms = await alarmsManager.getAllAlarmOccurrencesForAgent(
        agentId,
        from,
        to
      );
      occurrencesList = alarms.flatMap((alarm) =>
        alarm.occurrences.map((occ) => ({
          name: alarm.name,
          occurredOn: formatDate(occ.occurredOn),
          severity: alarm.severity,
          publicId: occ.publicId || "Unknown ID", // Include the publicId of the occurrence
        }))
      );
      console.log("Occurrences prepared:", occurrencesList);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    loading = false;
  }

  function formatDate(dateString: string | undefined): string {
    return dateString
      ? DateTime.fromISO(dateString).toFormat("dd-MM-yyyy HH:mm")
      : "No Date Provided";
  }
</script>

<main>
  {#if loading}
    <p>Loading...</p>
  {:else}
    <ul>
      {#each occurrencesList as occurrence}
        <li>
          <p>Alarm: {occurrence.name}</p>
          <p>Date: {occurrence.occurredOn}</p>
          <p>ID: {occurrence.publicId}</p>
          <p>Severity: {occurrence.severity}</p>
        </li>
      {/each}
    </ul>
  {/if}
</main>
