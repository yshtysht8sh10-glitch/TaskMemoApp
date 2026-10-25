/** Sunday is 0 and Saturday is 6, as in Date.getDay()/getUTCDay(). */
export const daysUntilWeekEnd = (dayOfWeek: number) => 6 - dayOfWeek;
