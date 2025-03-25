<script lang="ts">
  import { onMount, afterUpdate } from "svelte";
  import { DateTime } from "luxon";
  import { AlarmsManager } from "./services/alarms-manager";
  import type {
    ComponentContext,
    AgentDataAlarmOccurrence,
  } from "@ixon-cdk/types";
  import type { Alarm } from "./types";
  import { writable } from "svelte/store";

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
  let previousSearch = "";
  let isSearchFocused = false;
  let translations: Record<string, string>;

  let from = "";
  let to = "";

  // Pagination variables
  let pageSize = 50;
  let currentPageAfter: string | undefined = undefined;
  let hasMoreData = true;
  let isLoadingMore = false;
  let searchTimeout: number | undefined;

  let isToDate = false; // Default to adjusting 'from'

  function toggleDateAdjustment() {
    adjustmentTarget = isToDate ? "to" : "from";
  }
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
      const client = context.createResourceDataClient();
      client.query(
        [{ selector: "Agent", fields: ["publicId"] }],
        async (results) => {
          if (
            results &&
            results.length > 0 &&
            results[0].data &&
            results[0].data.publicId
          ) {
            agentId = results[0].data.publicId;
            if (agentId) {
              await loadInitialData();
            }
          }
        }
      );
    } else {
      console.error("Context is not initialized.");
    }
  });

  async function loadInitialData(forceFresh = false) {
    if (!agentId) return;

    loading = true;
    try {
      console.log(
        "Loading initial data with search:",
        search.trim() !== "" ? search : undefined
      );
      const result = await alarmsManager.getAllAlarmOccurrencesForAgent(
        agentId,
        pageSize,
        undefined,
        search.trim() !== "" ? search : undefined,
        forceFresh // Pass flag to force fresh data when needed
      );

      // Process occurrences for display
      occurrencesList = result.alarms.flatMap((alarm) =>
        alarm.occurrences.map((occ) => ({
          name: alarm.name,
          occurredOn: formatDate(occ.occurredOn),
          severity: alarm.severity,
          publicId: occ.publicId || "Unknown ID",
        }))
      );

      currentPageAfter = result.moreAfter;
      hasMoreData = !!result.moreAfter;

      // Store current search to compare later
      previousSearch = search;
    } catch (error) {
      console.error("Error fetching initial data:", error);
    } finally {
      loading = false;
    }
  }

  function handleTableScroll(event: Event): void {
    const target = event.target as HTMLDivElement;
    tableScrollTop = target.scrollTop;

    // Check if we're near the bottom to trigger loading more data
    if (
      hasMoreData &&
      !isLoadingMore &&
      target.scrollHeight - target.scrollTop - target.clientHeight < 200
    ) {
      loadMoreData();
    }
  }

  async function loadMoreData() {
    if (!agentId || !hasMoreData || isLoadingMore) return;

    isLoadingMore = true;
    try {
      console.log(
        "Loading more data with search:",
        search.trim() !== "" ? search : undefined
      );
      const result = await alarmsManager.getAllAlarmOccurrencesForAgent(
        agentId,
        pageSize,
        currentPageAfter,
        search.trim() !== "" ? search : undefined
      );

      const newOccurrences = result.alarms.flatMap((alarm) =>
        alarm.occurrences.map((occ) => ({
          name: alarm.name,
          occurredOn: formatDate(occ.occurredOn),
          severity: alarm.severity,
          publicId: occ.publicId || "Unknown ID",
        }))
      );

      // Append new occurrences to the existing list
      occurrencesList = [...occurrencesList, ...newOccurrences];

      currentPageAfter = result.moreAfter;
      hasMoreData = !!result.moreAfter;
    } catch (error) {
      console.error("Error fetching more data:", error);
    } finally {
      isLoadingMore = false;
    }
  }

  function formatDate(dateString: string | undefined) {
    return AlarmsManager.formatDate(dateString);
  }

  // Handle search focus state
  function handleSearchFocus() {
    isSearchFocused = true;
  }

  // Handle search blur - apply search when focus is lost
  function handleSearchBlur() {
    isSearchFocused = false;

    // Only trigger search if the value has changed
    if (search !== previousSearch) {
      executeSearch();
    }
  }

  // Handle search key press - apply on Enter key
  function handleSearchKeyUp(event: KeyboardEvent) {
    if (event.key === "Enter") {
      executeSearch();
    }
  }

  // Execute the search
  function executeSearch() {
    // Clear any pending timeouts
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Reset pagination and reload data with search
    currentPageAfter = undefined;
    hasMoreData = true;
    occurrencesList = [];

    if (agentId) {
      loadInitialData();
    }
  }

  // Use the Occurrence type for the function parameter
  function selectOccurrence(occurrence: Occurrence) {
    if (
      !occurrence ||
      !occurrence.occurredOn ||
      !occurrence.occurredOn.fullDate
    ) {
      console.error("Invalid occurrence data");
      return;
    }

    const startTime = DateTime.fromISO(occurrence.occurredOn.fullDate, {
      zone: context.appData.timeZone,
    });

    if (!startTime.isValid) {
      console.error(
        "Failed to parse the start time:",
        occurrence.occurredOn.fullDate
      );
      return;
    }

    // Set 'from' and 'to' based on the selected occurrence
    const endTime = startTime.plus({ hours: 1 });

    context.setTimeRange({
      from: startTime.toMillis(),
      to: endTime.toMillis(),
    });

    // Update local 'from' and 'to' variables
    from = startTime.toISO();
    to = endTime.toISO();

    // Store the selected date locally to avoid resetting
    localStorage.setItem("snapshot-date", startTime.toISO());
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

    // Ensure 'from' and 'to' are taken from the currently selected time range
    let newFrom = DateTime.fromMillis(context.timeRange.from, {
      zone: context.appData.timeZone,
    });
    let newTo = DateTime.fromMillis(context.timeRange.to, {
      zone: context.appData.timeZone,
    });

    // Perform the adjustment based on whether we're adjusting the 'from' or 'to' date
    if (adjustmentTarget === "from") {
      newFrom = newFrom.plus({ minutes: minutes });
    } else {
      newTo = newTo.plus({ minutes: minutes });
    }

    // Update the 'from' and 'to' values in the context's time range
    context.setTimeRange({
      from: newFrom.toMillis(),
      to: newTo.toMillis(),
    });

    // Update the local 'from' and 'to' variables to reflect the new time range
    from = newFrom.toISO();
    to = newTo.toISO();
  }

  $: if (context && context.timeRange) {
    from = DateTime.fromMillis(context.timeRange.from, {
      zone: context.appData.timeZone,
    }).toISO(); // Use toISO() to retain the complete datetime information
    to = DateTime.fromMillis(context.timeRange.to, {
      zone: context.appData.timeZone,
    }).toISO();
  }

  $: filteredOccurrences = occurrencesList;

  function toggleRefresh(): void {
    if (agentId) {
      // Reset pagination and reload data with forced refresh
      currentPageAfter = undefined;
      hasMoreData = true;
      occurrencesList = [];
      loadInitialData(true); // Pass true to force fresh data
    } else {
      console.error("Agent ID is unavailable.");
    }
  }

  let copySuccess: Record<string, boolean> = {};
  // To keep track of copy statuses for each ID

  // Function to copy ID to clipboard with type annotation for the parameter
  async function copyToClipboard(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      copySuccess[id] = true; // Set success state true for this ID

      setTimeout(() => {
        copySuccess[id] = false; // Reset after 2 seconds
      }, 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
      copySuccess[id] = false;
    }
  }

  function resetSelectedOccurrence() {
    // Clear the selected date from local storage
    localStorage.removeItem("snapshot-date");

    // Get the current date and time in the specified time zone
    const now = DateTime.now().setZone(context.appData.timeZone);

    // Define the start of the day (midnight) for the 'from' value and end of the day for 'to' value
    const startOfDay = now.startOf("day").toMillis(); // Midnight at the start of the day
    const endOfDay = now.endOf("day").toMillis(); // Just before midnight at the end of the day

    // Reset the date range to the current day from start to end
    if (context && context.setTimeRange) {
      context.setTimeRange({
        from: startOfDay,
        to: endOfDay,
      });
    }

    // Optionally, reset other state variables if applicable
    from = "";
    to = "";
  }

  // Tooltip elements
  let refreshButtonEl: HTMLButtonElement;
  let resetButtonEl: HTMLButtonElement;
  let incrementTimeRangeButtonEl: HTMLButtonElement;
  let decrementTimeRangeButtonEl: HTMLButtonElement;
  let fromDateInputSwitchEl: HTMLLabelElement;

  afterUpdate(() => {
    if (refreshButtonEl) {
      context.createTooltip(refreshButtonEl, {
        message: "Refresh the occurence list",
      });
    }
    if (resetButtonEl) {
      context.createTooltip(resetButtonEl, {
        message: "Reset the selected occurrence",
      });
    }
    if (incrementTimeRangeButtonEl) {
      context.createTooltip(incrementTimeRangeButtonEl, {
        message: "Extend the time range",
      });
    }
    if (decrementTimeRangeButtonEl) {
      context.createTooltip(decrementTimeRangeButtonEl, {
        message: "Shorten the time range",
      });
    }
    if (fromDateInputSwitchEl) {
      context.createTooltip(
        fromDateInputSwitchEl.parentElement as HTMLElement,
        {
          message: "Toggle to adjust start or end date",
        }
      );
    }
    // Add tooltips for copy buttons
    document.querySelectorAll(".copy-button").forEach((button) => {
      context.createTooltip(button as HTMLElement, {
        message: "Copy ID to clipboard",
      });
    });
  });

  function formatDateForTable(dateString: string | undefined): string {
    if (!dateString) {
      return "No Date Provided"; // Fallback in case the date is undefined
    }
    const dt = DateTime.fromISO(dateString);
    return dt.toFormat("M/d/yyyy, h:mm a"); // Format matching the date picker
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
        Alarm snapshots
      </h3>
      <div class="actions-top">
        <div class="time-adjustment">
          <div class="input-switch">
            <!-- Fix A11y warnings by associating labels with inputs -->
            <label for="toggleTarget" class="switch-label">Start Date</label>
            <input
              type="checkbox"
              id="toggleTarget"
              class="input"
              bind:checked={isToDate}
              on:change={toggleDateAdjustment}
            />
            <label
              bind:this={fromDateInputSwitchEl}
              for="toggleTarget"
              class="switch"
            ></label>
            <label for="toggleTarget" class="switch-label">End Date</label>
          </div>
          <div class="button-group">
            <button
              on:click={decrementTimeRange}
              bind:this={decrementTimeRangeButtonEl}
              aria-label="Decrease time range"
              ><svg
                xmlns="http://www.w3.org/2000/svg"
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#e8eaed"
                ><path
                  d="M480-120q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z"
                /></svg
              ></button
            >
            <input
              type="number"
              bind:value={minuteAdjustment}
              min="1"
              aria-label="Adjustment in minutes"
            />
            <button
              on:click={incrementTimeRange}
              bind:this={incrementTimeRangeButtonEl}
              aria-label="Increase time range"
              ><svg
                xmlns="http://www.w3.org/2000/svg"
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#e8eaed"
                ><path
                  d="M480-120q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-480q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-840q82 0 155.5 35T760-706v-94h80v240H600v-80h110q-41-56-101-88t-129-32q-117 0-198.5 81.5T200-480q0 117 81.5 198.5T480-200q105 0 183.5-68T756-440h82q-15 137-117.5 228.5T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z"
                /></svg
              ></button
            >
          </div>
        </div>
        <div
          class="search-input-container"
          style={isNarrow ? "width: 100px" : ""}
        >
          <div class="search-input-prefix">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
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
            on:focus={handleSearchFocus}
            on:blur={handleSearchBlur}
            on:keyup={handleSearchKeyUp}
            style={isNarrow ? "display: flex" : ""}
            aria-label="Search occurrences"
          />
        </div>
        <div class="refresh-container">
          <button
            class="refresh ripple"
            on:click={toggleRefresh}
            bind:this={refreshButtonEl}
            aria-label="Refresh data"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 -960 960 960"
              aria-hidden="true"
            >
              <path
                d="M204-318q-22-38-33-78t-11-82q0-134 93-228t227-94h7l-64-64 56-56 160 160-160 160-56-56 64-64h-7q-100 0-170 70.5T240-478q0 26 6 51t18 49l-60 60ZM481-40 321-200l160-160 56 56-64 64h7q100 0 170-70.5T720-482q0-26-6-51t-18-49l60-60q22 38 33 78t11 82q0 134-93 228t-227 94h-7l64 64-56 56Z"
              />
            </svg>
          </button>
          <button
            class="auto-refresh ripple"
            on:click={resetSelectedOccurrence}
            bind:this={resetButtonEl}
            aria-label="Reset occurrence selection"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              fill="#f44336"
              aria-hidden="true"
              ><path
                d="m656-120-56-56 84-84-84-84 56-56 84 84 84-84 56 56-83 84 83 84-56 56-84-83-84 83Zm-176 0q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q11 0 20.5-.5T520-203v81q-10 1-19.5 1.5t-20.5.5ZM120-560v-240h80v94q51-64 124.5-99T480-840q150 0 255 105t105 255h-80q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120Zm414 190-94-94v-216h80v184l56 56-42 70Z"
              /></svg
            >
          </button>
        </div>
      </div>
    </div>
    <div class="card-content">
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
      {:else if filteredOccurrences.length === 0}
        <div class="no-occurrences-message">
          <p>There are no occurrences available for the selected criteria.</p>
          <p>Please try adjusting your search or refresh the data.</p>
        </div>
      {:else}
        <div
          class="table-wrapper"
          bind:clientWidth={tableWidth}
          on:scroll={handleTableScroll}
        >
          <table class="base-table">
            <thead>
              <tr>
                <th class="id-column">ID</th>
                <th class="key-column">Alarm</th>
                <th class="key-column">Date</th>
                <th class="key-column">Severity</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredOccurrences as occurrence}
                <tr on:click={() => selectOccurrence(occurrence)}>
                  <td class="id-column">
                    <span>{occurrence.publicId}</span>
                    <button
                      class="copy-button {copySuccess[occurrence.publicId]
                        ? 'success'
                        : ''}"
                      on:click|stopPropagation={() =>
                        copyToClipboard(occurrence.publicId)}
                      aria-label="Copy ID to clipboard"
                    >
                      {#if copySuccess[occurrence.publicId]}
                        <!-- Display a check icon on success -->
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          height="24px"
                          viewBox="0 -960 960 960"
                          width="24px"
                          fill="#4caf50"
                          aria-hidden="true"
                        >
                          <path
                            d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"
                          />
                        </svg>
                      {:else}
                        <!-- Original copy icon -->
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          height="24px"
                          viewBox="0 -960 960 960"
                          width="16px"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"
                          />
                        </svg>
                      {/if}
                    </button>
                  </td>
                  <td>{occurrence.name}</td>
                  <td>{formatDateForTable(occurrence.occurredOn.fullDate)}</td>
                  <td>{occurrence.severity}</td>
                </tr>
              {/each}
            </tbody>
            {#if isLoadingMore}
              <tfoot>
                <tr>
                  <td colspan="4" style="text-align: center; padding: 10px;">
                    <div class="spinner" style="display: inline-block;">
                      <svg
                        preserveAspectRatio="xMidYMid meet"
                        focusable="false"
                        viewBox="0 0 100 100"
                      >
                        <circle cx="50%" cy="50%" r="45" />
                      </svg>
                    </div>
                  </td>
                </tr>
              </tfoot>
            {/if}
          </table>
        </div>
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
</style>
