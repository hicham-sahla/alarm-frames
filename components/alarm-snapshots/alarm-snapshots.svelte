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
  let search = "";
  let translations: Record<string, string>;

  onMount(async () => {
    alarmsManager = new AlarmsManager(context);
    translations = context.translate(
      ["SEARCH", "NO_OCCURRENCES_FOUND", "OCCURRENCES", "ACTIVE_SINCE"],
      undefined,
      { source: "global" }
    );
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
          publicId: occ.publicId || "Unknown ID",
        }))
      );
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

  $: filteredOccurrences = occurrencesList.filter((occ) => {
    return [occ.name, occ.severity].some((prop) =>
      prop.toLowerCase().includes(search.toLowerCase())
    );
  });
</script>

<div class="card">
  {#if loading}
    <div class="loading-state">
      <!-- Spinner here -->
    </div>
  {:else}
    <div class="card-header with-actions">
      <h3>{translations.OCCURRENCES}</h3>
      <div class="actions-top">
        <input
          class="search-input"
          bind:value={search}
          placeholder={translations.SEARCH}
        />
        <!-- Refresh buttons here -->
      </div>
    </div>
    <div class="card-content">
      {#if filteredOccurrences.length}
        <ul>
          {#each filteredOccurrences as occurrence}
            <li>
              <p>Alarm: {occurrence.name}</p>
              <p>Date: {occurrence.occurredOn}</p>
              <p>ID: {occurrence.publicId}</p>
              <p>Severity: {occurrence.severity}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <p>{translations.NO_OCCURRENCES_FOUND}</p>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  @import "./styles/card";
  @import "./styles/spinner";
  @import "./styles/table";
  @import "./styles/refresh";
  @import "./styles/ripple";
  @import "./styles/search-input";

  .card-header {
    margin-bottom: 8px;

    .actions-top {
      display: flex;
      flex-direction: row;
    }
  }

  .card-content {
    position: relative;
  }

  .loading-state {
    width: inherit;
    height: inherit;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .table-wrapper {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    padding: 8px;
    overflow: auto;
    overflow-anchor: none;
  }

  .table-header-drop-shadow {
    position: absolute;
    z-index: 10;
    top: 0;
    left: 0;
    width: 100%;
    height: 42px;
    background: var(--basic);
    box-shadow: 0 2px 2px 0 var(--card-border-color);
  }

  table.base-table {
    width: 100%;

    tr td {
      font-size: 14px;
      white-space: nowrap;
      padding-right: 24px;
    }

    thead {
      tr {
        border-bottom: none;

        th {
          position: sticky;
          white-space: nowrap;
          background: var(--basic);
          top: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 7em;
          z-index: 10;
        }
      }
    }

    tbody tr:hover {
      background-color: rgb(0 0 0 / 4%) !important;
      cursor: pointer;
    }
  }

  .no-search-results {
    font-size: 14px;
    margin-bottom: 16px;
  }
</style>
