// utils/dateFilters.js
import { 
  parseISO, 
  isSameDay, 
  isWithinInterval, 
  startOfWeek, 
  endOfWeek, 
  startOfDay, 
  endOfDay 
} from 'date-fns';

/**
 * Helper to get the current week's range (Sunday to Saturday by default)
 * Useful for initializing default state in your parent container.
 */
export function getCurrentWeekRange() {
  const now = new Date();
  return [
    startOfWeek(now, { weekStartsOn: 0 }),
    endOfWeek(now, { weekStartsOn: 0 })
  ];
}

/**
 * Checks whether a given report falls within the selected picker date window.
 * Defaults to the current week window if no custom filter value is provided.
 */
export function isReportInDateFilter(report, pickerType, dateValue) {
  if (!report) return false;

  const rawTimestamp = 
    report.resolvedAt || 
    report.timestamp || 
    report.verifiedAt || 
    report.reportTimestamp || 
    report.createdAt;

  if (!rawTimestamp) return false;

  try {
    const reportDate = typeof rawTimestamp.toDate === 'function'
      ? rawTimestamp.toDate()
      : typeof rawTimestamp === 'string'
        ? parseISO(rawTimestamp)
        : new Date(rawTimestamp);

    if (isNaN(reportDate.getTime())) return false;

    // Check if custom user selection exists
    const isCustomFilterActive = 
      (pickerType === 'single' && dateValue) ||
      ((pickerType === 'range' || pickerType === 'week') && Array.isArray(dateValue) && dateValue[0]) ||
      (pickerType === 'multiple' && Array.isArray(dateValue) && dateValue.length > 0);

    // Default: Fallback to current week window when no date selection is active
    if (!isCustomFilterActive) {
      const now = new Date();
      const start = startOfWeek(now, { weekStartsOn: 0 });
      const end = endOfWeek(now, { weekStartsOn: 0 });
      return isWithinInterval(reportDate, { start, end });
    }

    if (pickerType === 'single') {
      return isSameDay(reportDate, dateValue);
    } 

    if (pickerType === 'multiple' && Array.isArray(dateValue)) {
      return dateValue.some(d => isSameDay(reportDate, d));
    } 

    // Covers both 'range' and 'week' array selections: [startDate, endDate]
    if ((pickerType === 'range' || pickerType === 'week') && Array.isArray(dateValue)) {
      const [start, end] = dateValue;
      if (start && end) {
        return isWithinInterval(reportDate, { 
          start: startOfDay(start), 
          end: endOfDay(end) 
        });
      }
      if (start && !end) {
        return isSameDay(reportDate, start);
      }
    }

    return true;
  } catch (err) {
    return false;
  }
}