import { DateTime } from "luxon";
import type { Occurrence } from "../types";

// Simple fuzzy matching function
export function fuzzyMatch(text: string, pattern: string): boolean {
  if (!text || !pattern) return false;

  text = text.toLowerCase();
  pattern = pattern.toLowerCase();

  // Direct contains check (fastest)
  if (text.includes(pattern)) return true;

  // Fuzzy matching for IDs and longer patterns
  if (pattern.length >= 3) {
    let textIndex = 0;
    for (let i = 0; i < pattern.length; i++) {
      const found = text.indexOf(pattern[i], textIndex);
      if (found === -1) return false;
      textIndex = found + 1;
    }
    return true;
  }

  return false;
}

// Parse search query as a date
export function parseSearchDate(
  query: string,
  timeZone: string
): {
  isDate: boolean;
  dateObj: any; // Changed from DateTime | null to any
  apiFilters: string[];
} {
  const result = {
    isDate: false,
    dateObj: null,
    apiFilters: [] as string[],
  };

  // Common date formats to try
  const formats = [
    "M/d/yyyy", // 3/5/2025
    "M/d/yyyy, h:mm a", // 3/5/2025, 9:06 PM
    "MM/dd/yyyy",
    "dd-MM-yyyy",
    "dd/MM/yyyy",
    "h:mm a", // 9:06 PM (time only)
    "HH:mm", // 21:06 (24-hour time)
  ];

  try {
    // Try each format
    for (const format of formats) {
      const dt = DateTime.fromFormat(query, format, { zone: timeZone });
      if (dt.isValid) {
        result.isDate = true;
        result.dateObj = dt;

        // Time-only format
        if (format === "h:mm a" || format === "HH:mm") {
          const timeString = dt.toFormat("HH:mm");
          result.apiFilters.push(
            `contains(string(occurredOn), "T${timeString}")`
          );
        }
        // Date-only format
        else if (!format.includes(":")) {
          const startOfDay = dt.startOf("day").toISO();
          const endOfDay = dt.endOf("day").toISO();
          result.apiFilters.push(
            `(occurredOn ge ${startOfDay} and occurredOn le ${endOfDay})`
          );
        }
        // Complete date+time format
        else {
          const startTime = dt.toISO();
          const endTime = dt.plus({ minutes: 5 }).toISO(); // 5 minute window
          result.apiFilters.push(
            `(occurredOn ge ${startTime} and occurredOn le ${endTime})`
          );
        }

        break;
      }
    }
  } catch (error) {
    console.log("Date parsing error:", error);
  }

  return result;
}

// Client-side occurrence filtering with proper time zone handling
export function filterOccurrences(
  occurrences: Occurrence[],
  searchQuery: string,
  timeZone: string
): Occurrence[] {
  if (!searchQuery || !searchQuery.trim()) {
    return occurrences;
  }

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const dateCheck = parseSearchDate(trimmedQuery, timeZone);

  return occurrences.filter((occurrence) => {
    // ID search - use fuzzy matching for partial IDs
    if (fuzzyMatch(occurrence.publicId, trimmedQuery)) return true;

    // Name search - use fuzzy matching
    if (fuzzyMatch(occurrence.name, trimmedQuery)) return true;

    // Severity search
    if (fuzzyMatch(occurrence.severity, trimmedQuery)) return true;

    // Date matching - if the search looks like a date
    if (dateCheck.isDate && dateCheck.dateObj) {
      // Convert occurrence date to DateTime with proper time zone
      const occDate = DateTime.fromISO(occurrence.occurredOn.fullDate, {
        zone: timeZone,
      });

      if (!occDate.isValid) {
        console.warn(
          `Invalid date encountered: ${occurrence.occurredOn.fullDate}`
        );
        return false;
      }

      // Match whole day if only date was specified
      if (!trimmedQuery.includes(":")) {
        return occDate.hasSame(dateCheck.dateObj, "day");
      }

      // Match just the time part if only time was specified (no year)
      if (!trimmedQuery.includes("/") && !trimmedQuery.includes("-")) {
        return (
          occDate.hour === dateCheck.dateObj.hour &&
          Math.abs(occDate.minute - dateCheck.dateObj.minute) <= 5
        ); // Allow 5-min tolerance
      }

      // Match exact date-time for full specifications with small tolerance
      return Math.abs(occDate.diff(dateCheck.dateObj, "minutes").minutes) <= 5;
    }

    return false;
  });
}
