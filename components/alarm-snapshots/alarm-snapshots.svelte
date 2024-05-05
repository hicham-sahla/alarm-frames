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

  type Occurrence = {
    name: string;
    occurredOn: {
      fullDate: string;
      dateOnly: string;
      timeOnly: string;
      formattedDate: string; // User-friendly formatted date
    };
    severity: string;
    publicId: string;
  };

  let occurrencesList: Occurrence[] = [];
  let loading = true;
  let tableWidth = 0;
  let tableScrollTop = 0;
  let doAutoRefresh = false;
  let autoRefreshInterval: number | undefined;
  $: isNarrow = tableWidth < 320;

  let agentId: string | null = null;
  let search = "";
  let translations: Record<string, string>;

  let from = "";
  let to = "";

  enum TimeRanges {
    FourWeeks = "4 weeks",
    ThreeMonths = "3 months",
    SixMonths = "6 months",
    OneYear = "1 year",
  }

  const timeRangeOptions: {
    [K in TimeRanges]: { weeks?: number; months?: number; years?: number };
  } = {
    [TimeRanges.FourWeeks]: { weeks: 4 },
    [TimeRanges.ThreeMonths]: { months: 3 },
    [TimeRanges.SixMonths]: { months: 6 },
    [TimeRanges.OneYear]: { years: 1 },
  };

  let selectedTimeRange: TimeRanges = TimeRanges.FourWeeks;

  let minuteAdjustment: number = 15; // Default adjustment period in minutes
  let adjustmentTarget: "from" | "to" = "from"; // Default to adjusting 'from' date

  onMount(async () => {
    alarmsManager = new AlarmsManager(context);
    translations = context.translate(
      ["SEARCH", "NO_OCCURRENCES_FOUND", "OCCURRENCES", "ACTIVE_SINCE"],
      undefined,
      { source: "global" }
    );

    if (context) {
      context.ontimerangechange = (newTimeRange) => {
        if (newTimeRange) {
          // Maintain full datetime strings
          from = DateTime.fromMillis(newTimeRange.from, {
            zone: context.appData.timeZone,
          }).toISO();
          to = DateTime.fromMillis(newTimeRange.to, {
            zone: context.appData.timeZone,
          }).toISO();
        }
      };

      const fromDt = DateTime.now().minus({ weeks: 4 }).toUTC();
      const toDt = DateTime.now().toUTC();

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
            fetchData(agentId, fromDt.toJSDate(), toDt.toJSDate());
          }
        }
      });
    } else {
      console.error("Context is not initialized.");
    }
  });

  function updateDateRange() {
    if (!agentId) {
      console.error("Agent ID is null or undefined.");
      return;
    }

    const duration = timeRangeOptions[selectedTimeRange];
    const fromDt = DateTime.now().minus(duration).toUTC();
    const toDt = DateTime.now().toUTC();
    fetchData(agentId, fromDt.toJSDate(), toDt.toJSDate());
  }

  function handleTableScroll(event: Event): void {
    tableScrollTop = (event.target as HTMLDivElement).scrollTop;
  }

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
          occurredOn: formatDate(occ.occurredOn), // Ensure this always returns an object
          severity: alarm.severity,
          publicId: occ.publicId || "Unknown ID",
        }))
      );
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    loading = false;
  }

  function formatDate(dateString: string | undefined) {
    if (!dateString) {
      // Return a default object where no fields are undefined
      return {
        fullDate: "No Date Provided",
        dateOnly: "No Date Provided",
        timeOnly: "No Time Provided",
        formattedDate: "No Date Provided", // Make sure this is not undefined
      };
    }
    const dt = DateTime.fromISO(dateString);
    return {
      fullDate: dt.toISO(),
      dateOnly: dt.toISODate(),
      timeOnly: dt.toFormat("HH:mm"),
      formattedDate: dt.toFormat("dd-MM-yyyy HH:mm"), // Ensure formattedDate is always defined
    };
  }

  // Use the Occurrence type for the function parameter
  function selectOccurrence(occurrence: Occurrence) {
    console.log("Selected occurrence:", occurrence);
    if (
      !occurrence ||
      !occurrence.occurredOn ||
      !occurrence.occurredOn.fullDate
    ) {
      console.error("Invalid occurrence data");
      return;
    }

    console.log("Attempting to parse date:", occurrence.occurredOn.fullDate);
    const startTime = DateTime.fromISO(occurrence.occurredOn.fullDate, {
      zone: context.appData.timeZone,
    });
    console.log("Parsed Start Time:", startTime.toString());

    if (!startTime.isValid) {
      console.error(
        "Failed to parse the start time:",
        occurrence.occurredOn.fullDate
      );
      return;
    }

    const endTime = startTime.plus({ hours: 1 });
    console.log("Calculated End Time:", endTime.toString());

    if (startTime.isValid && endTime.isValid) {
      context.setTimeRange({
        from: startTime.toMillis(),
        to: endTime.toMillis(),
      });
    } else {
      console.error("Invalid dates provided for time range.");
    }
  }

  function incrementTimeRange() {
    adjustTimeRange(minuteAdjustment);
  }

  function decrementTimeRange() {
    adjustTimeRange(-minuteAdjustment);
  }

  function adjustTimeRange(minutes: number) {
    if (!agentId) {
      console.error("Agent ID is null, cannot fetch data.");
      return;
    }

    let newFrom = DateTime.fromISO(from, { zone: context.appData.timeZone });
    let newTo = DateTime.fromISO(to, { zone: context.appData.timeZone });

    if (adjustmentTarget === "from") {
      newFrom = newFrom.plus({ minutes: minutes });
    } else {
      newTo = newTo.plus({ minutes: minutes });
    }

    // Update the global 'from' and 'to' ISO strings to full datetime
    from = newFrom.toISO();
    to = newTo.toISO();

    // Set the new time range in context
    context.setTimeRange({
      from: newFrom.toMillis(),
      to: newTo.toMillis(),
    });

    // Fetch data with the new times
    fetchData(agentId, newFrom.toJSDate(), newTo.toJSDate());
  }

  $: if (context && context.timeRange) {
    from = DateTime.fromMillis(context.timeRange.from, {
      zone: context.appData.timeZone,
    }).toISODate();
    to = DateTime.fromMillis(context.timeRange.to, {
      zone: context.appData.timeZone,
    }).toISODate();
  }

  $: filteredOccurrences = occurrencesList.filter((occ) => {
    const { fullDate, dateOnly, timeOnly } = occ.occurredOn; // Directly use the object
    return [
      occ.name.toLowerCase(),
      occ.severity.toLowerCase(),
      occ.publicId.toLowerCase(),
      fullDate.toLowerCase(),
      dateOnly.toLowerCase(),
      timeOnly.toLowerCase(),
    ].some((field) => field.includes(search.toLowerCase()));
  });

  function toggleRefresh(): void {
    if (agentId) {
      const from = DateTime.now().minus({ weeks: 4 }).toJSDate();
      const to = DateTime.now().toJSDate();
      fetchData(agentId, from, to);
    } else {
      console.error("Agent ID is unavailable.");
    }
  }

  function toggleAutoRefresh(): void {
    doAutoRefresh = !doAutoRefresh;

    if (doAutoRefresh) {
      autoRefreshInterval = window.setInterval(() => {
        if (agentId) {
          const from = DateTime.now().minus({ weeks: 4 }).toJSDate();
          const to = DateTime.now().toJSDate();
          fetchData(agentId, from, to);
        } else {
          console.error("Agent ID is unavailable during auto-refresh.");
        }
      }, 30000);
    } else {
      clearInterval(autoRefreshInterval);
    }
  }
