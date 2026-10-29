/**
 * Standard Date & Time Formatting Utilities for Railway NOC
 * 
 * Enforces consistent representation in Asia/Kolkata (IST) timezone.
 * Format: "26 Oct 2026, 10:30:30 AM IST"
 */

export function formatIndianDateTime(dateInput) {
  if (!dateInput) return '—';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '—';

    const formatted = d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    // Normalize am/pm to uppercase AM/PM and append IST
    return formatted.replace(/\b([ap]m)\b/i, (m) => m.toUpperCase()) + ' IST';
  } catch {
    return String(dateInput);
  }
}

export function formatIndianDate(dateInput) {
  if (!dateInput) return '—';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '—';

    return d.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(dateInput);
  }
}

export function formatIndianTime(dateInput) {
  if (!dateInput) return '—';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '—';

    const formatted = d.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    return formatted.replace(/\b([ap]m)\b/i, (m) => m.toUpperCase()) + ' IST';
  } catch {
    return String(dateInput);
  }
}
