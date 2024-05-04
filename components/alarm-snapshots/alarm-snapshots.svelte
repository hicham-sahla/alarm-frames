<script lang="ts">
  import { onMount } from "svelte";
  import { DateTime } from "luxon";
  import { AlarmsManager } from "./services/alarms-manager";
  import type { ComponentContext } from "@ixon-cdk/types";
  import type { Alarm } from "./types";

  export let context: ComponentContext;

  let alarmsManager: AlarmsManager;
  let alarms: Alarm[] = [];
  let loading = true;
  let agentId: string | null = null;

  onMount(async () => {
    alarmsManager = new AlarmsManager(context);
    if (context) {
      const from = DateTime.now().minus({ weeks: 4 }).toUTC();
      const to = DateTime.now().toUTC();
      console.log(`Filtering from ${from.toISO()} to ${to.toISO()}`);

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
      alarms = await alarmsManager.getAllAlarmOccurrencesForAgent(
        agentId,
        from,
        to
      );
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
    <ul>
      {#each alarms as alarm}
        <li>
          <p>Alarm: {alarm.name}</p>
          <p>
            Date: {alarm.occurrences.map((occ) => occ.occurredOn).join(", ")}
          </p>
          <p>Severity: {alarm.severity}</p>
        </li>
      {/each}
    </ul>
  {/if}
</main>