</script>

<div class="card">
  {#if loading}
    <div class="loading-state">
      <div class="spinner">
        <svg
          preserveAspectRatio="xMidYMid meet"
          focusable="false"
          viewBox="0 0 100 100"
        >
          <circle cx="50%" cy="50%" r="45" />
        </svg>
      </div>
    </div>
  {:else}
    <div class="card-header with-actions">
      <h3 class="card-title" data-testid="active-alarms-overview-card-title">
        Alarm snapshot
      </h3>
      <div class="actions-top">
        <div class="time-adjustment">
          <button on:click={decrementTimeRange}>-</button>
          <input type="number" bind:value={minuteAdjustment} min="1" />
          <button on:click={incrementTimeRange}>+</button>
          <select bind:value={adjustmentTarget}>
            <option value="from">From Date</option>
            <option value="to">To Date</option>
          </select>
        </div>
        <div
          class="search-input-container"
          style={isNarrow ? "width: 100px" : ""}
        >
          <div class="search-input-prefix">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <path d="M0 0h24v24H0z" fill="none" />
              <path
                d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
              />
            </svg>
          </div>
          <input
            class="search-input"
            placeholder={translations?.SEARCH}
            bind:value={search}
            style={isNarrow ? "display: flex" : ""}
          />
        </div>
        <div class="refresh-container">
          <button class="refresh ripple" on:click={toggleRefresh}>
            <svg width="24" height="24" viewBox="0 -960 960 960">
              <path
                d="M204-318q-22-38-33-78t-11-82q0-134 93-228t227-94h7l-64-64 56-56 160 160-160 160-56-56 64-64h-7q-100 0-170 70.5T240-478q0 26 6 51t18 49l-60 60ZM481-40 321-200l160-160 56 56-64 64h7q100 0 170-70.5T720-482q0-26-6-51t-18-49l60-60q22 38 33 78t11 82q0 134-93 228t-227 94h-7l64 64-56 56Z"
              />
            </svg>
          </button>
          <button
            class={doAutoRefresh
              ? "auto-refresh ripple active"
              : "auto-refresh ripple"}
            on:click={toggleAutoRefresh}
          >
            30s
          </button>
          <select
            class="timerange-select"
            bind:value={selectedTimeRange}
            on:change={updateDateRange}
          >
            <option value="4 weeks">Last 4 Weeks</option>
            <option value="3 months">Last 3 Months</option>
            <option value="6 months">Last 6 Months</option>
            <option value="1 year">Last 1 Year</option>
          </select>
        </div>
      </div>
    </div>
    <div class="card-content">
      {#if tableScrollTop > 0}
        <div class="table-header-drop-shadow" style="width: {tableWidth}px" />
      {/if}
      <div
        class="table-wrapper"
        bind:clientWidth={tableWidth}
        on:scroll={handleTableScroll}
      >
        <table class="base-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Alarm</th>
              <th>Date</th>
              <th>Severity</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredOccurrences as occurrence}
              <tr on:click={() => selectOccurrence(occurrence)}>
                <td>{occurrence.publicId}</td>
                <td>{occurrence.name}</td>
                <td>{occurrence.occurredOn.formattedDate}</td>
                <td>{occurrence.severity}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
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

  .time-adjustment {
    display: flex;
    align-items: center;
    margin-right: 10px;

    button {
      padding: 5px 10px;
      margin: 0 5px;
      background-color: var(--button-bg-color);
      color: var(--button-text-color);
      border: none;
      cursor: pointer;

      &:hover {
        background-color: var(--button-hover-bg-color);
      }
    }

    input[type="number"] {
      width: 50px;
      padding: 5px;
      text-align: center;
    }

    select {
      margin-left: 5px;
      padding: 5px;
      background: var(--basic);
      border: 1px solid var(--card-border-color);
      color: var(--text-color);
    }
  }

  .timerange-select {
    background: var(--basic);
    border: 1px solid var(--card-border-color);
    border-radius: 4px;
    color: var(--text-color);
    font-size: 14px;
    padding: 4px 8px;
    margin-left: 8px;
    margin-right: 6px;
  }
  .base-table th,
  .base-table td {
    text-align: left; /* Aligns text to the left */
    vertical-align: top; /* Aligns content to the top of the cell */
  }
  .base-table {
    border-collapse: collapse; /* Ensures borders between cells are merged */
  }
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
