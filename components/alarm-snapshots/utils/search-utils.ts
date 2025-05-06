import { DateTime } from "luxon";
import type { Occurrence } from "../types";

// Simple fuzzy matching function
// Replace the existing fuzzyMatch function (around line 4-19) with this:
export function fuzzyMatch(text: string, pattern: string): boolean {
  if (!text || !pattern) return false;

  const textLower = text.toLowerCase();
  const patternLower = pattern.toLowerCase();

  // Direct contains check (fastest)
  if (textLower.includes(patternLower)) return true;

  // For IDs, try to match even partial segments
  if (text.includes("-") && pattern.length >= 2) {
    const segments = text.split("-");
    for (const segment of segments) {
      if (segment.toLowerCase().startsWith(patternLower)) return true;
    }
  }

  // Fuzzy matching for longer patterns
  if (pattern.length >= 2) {
    let textIndex = 0;
    for (let i = 0; i < patternLower.length; i++) {
      const found = textLower.indexOf(patternLower[i], textIndex);
      if (found === -1) return false;
      textIndex = found + 1;
    }
    return true;
  }

  return false;
}

// Parse search query as a date
// Replace the existing parseSearchDate function (around line 21-71) with this:
export function parseSearchDate(
  query: string,
  timeZone: string
): {
  isDate: boolean;
  dateObj: any;
  apiFilters: string[];
} {
  const result = {
    isDate: false,
    dateObj: null,
    apiFilters: [] as string[],
  };

  // Remove common separators to improve matching
  const normalizedQuery = query.replace(/[\/\-\.\,\s]/g, "");
  if (normalizedQuery.length < 2) return result;

  // Common date formats to try
  const formats = [
    // US formats
    "M/d/yyyy",
    "MM/dd/yyyy",
    "M-d-yyyy",
    "MM-dd-yyyy",
    // European formats
    "d/M/yyyy",
    "dd/MM/yyyy",
    "d-M-yyyy",
    "dd-MM-yyyy",
    // ISO formats
    "yyyy/MM/dd",
    "yyyy-MM-dd",
    "yyyy.MM.dd",
    // With time
    "M/d/yyyy, h:mm a",
    "MM/dd/yyyy, h:mm a",
    "d/M/yyyy, h:mm a",
    "dd/MM/yyyy, h:mm a",
    "M/d/yyyy HH:mm",
    "d/M/yyyy HH:mm",
    "yyyy/MM/dd HH:mm",
    "yyyy-MM-dd HH:mm",
    // Time only
    "h:mm a",
    "HH:mm",
    // Just year and month
    "MM/yyyy",
    "MM-yyyy",
    "yyyy/MM",
    "yyyy-MM",
    // Just month and day
    "MM/dd",
    "dd/MM",
    "M/d",
    "d/M",
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
        // Date-only format (no time)
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

    // Try to guess year/month/day combinations if normal parsing failed
    if (
      !result.isDate &&
      normalizedQuery.length >= 6 &&
      /^\d+$/.test(normalizedQuery)
    ) {
      // Try different positions for year, month, day
      const patterns = [
        { year: 0, month: 4, day: 6 }, // yyyyMMdd
        { year: 4, month: 0, day: 2 }, // MMddyyyy
        { year: 4, month: 2, day: 0 }, // ddMMyyyy
      ];

      for (const pattern of patterns) {
        if (
          normalizedQuery.length <
          Math.max(pattern.year + 4, pattern.month + 2, pattern.day + 2)
        )
          continue;

        const yearPart = normalizedQuery.substr(pattern.year, 4);
        const monthPart = normalizedQuery.substr(pattern.month, 2);
        const dayPart = normalizedQuery.substr(pattern.day, 2);

        // Check if parts look valid
        const year = parseInt(yearPart);
        const month = parseInt(monthPart);
        const day = parseInt(dayPart);

        if (
          year >= 2000 &&
          year <= 2050 &&
          month >= 1 &&
          month <= 12 &&
          day >= 1 &&
          day <= 31
        ) {
          const dateStr = `${year}-${month.toString().padStart(2, "0")}-${day
            .toString()
            .padStart(2, "0")}`;
          const dt = DateTime.fromISO(dateStr, { zone: timeZone });

          if (dt.isValid) {
            result.isDate = true;
            result.dateObj = dt;
            const startOfDay = dt.startOf("day").toISO();
            const endOfDay = dt.endOf("day").toISO();
            result.apiFilters.push(
              `(occurredOn ge ${startOfDay} and occurredOn le ${endOfDay})`
            );
            break;
          }
        }
      }
    }
  } catch (error) {
    console.log("Date parsing error:", error);
  }

  return result;
}

// Client-side occurrence filtering
// Replace the existing filterOccurrences function (around line 73-126) with this:
export function filterOccurrences(
  occurrences: Occurrence[],
  searchQuery: string,
  timeZone: string
): Occurrence[] {
  if (!searchQuery || !searchQuery.trim()) {
    return occurrences;
  }

  const trimmedQuery = searchQuery.trim();
  const dateCheck = parseSearchDate(trimmedQuery, timeZone);

  return occurrences.filter((occurrence) => {
    // ID search - use fuzzy matching for IDs and segments
    if (fuzzyMatch(occurrence.publicId, trimmedQuery)) return true;

    // Name search - use fuzzy matching
    if (fuzzyMatch(occurrence.name, trimmedQuery)) return true;

    // Severity search
    if (fuzzyMatch(occurrence.severity, trimmedQuery)) return true;

    // Date matching - if the search looks like a date
    if (dateCheck.isDate && dateCheck.dateObj) {
      // Convert occurrence date to DateTime
      const occDate = DateTime.fromISO(occurrence.occurredOn.fullDate, {
        zone: timeZone,
      });

      if (!occDate.isValid) return false;

      // For date-only queries (no time component)
      if (!trimmedQuery.includes(":")) {
        if (dateCheck.dateObj.year && occDate.year !== dateCheck.dateObj.year)
          return false;

        // If only day and month were provided (no year)
        if (!/\d{4}/.test(trimmedQuery)) {
          return (
            occDate.month === dateCheck.dateObj.month &&
            occDate.day === dateCheck.dateObj.day
          );
        }

        // Full date matching
        return occDate.hasSame(dateCheck.dateObj, "day");
      }

      // For time-only queries (no date component)
      if (
        !/\d{1,2}[-\/\.]\d{1,2}/.test(trimmedQuery) &&
        !/\d{4}/.test(trimmedQuery)
      ) {
        const hourMatch = occDate.hour === dateCheck.dateObj.hour;
        const minuteMatch =
          Math.abs(occDate.minute - dateCheck.dateObj.minute) <= 5; // 5-min tolerance
        return hourMatch && minuteMatch;
      }

      // Full date-time matching with tolerance
      return Math.abs(occDate.diff(dateCheck.dateObj, "minutes").minutes) <= 10; // 10-min tolerance
    }

    return false;
  });
}
