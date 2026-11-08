import { DateTime } from 'luxon';

export function local(date: Date, zone: string): DateTime {
  return DateTime.fromJSDate(date, { zone });
}

/** 'yyyy-MM-dd' no fuso indicado. */
export function localDay(date: Date, zone: string): string {
  return local(date, zone).toISODate()!;
}

/** 'HH:mm' no fuso indicado. */
export function localTime(date: Date, zone: string): string {
  return local(date, zone).toFormat('HH:mm');
}

/** 'yyyy-MM-dd' -> 'dd/MM/yyyy' */
export function br(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}
