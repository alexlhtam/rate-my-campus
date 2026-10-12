import type { Place } from './data';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type OpeningInterval = { open: string; close: string };
export type OpeningSchedule = {
  timeZone: 'Europe/London';
  sourceUrl: string;
  checkedAt: string;
  validFrom: string;
  /** Our review deadline, not a guarantee that the source will remain unchanged. */
  validThrough: string;
  accessNote?: string;
  weekly: Partial<Record<Weekday, OpeningInterval[] | null>>;
  /** Overrides a whole local calendar day. [] means closed; null means unknown. */
  exceptions?: Record<string, OpeningInterval[] | null>;
};
export type OpeningStatus = {
  status: 'open' | 'closed' | 'unknown'; label: string; sourceUrl?: string;
  checkedAt?: string; accessNote?: string; reason?: 'missing' | 'stale' | 'outside-period' | 'unknown-day' | 'invalid';
};
const allDay = [{open: '00:00', close: '24:00'}];
const weekdayHours = [{open: '09:00', close: '23:00'}];
const weekendHours = [{open: '09:45', close: '21:00'}];

/** Only directly verified current schedules. Other sites retain their official hours link.
 * The 30-day deadline deliberately turns these snapshots back to unknown until rechecked.
 * UCL's other library hours are dynamic widgets: no times are inferred from old articles.
 */
export const placeOpeningHours: Record<string, OpeningSchedule> = {
  'student-centre': {
    timeZone: 'Europe/London', sourceUrl: 'https://studentsunionucl.org/whats-on/venue/student-centre',
    checkedAt: '2026-10-12', validFrom: '2026-10-12', validThrough: '2026-11-11',
    accessNote: 'UCL ID required. Some study areas need booking; check UCL service notices before travelling.',
    weekly: {mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay},
  },
  'senate-house': {
    timeZone: 'Europe/London', sourceUrl: 'https://www.london.ac.uk/about/services/senate-house-library/opening-hours',
    checkedAt: '2026-10-12', validFrom: '2026-10-12', validThrough: '2026-11-11',
    accessNote: 'Register before visiting. Evening and Sunday self-service access is for library members; some services are unavailable.',
    weekly: {mon: weekdayHours, tue: weekdayHours, wed: weekdayHours, thu: weekdayHours, fri: weekdayHours, sat: weekendHours, sun: weekendHours},
  },
};
export const placeHoursLinks: Record<string, string> = {
  'student-centre': 'https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/student-centre',
  'main-library': 'https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/main-library',
  'science-library': 'https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/science-library',
  'ssees-library': 'https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/ssees-library',
  'ioe-library': 'https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/ioe-library',
};
const dayKeys: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function localClock(now: Date | number, timeZone: string) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(date).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const nominal = new Date(`${day}T12:00:00Z`);
  const previous = new Date(nominal.getTime() - 86400000);
  return {day, previousDay: previous.toISOString().slice(0,10), weekday: dayKeys[nominal.getUTCDay()], previousWeekday: dayKeys[previous.getUTCDay()], minute: Number(parts.hour) * 60 + Number(parts.minute)};
}
function minutes(time: string, closing = false): number | null {
  if (closing && time === '24:00') return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute;
}
function intervalsValid(value: OpeningInterval[] | null | undefined): value is OpeningInterval[] {
  return Array.isArray(value) && value.every(interval => {
    const start = minutes(interval.open), end = minutes(interval.close, true);
    return start !== null && end !== null && start !== end;
  });
}
export function evaluateOpeningHours(schedule: OpeningSchedule | undefined, now: Date | number = Date.now()): OpeningStatus {
  if (!schedule) return {status:'unknown', label:'Opening hours not verified', reason:'missing'};
  const metadata = {sourceUrl:schedule.sourceUrl, checkedAt:schedule.checkedAt, accessNote:schedule.accessNote};
  const unknown = (reason: OpeningStatus['reason'], label='Check current opening hours'): OpeningStatus => ({...metadata,status:'unknown',label,reason});
  const clock = localClock(now, schedule.timeZone);
  if (!clock) return unknown('invalid');
  if (clock.day > schedule.validThrough) return unknown('stale', 'Hours need rechecking');
  if (clock.day < schedule.validFrom) return unknown('outside-period');
  const override = Object.prototype.hasOwnProperty.call(schedule.exceptions || {}, clock.day);
  const today = override ? schedule.exceptions![clock.day] : schedule.weekly[clock.weekday];
  if (!intervalsValid(today)) return unknown(today == null ? 'unknown-day' : 'invalid');
  const currentOpen = today.some(interval => {
    const start = minutes(interval.open)!, end = minutes(interval.close, true)!;
    return clock.minute >= start && (end < start || clock.minute < end);
  });
  // A closure/date exception overrides overnight spill from the previous day.
  let overnight = false;
  if (!override && clock.previousDay >= schedule.validFrom) {
    const yesterday = Object.prototype.hasOwnProperty.call(schedule.exceptions || {}, clock.previousDay) ? schedule.exceptions![clock.previousDay] : schedule.weekly[clock.previousWeekday];
    if (intervalsValid(yesterday)) overnight = yesterday.some(interval => {
      const start = minutes(interval.open)!, end = minutes(interval.close, true)!;
      return end < start && clock.minute < end;
    });
    // Without yesterday's schedule we cannot rule out overnight opening.
    else if (!currentOpen) return unknown(yesterday == null ? 'unknown-day' : 'invalid');
  }
  const open = currentOpen || overnight;
  return {...metadata, status:open?'open':'closed', label:open?'Open now · published hours':'Closed now · published hours'};
}

export function openingStatus(place: Pick<Place,'id'|'sourceUrl'>, now: Date | number = Date.now()): OpeningStatus {
  const result = evaluateOpeningHours(placeOpeningHours[place.id], now);
  return {...result, sourceUrl: result.sourceUrl || placeHoursLinks[place.id] || place.sourceUrl};
}

/** True only when a fresh published schedule includes some time after 21:00 today. */
export function isOpenLate(place: Pick<Place,'id'>, now: Date | number = Date.now()): boolean {
  const schedule = placeOpeningHours[place.id];
  if (!schedule) return false;
  const clock = localClock(now, schedule.timeZone);
  if (!clock || clock.day < schedule.validFrom || clock.day > schedule.validThrough) return false;
  const intervals = Object.prototype.hasOwnProperty.call(schedule.exceptions || {}, clock.day) ? schedule.exceptions![clock.day] : schedule.weekly[clock.weekday];
  return intervalsValid(intervals) && intervals.some(interval => {
    const start = minutes(interval.open)!, end = minutes(interval.close, true)!;
    return end < start || end > 21 * 60;
  });
}
