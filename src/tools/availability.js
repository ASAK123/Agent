// Pure slot-finding and ranking logic for "when am I free?" requests.
// Kept free of Google API calls so it can be exercised with plain busy-interval data.

const MINUTE = 60 * 1000;
const MAX_SEARCH_DAYS = 31;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const partsFormatters = new Map();

function zonedParts(date, timeZone) {
  if (!partsFormatters.has(timeZone)) {
    partsFormatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      })
    );
  }
  const parts = {};
  for (const p of partsFormatters.get(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10);
  }
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { ...parts, weekday };
}

function offsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Wall-clock time in `timeZone` -> UTC epoch ms (handles DST transitions).
function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off = offsetMs(new Date(guess), timeZone);
  let result = guess - off;
  const off2 = offsetMs(new Date(result), timeZone);
  if (off2 !== off) result = guess - off2;
  return result;
}

const pad = (n) => String(n).padStart(2, '0');

// e.g. "2026-10-13T09:00:00+03:00" - local wall-clock with explicit offset.
function toLocalIso(ms, timeZone) {
  const date = new Date(ms);
  const p = zonedParts(date, timeZone);
  const offMin = Math.round(offsetMs(date, timeZone) / MINUTE);
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function parseHHMM(value, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return fallback;
  return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const i of sorted) {
    const last = merged[merged.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else merged.push({ ...i });
  }
  return merged;
}

const TIME_OF_DAY_RANGES = {
  morning: [0, 12],
  afternoon: [12, 17],
  evening: [17, 24],
};

/**
 * Finds free slots of `durationMinutes` within working hours and returns them ranked best-first.
 *
 * busy: [{ start, end }] as epoch ms (or anything Date can parse).
 */
function suggestSlots({
  busy = [],
  durationMinutes,
  windowStart,
  windowEnd,
  timeZone,
  workdayStart = '09:00',
  workdayEnd = '18:00',
  workDays = [0, 1, 2, 3, 4],
  preferredTimeOfDay,
  bufferMinutes = 15,
  maxSuggestions = 5,
  maxPerDay = 2,
  now = Date.now(),
}) {
  const duration = durationMinutes * MINUTE;
  const step = (durationMinutes < 30 ? 15 : 30) * MINUTE;
  const buffer = bufferMinutes * MINUTE;
  const startOfWork = parseHHMM(workdayStart, { hour: 9, minute: 0 });
  const endOfWork = parseHHMM(workdayEnd, { hour: 18, minute: 0 });

  const from = Math.max(new Date(windowStart).getTime(), now);
  const to = new Date(windowEnd).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const busyMs = mergeIntervals(
    busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
  );

  const dayKeyOf = (ms) => {
    const p = zonedParts(new Date(ms), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  const todayKey = dayKeyOf(now);
  const firstDayKey = dayKeyOf(from);
  const candidates = [];

  const lastDayKey = firstDayKey + MAX_SEARCH_DAYS * 24 * 60 * MINUTE;
  for (let dayKey = firstDayKey; dayKey <= lastDayKey; dayKey += 24 * 60 * MINUTE) {
    const d = new Date(dayKey);
    const [y, mo, da] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const dayStart = zonedToUtc(y, mo, da, startOfWork.hour, startOfWork.minute, timeZone);
    const dayEnd = zonedToUtc(y, mo, da, endOfWork.hour, endOfWork.minute, timeZone);
    if (zonedToUtc(y, mo, da, 0, 0, timeZone) >= to) break;
    if (!workDays.includes(d.getUTCDay())) continue;

    const dayBusy = busyMs.filter((b) => b.start < dayEnd && b.end > dayStart);
    const busyMinutes = dayBusy.reduce(
      (sum, b) => sum + (Math.min(b.end, dayEnd) - Math.max(b.start, dayStart)) / MINUTE,
      0
    );
    const daysAhead = Math.round((dayKey - todayKey) / (24 * 60 * MINUTE));
    const lunchStart = zonedToUtc(y, mo, da, 12, 0, timeZone);
    const lunchEnd = zonedToUtc(y, mo, da, 13, 0, timeZone);

    let t = dayStart;
    if (from > t) t = dayStart + Math.ceil((from - dayStart) / step) * step;

    for (; t + duration <= Math.min(dayEnd, to); t += step) {
      const end = t + duration;
      if (dayBusy.some((b) => b.start < end && b.end > t)) continue;

      const prevBusyEnd = Math.max(...dayBusy.filter((b) => b.end <= t).map((b) => b.end), -Infinity);
      const nextBusyStart = Math.min(...dayBusy.filter((b) => b.start >= end).map((b) => b.start), Infinity);
      const startHour = zonedParts(new Date(t), timeZone).hour;

      let score = 100;
      const reasons = [];

      if (t - prevBusyEnd < buffer || nextBusyStart - end < buffer) {
        score -= 15;
        reasons.push('right next to another meeting');
      } else if (dayBusy.length) {
        reasons.push('breathing room around other meetings');
      }

      if (t < lunchEnd && end > lunchStart) {
        score -= 20;
        reasons.push('overlaps lunch');
      }

      if (preferredTimeOfDay && TIME_OF_DAY_RANGES[preferredTimeOfDay]) {
        const [lo, hi] = TIME_OF_DAY_RANGES[preferredTimeOfDay];
        if (startHour >= lo && startHour < hi) {
          score += 25;
          reasons.push(`in your preferred ${preferredTimeOfDay}`);
        } else {
          score -= 10;
        }
      }

      score -= Math.round(busyMinutes / 15);
      if (busyMinutes === 0) reasons.push('day is otherwise free');
      else if (busyMinutes >= 4 * 60) reasons.push('busy day');

      score -= daysAhead * 3;
      if (daysAhead === 0) reasons.push('today');

      if (t === dayStart || end === dayEnd) score -= 5;

      candidates.push({ start: t, end, score, reasons, dayKey });
    }
  }

  // Greedy pick, best score first. Spread across days before doubling up on one, so the
  // list offers real alternatives instead of back-to-back slots; a short window (e.g. a
  // single day) falls through to the later passes and still fills up.
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const picked = [];
  const passes = [
    { perDay: 1, spacing: 0 },
    { perDay: maxPerDay, spacing: 2 * 60 * MINUTE },
    { perDay: Infinity, spacing: 60 * MINUTE },
    { perDay: Infinity, spacing: 0 },
  ];
  for (const { perDay, spacing } of passes) {
    for (const c of candidates) {
      if (picked.length >= maxSuggestions) break;
      const sameDay = picked.filter((p) => p.dayKey === c.dayKey);
      if (picked.includes(c) || sameDay.length >= perDay) continue;
      if (sameDay.some((p) => p.start < c.end + spacing && p.end + spacing > c.start)) continue;
      if (picked.some((p) => p.start < c.end && p.end > c.start)) continue;
      picked.push(c);
    }
  }
  picked.sort((a, b) => b.score - a.score || a.start - b.start);

  return picked.map((c, i) => {
    const s = zonedParts(new Date(c.start), timeZone);
    const e = zonedParts(new Date(c.end), timeZone);
    return {
      rank: i + 1,
      start: toLocalIso(c.start, timeZone),
      end: toLocalIso(c.end, timeZone),
      label: `${DAY_NAMES[s.weekday]} ${pad(s.day)}/${pad(s.month)} ${pad(s.hour)}:${pad(s.minute)}-${pad(e.hour)}:${pad(e.minute)}`,
      score: c.score,
      reasons: c.reasons,
    };
  });
}

module.exports = { suggestSlots, zonedToUtc, toLocalIso };
