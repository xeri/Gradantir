/**
 * Market sessions — purely cosmetic terminal chrome, never gates data entry.
 * Mon–Fri: PRE 08:00–09:00, OPEN 09:00–15:00, AFTER HOURS 15:00–16:00,
 * otherwise (and all weekend) CLOSED.
 */

export type MarketPhase = "pre" | "open" | "post" | "closed";

export interface SessionInfo {
  phase: MarketPhase;
  label: string;
  msToNext: number;
  nextLabel: string;
}

const LABELS: Record<MarketPhase, string> = {
  pre: "PRE-MARKET",
  open: "MARKET OPEN",
  post: "AFTER HOURS",
  closed: "MARKET CLOSED",
};

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const at = (base: Date, h: number): Date =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, 0, 0, 0);

const isWeekday = (d: Date): boolean => d.getDay() >= 1 && d.getDay() <= 5;

export function sessionInfo(now: Date = new Date()): SessionInfo {
  const mins = now.getHours() * 60 + now.getMinutes();
  const weekday = isWeekday(now);
  let phase: MarketPhase = "closed";
  if (weekday) {
    if (mins >= 8 * 60 && mins < 9 * 60) phase = "pre";
    else if (mins >= 9 * 60 && mins < 15 * 60) phase = "open";
    else if (mins >= 15 * 60 && mins < 16 * 60) phase = "post";
  }

  let next: Date;
  let nextLabel: string;
  if (phase === "pre") {
    next = at(now, 9);
    nextLabel = "OPENS 09:00";
  } else if (phase === "open") {
    next = at(now, 15);
    nextLabel = "CLOSES 15:00";
  } else if (phase === "post") {
    next = at(now, 16);
    nextLabel = "ENDS 16:00";
  } else if (weekday && mins < 8 * 60) {
    next = at(now, 8);
    nextLabel = "OPENS 08:00";
  } else {
    next = at(now, 8);
    do next = new Date(next.getTime() + 24 * 3600000);
    while (!isWeekday(next));
    nextLabel = `OPENS ${DAYS[next.getDay()]} 08:00`;
  }

  return { phase, label: LABELS[phase], msToNext: next.getTime() - now.getTime(), nextLabel };
}

export function fmtCountdown(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "<1M";
  if (mins < 60) return `${mins}M`;
  return `${Math.floor(mins / 60)}H ${mins % 60}M`;
}
