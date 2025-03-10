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
  import { ProblematicAgentHandler } from "./services/problematic-agent-handler";

  export let context: ComponentContext;
  let alarmsManager: AlarmsManager;

  // Create date formatters only once
  const formatters = {
    fullDate: new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    dateOnly: new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    timeOnly: new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    tableFormat: new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    }),
  };

  type Occurrence = {
    name: string;
    occurredOn: {
      fullDate: string;
      dateOnly: string;
      timeOnly: string;
      formattedDate: string;
    };
    severity: string;
    publicId: string;
  };

  // Use proper state management to prevent unnecessary re-renders
  let occurrencesList: Occurrence[] = [];
  let filteredOccurrences: Occurrence[] = [];
  let loading = true;
  let tableWidth = 0;
  let tableScrollTop = 0;
  let doAutoRefresh = false;
  let autoRefreshInterval: number | undefined;
  let autoRefreshRate: number = 60; // Refresh rate in seconds
  $: isNarrow = tableWidth < 320;

  let agentId: string | null = null;
  let search = "";
  let translations: Record<string, string>;
  let error: string | null = null;
  let lastRefreshTime: string = "";
  let warningMessage: string | null = null;
  let loadProgress = 0;

  let from = "";
  let to = "";

  enum TimeRanges {
    FourWeeks = "4 weeks",
    ThreeMonths = "3 months",
    SixMonths = "6 months",
    OneYear = "1 year",
    ThreeDays = "3 days",
    OneWeek = "1 week",
  }

  let timeRangeOptions: {
    [K in TimeRanges]: {
      weeks?: number;
      months?: number;
      years?: number;
      days?: number;
    };
  } = {
    [TimeRanges.FourWeeks]: { weeks: 4 },
    [TimeRanges.ThreeMonths]: { months: 3 },
    [TimeRanges.SixMonths]: { months: 6 },
    [TimeRanges.OneYear]: { years: 1 },
    [TimeRanges.ThreeDays]: { days: 3 },
    [TimeRanges.OneWeek]: { weeks: 1 },
  };

  let selectedTimeRange: TimeRanges = TimeRanges.FourWeeks;

  let isToDate = false; // Default to adjusting 'from'

  function toggleDateAdjustment() {
    adjustmentTarget = isToDate ? "to" : "from";
  }

  let minuteAdjustment: number = 15; // Default adjustment period in minutes
  let adjustmentTarget: "from" | "to" = "from"; // Default to adjusting 'from' date

  onMount(async () => {
    try {
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
                // Check if this is a problematic agent
                if (ProblematicAgentHandler.isProblematicAgent(agentId)) {
                  warningMessage =
                    ProblematicAgentHandler.getWarningMessage(agentId);

                  // For problematic agents, use a safe, short time range
                  const now = new Date();
                  const safeRange = ProblematicAgentHandler.getSafeDateRange(
                    agentId,
                    now
                  );

                  // Set the recommended time range
                  const recommendedDays =
                    ProblematicAgentHandler.getRecommendedTimeRange(agentId);
                  if (recommendedDays <= 7) {
                    selectedTimeRange = TimeRanges.ThreeDays;
                  } else {
                    selectedTimeRange = TimeRanges.FourWeeks;
                  }

                  // Fetch data with safe range
                  await fetchData(agentId, safeRange.from, safeRange.to);
                } else {
                  // Normal agent handling
                  await selectFirstNonEmptyRange();
                }
                startAutoRefresh();
              }
            }
          }
        );
      } else {
        console.error("Context is not initialized.");
        error = "Context initialization failed.";
      }
    } catch (e) {
      console.error("Error during component initialization:", e);
      error = "Error initializing component. Please try refreshing the page.";
    }
  });

  function startAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
    }

    if (doAutoRefresh) {
      autoRefreshInterval = setInterval(() => {
        if (agentId) {
          updateDateRange(true);
        }
      }, autoRefreshRate * 1000);
    }
  }

  function toggleAutoRefresh() {
    doAutoRefresh = !doAutoRefresh;
    startAutoRefresh();
  }

  function updateDateRange(forceRefresh = false) {
    if (!agentId) {
      return;
    }

    // Check if this is a custom time range for problematic agents
    const selectedTimeRangeStr = String(selectedTimeRange);
    if (selectedTimeRangeStr.includes("days")) {
      const days = parseInt(selectedTimeRangeStr.split(" ")[0]);
      if (!isNaN(days)) {
        const toDt = DateTime.now().toUTC();
        const fromDt = toDt.minus({ days });
        fetchData(agentId, fromDt.toJSDate(), toDt.toJSDate(), forceRefresh);
        return;
      }
    }

    // Standard time ranges
    const duration = timeRangeOptions[selectedTimeRange as TimeRanges];
    const fromDt = DateTime.now().minus(duration).toUTC();
    const toDt = DateTime.now().toUTC();

    // Check if the selected range is excessive for this agent
    if (
      ProblematicAgentHandler.isTimeRangeExcessive(
        agentId,
        fromDt.toJSDate(),
        toDt.toJSDate()
      )
    ) {
      // Show warning and adjust to safe range
      warningMessage =
        "The selected time range may be too large for this agent. Using a safer time range.";
      const safeRange = ProblematicAgentHandler.getSafeDateRange(
        agentId,
        toDt.toJSDate()
      );
      fetchData(agentId, safeRange.from, safeRange.to, forceRefresh);
    } else {
      // Use selected range
      warningMessage = null;
      fetchData(agentId, fromDt.toJSDate(), toDt.toJSDate(), forceRefresh);
    }
  }

  function handleTableScroll(event: Event): void {
    tableScrollTop = (event.target as HTMLDivElement).scrollTop;
  }

  async function fetchData(
    agentId: string,
    from: Date,
    to: Date,
    forceRefresh = false
  ): Promise<boolean> {
    loading = true;
    error = null;
    loadProgress = 0;

    try {
      // Show visual progress indicator
      const progressInterval = setInterval(() => {
        // Simulate progress up to 90% while waiting
        if (loadProgress < 90) {
          loadProgress += 5;
        }
      }, 200);

      let alarms = await alarmsManager.getAllAlarmOccurrencesForAgent(
        agentId,
        from,
        to,
        forceRefresh
      );

      clearInterval(progressInterval);
      loadProgress = 100;

      // Process data in chunks to avoid UI lockup
      const processedOccurrences = [];
      const chunkSize = 100;

      // Build occurrence list in chunks
      for (const alarm of alarms) {
        for (let i = 0; i < alarm.occurrences.length; i += chunkSize) {
          const chunk = alarm.occurrences.slice(i, i + chunkSize);

          const processed = chunk.map((occ) => ({
            name: alarm.name,
            occurredOn: formatDate(occ.occurredOn),
            severity: alarm.severity,
            publicId: occ.publicId || "Unknown ID",
          }));

          processedOccurrences.push(...processed);

          // Allow UI to update between chunks
          if (i + chunkSize < alarm.occurrences.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      }

      // Sort all occurrences by date in descending order
      occurrencesList = processedOccurrences.sort((a, b) => {
        return (
          DateTime.fromISO(b.occurredOn.fullDate).toMillis() -
          DateTime.fromISO(a.occurredOn.fullDate).toMillis()
        );
      });

      // Update last refresh time
      lastRefreshTime = new Date().toLocaleTimeString();

      return occurrencesList.length > 0;
    } catch (error) {
      console.error("Error fetching data:", error);
      this.error = "Failed to fetch alarm data. Please try again.";
      return false;
    } finally {
      loading = false;
    }
  }

  async function selectFirstNonEmptyRange() {
    if (!agentId) return;

    for (const timeRange of Object.keys(timeRangeOptions) as TimeRanges[]) {
      loading = true;
      const duration = timeRangeOptions[timeRange];
      const fromDt = DateTime.now().minus(duration).toUTC();
      const toDt = DateTime.now().toUTC();

      const hasData = await fetchData(
        agentId,
        fromDt.toJSDate(),
        toDt.toJSDate()
      );
      if (hasData) {
        selectedTimeRange = timeRange;
        break;
      }
    }
  }

  // Memoize date formatting to improve performance
  const dateCache = new Map<string, any>();

  function formatDate(dateString: string | undefined) {
    if (!dateString) {
      return {
        fullDate: "No Date Provided",
        dateOnly: "No Date Provided",
        timeOnly: "No Time Provided",
        formattedDate: "No Date Provided",
      };
    }

    // Check cache first
    if (dateCache.has(dateString)) {
      return dateCache.get(dateString);
    }

    const dt = DateTime.fromISO(dateString);
    const result = {
      fullDate: dt.toISO(),
      dateOnly: dt.toFormat("dd-MM-yyyy"),
      timeOnly: dt.toFormat("HH:mm"),
      formattedDate: dt.toFormat("dd-MM-yyyy HH:mm"),
    };

    // Cache the result
    dateCache.set(dateString, result);
    return result;
  }

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

  // Debounce search to improve performance
  let debouncedSearch = search;
  let searchTimeout: number;

  $: {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      debouncedSearch = search;
    }, 250) as unknown as number;
  }

  // Add throttled filtering to prevent UI freezes
  $: {
    if (debouncedSearch !== undefined) {
      const searchTerm = debouncedSearch.toLowerCase();
      filteredOccurrences = occurrencesList.filter((occ) => {
        const { fullDate, dateOnly, timeOnly, formattedDate } = occ.occurredOn;

        // New formatted date for table
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
        ].some((field) => field.includes(searchTerm));
      });
    }
  }

  function toggleRefresh(): void {
    if (agentId) {
      updateDateRange(true);
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
  let timerangeSelectEl: HTMLSelectElement;
  let autoRefreshButtonEl: HTMLButtonElement;

  afterUpdate(() => {
    if (refreshButtonEl) {
      context.createTooltip(refreshButtonEl, {
        message: "Refresh the occurrence list",
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
    if (timerangeSelectEl) {
      context.createTooltip(timerangeSelectEl, {
        message: "Choose a time range to retrieve the occurrences",
      });
    }
    if (autoRefreshButtonEl) {
      context.createTooltip(autoRefreshButtonEl, {
        message: doAutoRefresh ? "Disable auto-refresh" : "Enable auto-refresh",
      });
    }
    // Add tooltips for copy buttons
    document.querySelectorAll(".copy-button").forEach((button) => {
      context.createTooltip(button as HTMLElement, {
        message: "Copy ID to clipboard",
      });
    });
  });

  // Cache formatting results
  const formattedDateCache = new Map<string, string>();

  function formatDateForTable(dateString: string | undefined): string {
    if (!dateString) {
      return "No Date Provided";
    }

    // Check cache first
    if (formattedDateCache.has(dateString)) {
      return formattedDateCache.get(dateString)!;
    }

    const dt = DateTime.fromISO(dateString);
    const result = dt.toFormat("M/d/yyyy, h:mm a");

    // Cache the result
    formattedDateCache.set(dateString, result);
    return result;
  }
</script>

<div class="card">
  {#if loading}
    <div class="loading-state">
      <div class="progress-container">
        <div class="progress-bar" style="width: {loadProgress}%"></div>
      </div>
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
  {:else if error}
    <div class="error-message">
      <p>{error}</p>
      <button class="ripple" on:click={toggleRefresh}>Try Again</button>
    </div>
  {:else}
    <div class="card-header with-actions">
      <h3 class="card-title" data-testid="active-alarms-overview-card-title">
        Alarm snapshots
        {#if lastRefreshTime}
          <span class="last-updated">Last updated: {lastRefreshTime}</span>
        {/if}
      </h3>

      {#if warningMessage}
        <div class="warning-message">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="24"
            viewBox="0 -960 960 960"
            width="24"
          >
            <path
              d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"
              fill="#f57c00"
            />
          </svg>
          <span>{warningMessage}</span>
        </div>
      {/if}

      <div class="actions-top">
        <div class="time-adjustment">
          <div class="input-switch">
            <label class="switch-label">Start Date</label>
            <input
              type="checkbox"
              id="switchy"
              class="input"
              bind:checked={isToDate}
              on:change={toggleDateAdjustment}
            />
            <label
              bind:this={fromDateInputSwitchEl}
              for="switchy"
              class="switch"
            ></label>
            <label class="switch-label">End Date</label>
          </div>
          <div class="button-group">
            <button
              on:click={decrementTimeRange}
              bind:this={decrementTimeRangeButtonEl}
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
              max="120"
              title="Adjustment in minutes"
            />
            <button
              on:click={incrementTimeRange}
              bind:this={incrementTimeRangeButtonEl}
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
          <select
            class="timerange-select"
            bind:value={selectedTimeRange}
            on:change={() => updateDateRange()}
            bind:this={timerangeSelectEl}
          >
            {#if agentId && ProblematicAgentHandler.isProblematicAgent(agentId)}
              <option value={TimeRanges.ThreeDays}>Last 3 Days</option>
              <option value={TimeRanges.OneWeek}>Last Week</option>
              <option value={TimeRanges.FourWeeks}>Last 4 Weeks</option>
            {:else}
              <option value={TimeRanges.FourWeeks}>Last 4 Weeks</option>
              <option value={TimeRanges.ThreeMonths}>Last 3 Months</option>
              <option value={TimeRanges.SixMonths}>Last 6 Months</option>
              <option value={TimeRanges.OneYear}>Last 1 Year</option>
            {/if}
          </select>
          <button
            class="refresh ripple"
            on:click={toggleRefresh}
            bind:this={refreshButtonEl}
            title="Refresh data"
          >
            <svg width="24" height="24" viewBox="0 -960 960 960">
              <path
                d="M204-318q-22-38-33-78t-11-82q0-134 93-228t227-94h7l-64-64 56-56 160 160-160 160-56-56 64-64h-7q-100 0-170 70.5T240-478q0 26 6 51t18 49l-60 60ZM481-40 321-200l160-160 56 56-64 64h7q100 0 170-70.5T720-482q0-26-6-51t-18-49l60-60q22 38 33 78t11 82q0 134-93 228t-227 94h-7l64 64-56 56Z"
              />
            </svg>
          </button>
          <button
            class="auto-refresh ripple {doAutoRefresh ? 'active' : ''}"
            on:click={toggleAutoRefresh}
            bind:this={autoRefreshButtonEl}
            title={doAutoRefresh
              ? "Disable auto refresh"
              : "Enable auto refresh"}
          >
            <svg width="24" height="24" viewBox="0 -960 960 960">
              <path
                d="M480-160q-133 0-226.5-93.5T160-480q0-133 93.5-226.5T480-800q133 0 226.5 93.5T800-480q0 133-93.5 226.5T480-160Zm0-80q100 0 170-70t70-170q0-100-70-170t-170-70q-100 0-170 70t-70 170q0 100 70 170t170 70Zm0-80q-67 0-113.5-46.5T320-480q0-67 46.5-113.5T480-640q67 0 113.5 46.5T640-480q0 67-46.5 113.5T480-320Zm0-160Z"
              />
            </svg>
          </button>
          <button
            class="reset ripple"
            on:click={resetSelectedOccurrence}
            bind:this={resetButtonEl}
            title="Reset to current day"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              fill="#f44336"
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
          <div class="progress-container">
            <div class="progress-bar" style="width: {loadProgress}%"></div>
          </div>
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
          <p>
            There are no occurrences available for the selected time period.
          </p>
          <p>Please try adjusting the time range above to view more data.</p>
          <button class="ripple refresh-button" on:click={toggleRefresh}
            >Refresh Data</button
          >
        </div>
      {:else}
        <div class="stats-bar">
          <div class="stat">
            <span class="stat-label">Total Occurrences:</span>
            <span class="stat-value">{occurrencesList.length}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Shown:</span>
            <span class="stat-value">{filteredOccurrences.length}</span>
          </div>
          {#if search}
            <div class="stat">
              <span class="stat-label">Filter:</span>
              <span class="stat-value">{search}</span>
              <button class="clear-filter" on:click={() => (search = "")}
                >✕</button
              >
            </div>
          {/if}
        </div>

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
              {#each filteredOccurrences as occurrence (occurrence.publicId)}
                <tr
                  class="table-row"
                  on:click={() => selectOccurrence(occurrence)}
                >
                  <td class="id-column">
                    <span class="id-text">{occurrence.publicId}</span>
                    <button
                      class="copy-button {copySuccess[occurrence.publicId]
                        ? 'success'
                        : ''}"
                      on:click|stopPropagation={() =>
                        copyToClipboard(occurrence.publicId)}
                      title="Copy ID to clipboard"
                    >
                      {#if copySuccess[occurrence.publicId]}
                        <!-- Display a check icon on success -->
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          height="24px"
                          viewBox="0 -960 960 960"
                          width="24px"
                          fill="#4caf50"
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
                  <td>
                    <span
                      class="severity-indicator {occurrence.severity.toLowerCase()}"
                    ></span>
                    {occurrence.severity}
                  </td>
                </tr>
              {/each}
            </tbody>
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

  .last-updated {
    font-size: 12px;
    font-weight: normal;
    color: var(--text-muted, #777);
    margin-left: 10px;
  }

  .progress-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 4px;
    background-color: #f1f1f1;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background-color: var(--primary, #4285f4);
    transition: width 0.3s ease;
  }

  .error-message {
    text-align: center;
    padding: 20px;
    color: #d32f2f;

    button {
      margin-top: 10px;
      background-color: #f1f1f1;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;

      &:hover {
        background-color: #e0e0e0;
      }
    }
  }

  .stats-bar {
    display: flex;
    padding: 8px;
    border-bottom: 1px solid var(--card-border-color, #ddd);
    margin-bottom: 8px;
    background-color: var(--card-bg-color, #f9f9f9);

    .stat {
      margin-right: 20px;
      display: flex;
      align-items: center;

      .stat-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-secondary, #666);
        margin-right: 5px;
      }

      .stat-value {
        font-size: 14px;
        font-weight: 600;
      }

      .clear-filter {
        border: none;
        background: none;
        color: var(--text-secondary, #666);
        cursor: pointer;
        margin-left: 5px;
        font-size: 12px;

        &:hover {
          color: var(--text-primary, #333);
        }
      }
    }
  }

  .warning-message {
    display: flex;
    align-items: center;
    background-color: #fff3e0;
    border-left: 4px solid #f57c00;
    padding: 8px 16px;
    margin-bottom: 16px;
    border-radius: 4px;

    svg {
      margin-right: 8px;
    }

    span {
      font-size: 14px;
      color: #333;
    }
  }

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
    vertical-align: middle; /* Center content vertically */
    padding: 8px 16px;
  }

  .base-table {
    border-collapse: collapse; /* Ensures borders between cells are merged */
  }

  .card-header {
    margin-bottom: 40px;
    .actions-top {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 10px;
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
    flex-direction: column;
  }

  .table-wrapper {
    position: absolute;
    left: 0;
    right: 0;
    top: 40px; /* Adjusted to make room for stats bar */
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
          font-weight: 600;
          padding: 12px 16px;
        }
      }
    }
    tbody tr:hover {
      background-color: rgb(0 0 0 / 4%) !important;
      cursor: pointer;
    }

    .table-row {
      transition: background-color 0.2s ease;

      &:nth-child(even) {
        background-color: rgba(0, 0, 0, 0.02);
      }
    }
  }

  .id-column {
    max-width: 200px;

    .id-text {
      display: inline-block;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .severity-indicator {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    margin-right: 8px;

    &.high,
    &.critical {
      background-color: #f44336;
    }

    &.medium,
    &.warning {
      background-color: #ff9800;
    }

    &.low,
    &.info {
      background-color: #2196f3;
    }

    &.normal {
      background-color: #4caf50;
    }
  }

  .no-search-results {
    font-size: 14px;
    margin-bottom: 16px;
  }

  .no-occurrences-message {
    text-align: center;
    font-size: 16px;
    color: #555; // Subtle color to match the UI theme
    padding: 40px 0; // Extra padding to give the message room to breathe
    background-color: var(
      --card-bg-color,
      #f9f9f9
    ); // Slight background color change for emphasis

    p {
      margin: 8px 0;
    }

    .refresh-button {
      background-color: var(--button-bg, #f1f1f1);
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      margin-top: 16px;
      cursor: pointer;
      font-size: 14px;

      &:hover {
        background-color: var(--button-hover-bg, #e0e0e0);
      }
    }
  }

  .auto-refresh {
    &.active {
      background-color: var(--button-active-bg, rgba(0, 0, 0, 0.1)) !important;
    }
  }

  .key-column {
    height: 20px;
  }

  @media (max-width: 768px) {
    .actions-top {
      flex-direction: column;
      align-items: flex-start;

      .time-adjustment {
        margin-bottom: 10px;
      }

      .search-input-container {
        width: 100% !important;
        margin-bottom: 10px;
      }

      .refresh-container {
        width: 100%;
        justify-content: space-between;
      }
    }

    .table-wrapper {
      overflow-x: auto;
    }
  }
</style>
