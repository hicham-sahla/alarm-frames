<script lang="ts">
  import { onMount, afterUpdate } from "svelte";
  import { DateTime } from "luxon";
  import { AlarmsManager } from "./services/alarms-manager";
  import type {
    ComponentContext,
    AgentDataAlarmOccurrence,
  } from "@ixon-cdk/types";
  import type { Alarm } from "./types";
  import type { PageInfo, PagedResult } from "./services/api.service";
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

  // Constants for pagination
  const ITEMS_PER_PAGE = 20;
  const MAX_PAGES = 10; // Maximum number of pages to load to prevent excessive data loading

  // State variables
  let occurrencesList: Occurrence[] = [];
  let loading = true;
  let loadingMore = false;
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

  // Pagination state
  let currentPage = 1;
  let hasMore = true;
  let totalItems = 0;
  let error: string | null = null;
  let loadProgress = 0;

  let minuteAdjustment: number = 15; // Default adjustment period in minutes
  let adjustmentTarget: "from" | "to" = "from"; // Default to adjusting 'from' date

  // Set a default date range (3 months)
  const defaultTimeRange = { months: 3 };

  // Memoized date formatters using a cache
  const dateFormatCache = new Map<string, any>();
  function formatDate(dateString: string | undefined) {
    if (!dateString) {
      // Return a default object where no fields are undefined
      return {
        fullDate: "No Date Provided",
        dateOnly: "No Date Provided",
        timeOnly: "No Time Provided",
        formattedDate: "No Date Provided",
      };
    }

    // Check if we've already formatted this date
    if (dateFormatCache.has(dateString)) {
      return dateFormatCache.get(dateString);
    }

    const dt = DateTime.fromISO(dateString);
    const result = {
      fullDate: dt.toISO(),
      dateOnly: dt.toFormat("dd-MM-yyyy"),
      timeOnly: dt.toFormat("HH:mm"),
      formattedDate: dt.toFormat("dd-MM-yyyy HH:mm"),
    };

    // Cache the result
    dateFormatCache.set(dateString, result);
    return result;
  }

  onMount(async () => {
    alarmsManager = new AlarmsManager(context);
    translations = context.translate(
      [
        "SEARCH",
        "NO_OCCURRENCES_FOUND",
        "OCCURRENCES",
        "ACTIVE_SINCE",
        "LOADING",
        "ERROR_LOADING",
      ],
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
      error = "Context is not initialized.";
    }
  });

  async function loadInitialData() {
    resetPagination();
    const fromDt = DateTime.now().minus(defaultTimeRange).toUTC();
    const toDt = DateTime.now().toUTC();

    if (agentId) {
      await fetchPagedData(agentId, fromDt.toJSDate(), toDt.toJSDate(), true);
    }
  }

  function resetPagination() {
    currentPage = 1;
    hasMore = true;
    occurrencesList = [];
    loadProgress = 0;
    error = null;
  }

  function handleTableScroll(event: Event): void {
    const target = event.target as HTMLDivElement;
    tableScrollTop = target.scrollTop;
  }

  function changePage(direction: "prev" | "next") {
    if (direction === "prev" && currentPage > 1) {
      currentPage--;
    } else if (direction === "next" && hasMore) {
      currentPage++;
    } else {
      return; // No action needed
    }

    if (agentId) {
      // Set loading state for better UX
      loadingMore = true;

      // Use a fixed time range for the API query (last 3 months)
      const fromDt = DateTime.now().minus(defaultTimeRange).toUTC();
      const toDt = DateTime.now().toUTC();

      fetchPagedData(
        agentId,
        fromDt.toJSDate(),
        toDt.toJSDate(),
        currentPage === 1
      ).finally(() => {
        loadingMore = false;
      });
    }
  }

  async function fetchPagedData(
    agentId: string,
    from: Date,
    to: Date,
    isInitialLoad: boolean
  ): Promise<boolean> {
    if (isInitialLoad) {
      loading = true;
      error = null;
    }

    try {
      // Include pagination parameters in the API call
      const pageInfo: PageInfo = {
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      };

      // Start progress tracking
      let progressInterval;
      if (isInitialLoad) {
        loadProgress = 10;
        progressInterval = setInterval(() => {
          if (loadProgress < 90) {
            loadProgress += 5;
          }
        }, 500);
      }

      const result = await alarmsManager.getPagedAlarmOccurrences(
        agentId,
        from,
        to,
        pageInfo
      );

      // Log detailed information for debugging
      console.log("API Response alarms:", result.items.length);
      console.log("API Response totalItems:", result.totalCount);

      // Process the results
      const newOccurrences = result.items
        .flatMap((alarm) =>
          alarm.occurrences.map((occ) => ({
            name: alarm.name,
            occurredOn: formatDate(occ.occurredOn),
            severity: alarm.severity,
            publicId: occ.publicId || "Unknown ID",
          }))
        )
        .sort((a, b) => {
          return (
            DateTime.fromISO(b.occurredOn.fullDate).toMillis() -
            DateTime.fromISO(a.occurredOn.fullDate).toMillis()
          );
        });

      console.log("Processed occurrences:", newOccurrences.length);

      // Log sample for debugging
      if (result.items.length > 0 && result.items[0].occurrences.length > 0) {
        console.log("Sample occurrence:", result.items[0].occurrences[0]);
      }

      // With pagination, we always replace the current list instead of appending
      occurrencesList = newOccurrences;

      // Update pagination state
      hasMore = result.hasMore;
      totalItems = result.totalCount;

      // Clear the progress interval
      if (progressInterval) {
        clearInterval(progressInterval);
        loadProgress = 100;
        // Quick transition to hide the progress bar
        setTimeout(() => {
          loadProgress = 0;
        }, 300);
      }

      return newOccurrences.length > 0;
    } catch (err) {
      console.error("Error fetching data:", err);
      error =
        err instanceof Error
          ? err.message
          : "Unknown error occurred while loading data";
      return false;
    } finally {
      if (isInitialLoad) {
        loading = false;
      }
    }
  }

  function refreshData() {
    if (agentId) {
      resetPagination();
      const fromDt = DateTime.now().minus(defaultTimeRange).toUTC();
      const toDt = DateTime.now().toUTC();
      fetchPagedData(agentId, fromDt.toJSDate(), toDt.toJSDate(), true);
    } else {
      console.error("Agent ID is unavailable.");
      error = "Agent ID is unavailable.";
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

  $: if (context && context.timeRange) {
    from = DateTime.fromMillis(context.timeRange.from, {
      zone: context.appData.timeZone,
    }).toISO(); // Use toISO() to retain the complete datetime information
    to = DateTime.fromMillis(context.timeRange.to, {
      zone: context.appData.timeZone,
    }).toISO();
  }

  // Cached filtered occurrences using memoization
  let lastSearch = "";
  let cachedFilteredOccurrences: Occurrence[] = [];

  $: {
    if (
      search !== lastSearch ||
      occurrencesList !== cachedFilteredOccurrences
    ) {
      lastSearch = search;
      if (!search) {
        // If no search term, just use the original list
        cachedFilteredOccurrences = occurrencesList;
      } else {
        // Otherwise filter the list
        const searchLower = search.toLowerCase();
        cachedFilteredOccurrences = occurrencesList.filter((occ) => {
          const { fullDate, dateOnly, timeOnly, formattedDate } =
            occ.occurredOn;
          const formattedDateForSearch = formatDateForTable(fullDate);

          return [
            occ.name.toLowerCase(),
            occ.severity.toLowerCase(),
            occ.publicId.toLowerCase(),
            fullDate.toLowerCase(),
            dateOnly.toLowerCase(),
            timeOnly.toLowerCase(),
            formattedDate.toLowerCase(),
            formattedDateForSearch.toLowerCase(),
          ].some((field) => field.includes(searchLower));
        });
      }
    }
  }

  $: filteredOccurrences = cachedFilteredOccurrences;

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

  // Tooltip elements
  let refreshButtonEl: HTMLButtonElement;
  let resetButtonEl: HTMLButtonElement;
  let incrementTimeRangeButtonEl: HTMLButtonElement;
  let decrementTimeRangeButtonEl: HTMLButtonElement;
  let fromDateInputSwitchEl: HTMLLabelElement;
  let prevPageButtonEl: HTMLButtonElement;
  let nextPageButtonEl: HTMLButtonElement;
  let loadMoreButtonEl: HTMLButtonElement;

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
    if (prevPageButtonEl) {
      context.createTooltip(prevPageButtonEl, {
        message: "Go to previous page",
      });
    }
    if (nextPageButtonEl) {
      context.createTooltip(nextPageButtonEl, {
        message: "Go to next page",
      });
    }
    if (loadMoreButtonEl) {
      context.createTooltip(loadMoreButtonEl, {
        message: "Load more occurrences",
      });
    }
    // Add tooltips for copy buttons (only for visible buttons to avoid performance issues)
    document.querySelectorAll(".copy-button").forEach((button) => {
      context.createTooltip(button as HTMLElement, {
        message: "Copy ID to clipboard",
      });
    });
  });

  // Memoized date formatter for table display
  const tableFormatCache = new Map<string, string>();
  function formatDateForTable(dateString: string | undefined): string {
    if (!dateString) {
      return "No Date Provided";
    }

    // Check cache first
    if (tableFormatCache.has(dateString)) {
      return tableFormatCache.get(dateString)!;
    }

    const dt = DateTime.fromISO(dateString);
    const formatted = dt.toFormat("M/d/yyyy, h:mm a");

    // Store in cache
    tableFormatCache.set(dateString, formatted);
    return formatted;
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
      {#if loadProgress > 0}
        <div class="progress-container">
          <div class="progress-bar" style="width: {loadProgress}%"></div>
          <div class="progress-text">{loadProgress}% Loading data...</div>
        </div>
      {/if}
    </div>
  {:else if error}
    <div class="error-state">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        height="32px"
        viewBox="0 0 24 24"
        width="32px"
        fill="#f44336"
      >
        <path d="M0 0h24v24H0z" fill="none" />
        <path
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
        />
      </svg>
      <h3>Error Loading Data</h3>
      <p>{error}</p>
      <button on:click={refreshData} class="retry-button ripple">Retry</button>
    </div>
  {:else}
    <div class="card-header with-actions">
      <h3 class="card-title" data-testid="active-alarms-overview-card-title">
        Alarm snapshots
      </h3>
      <div class="actions-top">
        <div class="time-adjustment">
          <div class="input-switch">
            <label class="switch-label" for="start-date-toggle"
              >Start Date</label
            >
            <input
              type="checkbox"
              id="start-date-toggle"
              class="input"
              checked={adjustmentTarget === "to"}
              on:change={() => {
                adjustmentTarget = adjustmentTarget === "from" ? "to" : "from";
              }}
            />
            <label
              bind:this={fromDateInputSwitchEl}
              for="start-date-toggle"
              class="switch"
            ></label>
            <label class="switch-label" for="start-date-toggle">End Date</label>
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
              id="minute-adjustment"
              bind:value={minuteAdjustment}
              min="1"
              aria-label="Minute adjustment value"
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
            style={isNarrow ? "display: flex" : ""}
            aria-label="Search occurrences"
          />
        </div>
        <div class="refresh-container">
          <!-- Replace time range selector with pagination -->
          <div class="pagination-container">
            <button
              class="pagination-button ripple"
              on:click={() => changePage("prev")}
              disabled={currentPage === 1}
              aria-label="Previous page"
              bind:this={prevPageButtonEl}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24px"
                viewBox="0 0 24 24"
                width="24px"
                fill="currentColor"
              >
                <path d="M0 0h24v24H0V0z" fill="none" />
                <path
                  d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12l4.58-4.59z"
                />
              </svg>
            </button>
            <span class="pagination-info"
              >Page {currentPage}{totalItems
                ? ` of ${Math.ceil(totalItems / ITEMS_PER_PAGE)}`
                : ""}</span
            >
            <button
              class="pagination-button ripple"
              on:click={() => changePage("next")}
              disabled={!hasMore}
              aria-label="Next page"
              bind:this={nextPageButtonEl}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24px"
                viewBox="0 0 24 24"
                width="24px"
                fill="currentColor"
              >
                <path d="M0 0h24v24H0V0z" fill="none" />
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6-6-6z" />
              </svg>
            </button>
          </div>
          <button
            class="refresh ripple"
            on:click={refreshData}
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
            aria-label="Reset selection"
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
      {#if filteredOccurrences.length === 0 && !loadingMore}
        <div class="no-occurrences-message">
          <p>
            There are no occurrences available for the selected time period.
          </p>
          <p>
            Please try adjusting the pagination or filters to view more data.
          </p>
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
          </table>

          {#if loadingMore}
            <div class="loading-more">
              <div class="spinner-small">
                <svg
                  preserveAspectRatio="xMidYMid meet"
                  focusable="false"
                  viewBox="0 0 100 100"
                >
                  <circle cx="50%" cy="50%" r="45" />
                </svg>
              </div>
              <span>Loading more...</span>
            </div>
          {/if}

          {#if totalItems > 0}
            <div class="records-info">
              <span
                >Showing {filteredOccurrences.length} of {totalItems} occurrences</span
              >
            </div>
          {/if}
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

  .copy-button {
    transition: color 0.3s ease; // Smooth color transition
    background: none;
    border: none;
    cursor: pointer;
    color: #333; // Default color
    margin-left: 8px;
    vertical-align: middle;
    font-size: 16px;
    float: right;

    &:hover {
      color: #555; // Hover color
      animation: pulse 1s infinite;
    }

    @keyframes pulse {
      0% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
      100% {
        opacity: 1;
      }
    }

    &.success svg {
      fill: #4caf50; // Green color indicating success
    }
  }

  .time-adjustment {
    .input-switch {
      display: flex;
      align-items: center;
      position: relative;
      user-select: none;
      font-family: inherit; // Ensures the switch uses the app's default font
      margin-top: 13px;

      .switch-label {
        color: var(--text-color, #333);
        padding: 0 10px;
      }

      .input {
        opacity: 0;
        position: absolute;
        z-index: -1;
      }

      .switch {
        cursor: pointer;
        width: 50px;
        height: 25px;
        background: var(--deactivated-color, #34a45c); // Default background
        border-radius: 2px; // Reduced for a more rectangular look
        position: relative;
        transition: background-color 0.3s ease;

        &:before {
          content: "";
          position: absolute;
          top: 2px;
          left: 2px;
          width: 21px;
          height: 21px;
          background: white;
          border-radius: 0px; // Zero for square toggle
          transition:
            transform 0.3s ease,
            background-color 0.3s ease;
        }
      }

      .input:checked + .switch {
        background: var(
          --activated-color,
          #739ce6
        ); // Change background on active

        &:before {
          transform: translateX(25px); // Move the toggle to the right
        }
      }
    }
    display: flex;
    align-items: center;
    .button-group {
      margin-left: 5px;
      margin-top: 16px;
      display: flex;
      background-color: var(
        --input-background-color,
        #fff
      ); // Assuming default fallback
      border: 0.5px solid var(--input-border-color, #ccc); // Match border with other inputs
      border-radius: 4px;
      overflow: hidden;
      height: 36px;

      button {
        width: 0px;
        flex: 1;
        padding: 0px;
        font-size: 18px;
        background-color: transparent;
        border: none !important;
        cursor: pointer;
        color: var(--text-color, #333);

        &:hover {
          background-color: var(--button-hover-bg-color, #eee);
        }

        &:not(:last-child) {
          border-right: 1px solid var(--input-border-color, #ccc);
        }
        svg {
          margin-top: 3px;
          fill: var(--button-icon-color, #666); // Default icon color
          transition: fill 0.3s ease; // Smooth transition for color change

          &:hover {
            fill: var(--button-icon-hover-color, #333); // Change color on hover
          }
        }
      }
    }

    input[type="number"] {
      flex: 1; // Make input take available space to match size with search input
      text-align: center;
      border: none !important; // Remove border inside the group
      background-color: transparent; // Use transparent background inside the group
      color: var(--text-color, #333);
      width: 50%;
      line-height: 38px; // Center text vertically
      &:focus {
        outline: none; // Remove focus outline inside the button group
      }

      -webkit-appearance: none;
      appearance: none;
    }
  }

  .pagination-container {
    display: flex;
    align-items: center;
    margin-left: 8px;
    margin-right: 6px;
  }

  .pagination-button {
    background: var(--basic);
    border: 1px solid var(--card-border-color);
    border-radius: 4px;
    color: var(--text-color);
    padding: 4px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &:hover:not(:disabled) {
      background-color: var(--button-hover-bg-color, #eee);
    }
  }

  .pagination-info {
    margin: 0 8px;
    font-size: 14px;
    color: var(--text-color);
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
    margin-bottom: 40px;
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
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 150px;

    .progress-container {
      width: 80%;
      max-width: 500px;
      height: 8px;
      background-color: #e0e0e0;
      border-radius: 4px;
      margin-top: 20px;
      position: relative;
      overflow: hidden;

      .progress-bar {
        height: 100%;
        background-color: var(--primary, #3f51b5);
        transition: width 0.3s ease;
      }

      .progress-text {
        position: absolute;
        top: 15px;
        width: 100%;
        text-align: center;
        font-size: 14px;
        color: var(--text-color, #333);
      }
    }
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    text-align: center;

    h3 {
      color: #f44336;
      margin-top: 10px;
      margin-bottom: 10px;
    }

    p {
      margin-bottom: 20px;
      color: #666;
    }

    .retry-button {
      padding: 8px 16px;
      background-color: #2196f3;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;

      &:hover {
        background-color: #1976d2;
      }
    }
  }

  .table-wrapper {
    position: absolute;
    left: 0;
    right: 0;
    top: -9px;
    bottom: 0;
    padding: 8px;
    overflow: auto;
    overflow-anchor: none;
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
          top: -10px;
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

  .no-occurrences-message {
    text-align: center;
    font-size: 16px;
    color: #555; // Subtle color to match the UI theme
    padding: 40px 0; // Extra padding to give the message room to breathe
    background-color: #f9f9f9; // Slight background color change for emphasis

    p {
      margin: 8px 0;
    }
  }
  .key-column {
    height: 20px;
  }

  .loading-more {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 16px;

    .spinner-small {
      height: 20px;
      width: 20px;
      margin-right: 8px;

      svg {
        height: 20px;
        width: 20px;
      }
    }

    span {
      font-size: 14px;
      color: var(--text-color, #333);
    }
  }

  .records-info {
    display: flex;
    justify-content: center;
    padding: 16px;

    span {
      font-size: 14px;
      color: var(--text-secondary, #666);
    }
  }
</style>
