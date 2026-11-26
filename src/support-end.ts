/**
 * Adds whole months to a date in UTC, clamping to the last day of the target
 * month (2026-01-31 plus one month is 2026-02-28).
 * @param date - The start
 * @param months - Months to add
 * @returns The date `months` later
 * @example
 * addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString(); // '2026-02-28T00:00:00.000Z'
 */
export function addMonths(date: Date, months: number): Date {
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth() + months;
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return new Date(
		Date.UTC(
			year,
			month,
			Math.min(date.getUTCDate(), lastDay),
			date.getUTCHours(),
			date.getUTCMinutes(),
			date.getUTCSeconds(),
		),
	);
}

/**
 * Formats a date as `YYYY-MM-DD` in UTC, the form `SECURITY.md` states
 * support end dates in.
 * @param date - The date
 * @returns The date part of its ISO string
 * @example
 * formatDate(new Date('2027-03-01T12:00:00Z')); // '2027-03-01'
 */
export function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}
