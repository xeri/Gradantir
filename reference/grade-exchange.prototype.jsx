import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import {
  TrendingUp, TrendingDown, Activity, Target, Sparkles, Plus, X, Trash2, Pencil,
  ArrowUpRight, ArrowDownRight, Minus, LayoutGrid, Radar as RadarIcon, Table2,
  LineChart as LineIcon, ChevronRight, RefreshCw, GraduationCap,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   GRADE EXCHANGE — track school subjects like a stock portfolio.
   Design: "graph-paper trading desk" — ink navy on faint grid paper,
   marker-set subject colors, IBM Plex Mono for every number, and a live
   ticker tape as the signature element.
──────────────────────────────────────────────────────────────────────────── */

const C = {
  paper: "#F6F7F1",
  ink: "#1B2436",
  soft: "#5F6879",
  faint: "#8B93A5",
  card: "#FFFFFF",
  line: "#E3E6DA",
  gain: "#0E8A5F",
  loss: "#C93A2E",
  accent: "#2C4BDD",
  amber: "#8A6D0B",
  amberBg: "#FCF6E3",
};

const FONT = {
  body: "'Archivo', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};

const PALETTE = ["#2C4BDD", "#DD5A2C", "#0E8A5F", "#8A36C9", "#B8930C", "#0E7C9C", "#C42B6B", "#66701F"];
const TYPES = ["Exam", "Test", "Assignment", "Quiz"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STORE_KEY = "grade-exchange:v1";

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
.gx-tape { animation: gx-scroll 36s linear infinite; width: max-content; }
@keyframes gx-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.gx-tape:hover { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) { .gx-tape { animation: none; } }
.gx-focus:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.gx-fade { animation: gx-fade .25s ease; }
@keyframes gx-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .gx-fade { animation: none; } }
input[type=number]::-webkit-inner-spin-button { opacity: 1; }
`;

/* ── small utilities ─────────────────────────────────────────────────────── */

const uid = () => "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const stdev = (arr) => {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1));
};
const pDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const todayStr = () => iso(new Date());
const shortDate = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const shortDateY = (s) => { const d = pDate(s); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };

function periodInfo(dateStr, mode) {
  const dt = pDate(dateStr);
  const y = dt.getFullYear();
  const m = dt.getMonth();
  switch (mode) {
    case "month": return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${String(y).slice(2)}` };
    case "term": { const t = Math.floor(m / 3) + 1; return { key: `${y}-T${t}`, label: `T${t} ${y}` }; }
    case "semester": { const s = m < 6 ? 1 : 2; return { key: `${y}-S${s}`, label: `S${s} ${y}` }; }
    case "year": return { key: `${y}`, label: `${y}` };
    default: return { key: dateStr, label: dateStr };
  }
}

const currentTermKey = () => periodInfo(todayStr(), "term");
function prevTermKey() {
  const now = new Date();
  const t = Math.floor(now.getMonth() / 3) + 1;
  return t === 1 ? { key: `${now.getFullYear() - 1}-T4`, label: `T4 ${now.getFullYear() - 1}` }
                 : { key: `${now.getFullYear()}-T${t - 1}`, label: `T${t - 1} ${now.getFullYear()}` };
}

function linreg(pts) {
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const den = n * sxx - sx * sx;
  const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  let se = 0;
  for (const p of pts) { const r = p.y - (slope * p.x + intercept); se += r * r; }
  const sigma = Math.sqrt(se / Math.max(1, n - 2));
  return { slope, intercept, sigma };
}

/* Regression over a subject's recent results → estimate for the next one. */
function subjectForecast(sorted) {
  if (sorted.length < 3) return null;
  const recent = sorted.slice(-10);
  const pts = recent.map((e, i) => ({ x: i, y: e.score }));
  const { slope, intercept, sigma } = linreg(pts);
  const pred = clamp(round1(slope * recent.length + intercept), 0, 100);
  return { pred, sigma: round1(sigma), slope: round1(slope * 10) / 10 };
}

const volatilityLabel = (sd) => (sd < 3.5 ? "Steady" : sd < 7 ? "Variable" : "Volatile");

/* ── grouping for charts ─────────────────────────────────────────────────── */

function buildGroupedRows(entries, mode, typeFilter) {
  const filtered = typeFilter === "all" ? entries : entries.filter((e) => e.type === typeFilter);
  const map = new Map();
  for (const e of filtered) {
    const { key, label } = periodInfo(e.date, mode);
    if (!map.has(key)) map.set(key, { key, label, sums: {} });
    const r = map.get(key);
    (r.sums[e.subjectId] ||= []).push(e.score);
  }
  return [...map.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((r) => {
      const o = { key: r.key, label: r.label };
      for (const [sid, arr] of Object.entries(r.sums)) o[sid] = round1(avg(arr));
      return o;
    });
}

function buildAssessmentRows(entries, typeFilter) {
  const filtered = typeFilter === "all" ? entries : entries.filter((e) => e.type === typeFilter);
  const map = new Map();
  for (const e of filtered) {
    const t = pDate(e.date).getTime();
    if (!map.has(t)) map.set(t, { t, label: shortDate(t) });
    const row = map.get(t);
    row[e.subjectId] = row[e.subjectId] != null ? round1((row[e.subjectId] + e.score) / 2) : e.score;
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function addMovingAvg(rows, subjectIds, win = 3) {
  for (const sid of subjectIds) {
    const buf = [];
    for (const row of rows) {
      const v = row[sid];
      if (v == null) continue;
      buf.push(v);
      if (buf.length > win) buf.shift();
      row[sid + "_ma"] = round1(avg(buf));
    }
  }
}

/* Extends rows with a dashed "_fc" series ending at a projected next point. */
function addForecast(rows, subjectIds, mode) {
  if (rows.length < 2) return rows;
  const out = rows.map((r) => ({ ...r }));
  if (mode === "assessment") {
    const ts = out.map((r) => r.t);
    const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14 * 864e5;
    const tNext = ts[ts.length - 1] + Math.max(gap, 3 * 864e5);
    const nextRow = { t: tNext, label: "est." };
    let any = false;
    for (const sid of subjectIds) {
      const pts = [];
      out.forEach((r) => { if (r[sid] != null) pts.push({ x: (r.t - ts[0]) / 864e5, y: r[sid], row: r }); });
      if (pts.length < 3) continue;
      const { slope, intercept } = linreg(pts.slice(-10));
      const pred = clamp(round1(slope * ((tNext - ts[0]) / 864e5) + intercept), 0, 100);
      pts[pts.length - 1].row[sid + "_fc"] = pts[pts.length - 1].y;
      nextRow[sid + "_fc"] = pred;
      any = true;
    }
    return any ? [...out, nextRow] : out;
  }
  const nextRow = { key: "__next", label: "Next (est.)" };
  let any = false;
  for (const sid of subjectIds) {
    const seq = [];
    out.forEach((r) => { if (r[sid] != null) seq.push({ v: r[sid], row: r }); });
    if (seq.length < 3) continue;
    const pts = seq.map((s, i) => ({ x: i, y: s.v })).slice(-10);
    const { slope, intercept } = linreg(pts.map((p, i) => ({ x: i, y: p.y })));
    const pred = clamp(round1(slope * pts.length + intercept), 0, 100);
    seq[seq.length - 1].row[sid + "_fc"] = seq[seq.length - 1].v;
    nextRow[sid + "_fc"] = pred;
    any = true;
  }
  return any ? [...out, nextRow] : out;
}

/* ── sample data ─────────────────────────────────────────────────────────── */

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function makeSample() {
  const defs = [
    { id: "s-math", name: "Mathematics", ticker: "MATH", color: PALETTE[0], target: 85, start: 71, slope: 0.55, vol: 4 },
    { id: "s-eng", name: "English", ticker: "ENG", color: PALETTE[1], target: 85, start: 80, slope: 0.12, vol: 3 },
    { id: "s-phys", name: "Physics", ticker: "PHYS", color: PALETTE[3], target: 80, start: 76, slope: -0.35, vol: 5 },
    { id: "s-hist", name: "History", ticker: "HIST", color: PALETTE[5], target: null, start: 74, slope: 0.22, vol: 8.5 },
    { id: "s-bio", name: "Biology", ticker: "BIO", color: PALETTE[2], target: 90, start: 83, slope: 0.16, vol: 3 },
  ];
  const rand = seeded(20260720);
  const end = new Date(2026, 6, 18);
  const entries = [];
  const subjects = defs.map(({ start, slope, vol, ...sub }) => {
    let dt = new Date(2025, 1, 8 + Math.floor(rand() * 10));
    let i = 0;
    while (dt <= end) {
      const r = rand();
      const type = r < 0.2 ? "Quiz" : r < 0.55 ? "Assignment" : r < 0.85 ? "Test" : "Exam";
      let score = start + slope * i + (rand() - 0.5) * 2 * vol;
      if (type === "Exam") score -= 1.5;
      entries.push({ id: uid(), subjectId: sub.id, date: iso(dt), type, score: clamp(round1(score), 0, 100), title: "" });
      i += 1;
      dt = new Date(dt.getTime() + (17 + rand() * 17) * 864e5);
      if (dt.getMonth() === 11) dt = new Date(dt.getFullYear() + 1, 1, 3 + Math.floor(rand() * 7));
      else if (dt.getMonth() === 0) dt = new Date(dt.getFullYear(), 1, 3 + Math.floor(rand() * 7));
    }
    const last = entries[entries.length - 1];
    if (last && last.subjectId === sub.id && pDate(last.date) < new Date(2026, 6, 2)) {
      const type = rand() < 0.5 ? "Test" : "Assignment";
      const score = start + slope * i + (rand() - 0.5) * 2 * vol;
      entries.push({ id: uid(), subjectId: sub.id, date: iso(new Date(2026, 6, 6 + Math.floor(rand() * 9))), type, score: clamp(round1(score), 0, 100), title: "" });
    }
    return sub;
  });
  return { subjects, entries, sample: true };
}

/* ── shared stats ────────────────────────────────────────────────────────── */

function computeStats(subjects, entries) {
  const cur = currentTermKey();
  const prev = prevTermKey();
  return subjects.map((sub) => {
    const es = entries.filter((e) => e.subjectId === sub.id).sort((a, b) => (a.date < b.date ? -1 : 1));
    const scores = es.map((e) => e.score);
    const latest = es[es.length - 1] || null;
    const before = es[es.length - 2] || null;
    const tickDelta = latest && before ? round1(latest.score - before.score) : null;
    const curScores = es.filter((e) => periodInfo(e.date, "term").key === cur.key).map((e) => e.score);
    const prevScores = es.filter((e) => periodInfo(e.date, "term").key === prev.key).map((e) => e.score);
    const curAvg = curScores.length ? round1(avg(curScores)) : null;
    const prevAvg = prevScores.length ? round1(avg(prevScores)) : null;
    const periodDelta = curAvg != null && prevAvg != null ? round1(curAvg - prevAvg) : null;
    const sd = round1(stdev(scores.slice(-10)));
    return {
      sub, entries: es, scores, latest, tickDelta,
      overallAvg: scores.length ? round1(avg(scores)) : null,
      curAvg, prevAvg, periodDelta, curCount: curScores.length,
      sd, volatility: volatilityLabel(sd),
      forecast: subjectForecast(es),
      curLabel: cur.label, prevLabel: prev.label,
    };
  });
}

/* ── atoms ───────────────────────────────────────────────────────────────── */

function Delta({ v, size = "sm", nullText = "—" }) {
  if (v == null) return <span className="text-xs" style={{ color: C.faint, fontFamily: FONT.mono }}>{nullText}</span>;
  const up = v > 0.05, down = v < -0.05;
  const color = up ? C.gain : down ? C.loss : C.faint;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${size === "lg" ? "text-sm" : "text-xs"}`}
      style={{ color, fontFamily: FONT.mono }}>
      <Icon size={size === "lg" ? 15 : 13} strokeWidth={2.5} />
      {up ? "+" : ""}{v.toFixed(1)}
    </span>
  );
}

function Sparkline({ scores, color, w = 132, h = 38 }) {
  if (!scores || scores.length < 2) {
    return <div className="text-xs" style={{ color: C.faint, fontFamily: FONT.mono }}>needs 2+ results</div>;
  }
  const vals = scores.slice(-14);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => [
    2 + (i / (vals.length - 1)) * (w - 6),
    h - 4 - ((v - min) / span) * (h - 10),
  ]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `M ${pts[0][0]},${h - 1} L ${line.replace(/ /g, " L ")} L ${pts[pts.length - 1][0]},${h - 1} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: h }} aria-hidden="true">
      <path d={area} fill={color} opacity="0.1" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.8" fill={color} />
    </svg>
  );
}

function TypeBadge({ type }) {
  const strong = type === "Exam";
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
      style={{
        fontFamily: FONT.mono,
        background: strong ? C.ink : "transparent",
        color: strong ? "#fff" : C.soft,
        border: strong ? "1px solid " + C.ink : "1px solid " + C.line,
      }}>
      {type}
    </span>
  );
}

function TickerTape({ stats, index }) {
  const items = [
    { k: "GX INDEX", v: index.value, d: index.delta },
    ...stats.filter((s) => s.latest).map((s) => ({ k: s.sub.ticker, v: s.latest.score, d: s.tickDelta })),
  ];
  const Chunk = ({ ariaHidden }) => (
    <div className="flex items-center" aria-hidden={ariaHidden}>
      {items.map((it, i) => {
        const up = (it.d ?? 0) > 0.05, down = (it.d ?? 0) < -0.05;
        return (
          <span key={i} className="flex items-center gap-1.5 px-5 text-xs" style={{ fontFamily: FONT.mono }}>
            <span className="font-bold text-white/95 tracking-wider">{it.k}</span>
            <span className="text-white/75">{it.v != null ? Number(it.v).toFixed(1) : "—"}</span>
            {it.d != null && (
              <span style={{ color: up ? "#5EE3A4" : down ? "#FF9084" : "#8B93A5" }}>
                {up ? "▲" : down ? "▼" : "•"} {Math.abs(it.d).toFixed(1)}
              </span>
            )}
            <span className="text-white/20 pl-4">/</span>
          </span>
        );
      })}
    </div>
  );
  return (
    <div className="overflow-hidden" style={{ background: C.ink }} role="marquee" aria-label="Latest results ticker">
      <div className="gx-tape flex py-1.5">
        <Chunk />
        <Chunk ariaHidden />
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label, subMap, isTime }) {
  if (!active || !payload || !payload.length) return null;
  const rows = [];
  const seen = new Set();
  for (const p of payload) {
    if (p.value == null || seen.has(p.dataKey)) continue;
    seen.add(p.dataKey);
    const base = String(p.dataKey).replace(/_(ma|fc)$/, "");
    const kind = String(p.dataKey).endsWith("_ma") ? "avg" : String(p.dataKey).endsWith("_fc") ? "est." : "";
    const sub = subMap[base];
    if (!sub) continue;
    if (!kind && payload.some((q) => q.dataKey === base + "_ma" && q.value != null)) continue;
    rows.push({ name: sub.ticker + (kind ? " · " + kind : ""), color: sub.color, v: p.value });
  }
  rows.sort((a, b) => b.v - a.v);
  return (
    <div className="rounded-xl border px-3 py-2 shadow-lg" style={{ background: C.card, borderColor: C.line }}>
      <div className="text-[11px] font-semibold mb-1" style={{ color: C.soft, fontFamily: FONT.mono }}>
        {isTime ? shortDate(label) : label}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />
            <span className="font-semibold" style={{ fontFamily: FONT.mono }}>{r.name}</span>
          </span>
          <span className="font-bold" style={{ fontFamily: FONT.mono }}>{r.v.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

/* ── form + layout primitives ────────────────────────────────────────────── */

const inputCls = "gx-focus w-full rounded-xl border px-3 py-2 text-sm bg-white";
const inputStyle = { borderColor: C.line, color: C.ink, fontFamily: FONT.body };

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: C.soft }}>{label}</span>
      {children}
    </label>
  );
}

function Sel({ value, onChange, options, ariaLabel }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}
      className="gx-focus rounded-xl border px-3 py-2 text-sm bg-white font-semibold cursor-pointer"
      style={{ borderColor: C.line, color: C.ink }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function TogglePill({ on, onClick, children }) {
  return (
    <button onClick={onClick} className="gx-focus px-3 py-2 rounded-xl text-sm font-semibold border transition-colors"
      style={{
        background: on ? C.ink : "#fff",
        color: on ? "#fff" : C.soft,
        borderColor: on ? C.ink : C.line,
      }}>
      {children}
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" style={{ background: "rgba(27,36,54,0.45)" }} onClick={onClose} />
      <div className={`gx-fade relative w-full ${wide ? "max-w-lg" : "max-w-md"} rounded-2xl border shadow-2xl p-5`}
        style={{ background: C.card, borderColor: C.line }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold tracking-tight" style={{ fontFamily: FONT.body }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="gx-focus p-1.5 rounded-lg hover:bg-black/5" style={{ color: C.soft }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── modals ──────────────────────────────────────────────────────────────── */

function SubjectModal({ subjects, onSave, onClose }) {
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [tickerTouched, setTickerTouched] = useState(false);
  const used = new Set(subjects.map((s) => s.color));
  const [color, setColor] = useState(PALETTE.find((c) => !used.has(c)) || PALETTE[subjects.length % PALETTE.length]);
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");

  const handleName = (v) => {
    setName(v);
    if (!tickerTouched) setTicker(v.replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase());
  };
  const save = () => {
    if (!name.trim()) { setErr("Give the subject a name."); return; }
    const tk = (ticker.trim() || name.slice(0, 4)).toUpperCase();
    if (subjects.some((s) => s.ticker === tk)) { setErr(`Ticker ${tk} is taken — pick another.`); return; }
    onSave({
      id: uid(), name: name.trim(), ticker: tk, color,
      target: target === "" ? null : clamp(Number(target), 0, 100),
    });
  };

  return (
    <Modal title="List a new subject" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Subject name">
          <input className={inputCls} style={inputStyle} value={name} onChange={(e) => handleName(e.target.value)}
            placeholder="e.g. Chemistry" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ticker">
            <input className={inputCls} style={{ ...inputStyle, fontFamily: FONT.mono }} value={ticker} maxLength={5}
              onChange={(e) => { setTickerTouched(true); setTicker(e.target.value.toUpperCase()); }} placeholder="CHEM" />
          </Field>
          <Field label="Target % (optional)">
            <input className={inputCls} style={{ ...inputStyle, fontFamily: FONT.mono }} type="number" min="0" max="100"
              value={target} onChange={(e) => setTarget(e.target.value)} placeholder="85" />
          </Field>
        </div>
        <Field label="Line colour">
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`}
                className="gx-focus w-8 h-8 rounded-full border-2 transition-transform"
                style={{ background: c, borderColor: color === c ? C.ink : "transparent", transform: color === c ? "scale(1.12)" : "none" }} />
            ))}
          </div>
        </Field>
        {err && <p className="text-xs font-semibold" style={{ color: C.loss }}>{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="gx-focus px-4 py-2 rounded-xl text-sm font-semibold border" style={{ borderColor: C.line, color: C.soft }}>Cancel</button>
          <button onClick={save} className="gx-focus px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: C.ink }}>Add subject</button>
        </div>
      </div>
    </Modal>
  );
}

function GradeModal({ subjects, entry, defaultSubjectId, onSave, onClose }) {
  const [subjectId, setSubjectId] = useState(entry?.subjectId || defaultSubjectId || subjects[0]?.id || "");
  const [type, setType] = useState(entry?.type || "Test");
  const [score, setScore] = useState(entry ? String(entry.score) : "");
  const [date, setDate] = useState(entry?.date || todayStr());
  const [title, setTitle] = useState(entry?.title || "");
  const [err, setErr] = useState("");

  const save = () => {
    const n = Number(score);
    if (score === "" || Number.isNaN(n)) { setErr("Enter the result as a number."); return; }
    if (n < 0 || n > 100) { setErr("Results run from 0 to 100."); return; }
    if (!subjectId) { setErr("Pick a subject."); return; }
    if (!date) { setErr("Pick a date."); return; }
    onSave({ id: entry?.id || uid(), subjectId, type, score: round1(n), date, title: title.trim() });
  };

  return (
    <Modal title={entry ? "Edit result" : "Log a result"} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Subject">
            <select className={inputCls + " cursor-pointer font-semibold"} style={inputStyle} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className={inputCls + " cursor-pointer font-semibold"} style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Score (%)">
            <input className={inputCls} style={{ ...inputStyle, fontFamily: FONT.mono }} type="number" min="0" max="100" step="0.5"
              value={score} onChange={(e) => setScore(e.target.value)} placeholder="82.5" autoFocus />
          </Field>
          <Field label="Date">
            <input className={inputCls} style={{ ...inputStyle, fontFamily: FONT.mono }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Label (optional)">
          <input className={inputCls} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mid-year exam, Essay 2" />
        </Field>
        {err && <p className="text-xs font-semibold" style={{ color: C.loss }}>{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="gx-focus px-4 py-2 rounded-xl text-sm font-semibold border" style={{ borderColor: C.line, color: C.soft }}>Cancel</button>
          <button onClick={save} className="gx-focus px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: C.ink }}>
            {entry ? "Save changes" : "Log result"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── subject spotlight drawer ────────────────────────────────────────────── */

function Drawer({ stat, onClose, onSetTarget, onDeleteSubject, onAddGrade, onEditEntry }) {
  const { sub, entries, scores, latest, curAvg, periodDelta, sd, volatility, forecast, curLabel } = stat;
  const [wish, setWish] = useState(sub.target ?? 85);
  const [targetDraft, setTargetDraft] = useState(sub.target ?? "");
  const [confirmDel, setConfirmDel] = useState(false);

  const curEntries = entries.filter((e) => periodInfo(e.date, "term").key === currentTermKey().key);
  const n = curEntries.length;
  const sum = curEntries.reduce((a, e) => a + e.score, 0);
  const needed = round1(Number(wish) * (n + 1) - sum);

  let whatIf;
  if (needed > 100) whatIf = { text: "over 100 — out of reach in one result. Close the gap across the next few instead.", color: C.loss };
  else if (needed <= 0) whatIf = { text: "already locked in — any score keeps you there.", color: C.gain };
  else whatIf = { text: `you need ${needed.toFixed(1)}% on your next result.`, color: C.ink };

  const trendWord = forecast ? (forecast.slope > 0.15 ? "climbing" : forecast.slope < -0.15 ? "sliding" : "holding flat") : null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`${sub.name} details`}>
      <div className="absolute inset-0" style={{ background: "rgba(27,36,54,0.45)" }} onClick={onClose} />
      <aside className="gx-fade absolute inset-y-0 right-0 w-full sm:max-w-md overflow-y-auto shadow-2xl"
        style={{ background: C.paper }}>
        <div className="h-1.5" style={{ background: sub.color }} />
        <div className="p-5 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: sub.color, fontFamily: FONT.mono }}>{sub.ticker}</div>
              <h2 className="text-2xl font-black tracking-tight">{sub.name}</h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="gx-focus p-1.5 rounded-lg hover:bg-black/5" style={{ color: C.soft }}><X size={20} /></button>
          </div>

          <div className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
            <Sparkline scores={scores} color={sub.color} w={340} h={64} />
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                { l: "Latest", v: latest ? latest.score.toFixed(1) : "—" },
                { l: `${curLabel} avg`, v: curAvg != null ? curAvg.toFixed(1) : "—" },
                { l: "Spread", v: `±${sd.toFixed(1)}` },
              ].map((x, i) => (
                <div key={i}>
                  <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>{x.l}</div>
                  <div className="text-lg font-bold" style={{ fontFamily: FONT.mono }}>{x.v}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: C.soft }}>
              <span className="flex items-center gap-1"><Activity size={13} /> {volatility}</span>
              <span>vs last term: <Delta v={periodDelta} /></span>
            </div>
          </div>

          {forecast && (
            <div className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: C.soft }}>
                <Sparkles size={13} /> Next result estimate
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold" style={{ fontFamily: FONT.mono }}>{forecast.pred.toFixed(1)}%</span>
                <span className="text-xs" style={{ color: C.faint, fontFamily: FONT.mono }}>± {forecast.sigma.toFixed(1)}</span>
              </div>
              <p className="text-xs mt-1" style={{ color: C.soft }}>
                Trend line over your last {Math.min(10, entries.length)} results — currently {trendWord} at {Math.abs(forecast.slope).toFixed(1)} pts per assessment. A guide, not a promise.
              </p>
            </div>
          )}

          <div className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: C.soft }}>
              <Target size={13} /> What do I need?
            </div>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span>To finish {curLabel} at</span>
              <input type="number" min="0" max="100" value={wish} onChange={(e) => setWish(e.target.value)}
                className="gx-focus w-20 rounded-lg border px-2 py-1 text-sm font-bold text-center"
                style={{ borderColor: C.line, fontFamily: FONT.mono }} aria-label="Desired term average" />
              <span>%,</span>
            </div>
            <p className="text-sm mt-2 font-semibold" style={{ color: whatIf.color }}>→ {whatIf.text}</p>
            <p className="text-[11px] mt-1" style={{ color: C.faint }}>Based on {n} result{n === 1 ? "" : "s"} logged this term, equally weighted.</p>
          </div>

          <div className="rounded-2xl border p-4 flex items-end gap-3" style={{ background: C.card, borderColor: C.line }}>
            <Field label="Target %">
              <input type="number" min="0" max="100" value={targetDraft} onChange={(e) => setTargetDraft(e.target.value)}
                className="gx-focus w-24 rounded-lg border px-2 py-1.5 text-sm font-bold text-center"
                style={{ borderColor: C.line, fontFamily: FONT.mono }} placeholder="none" />
            </Field>
            <button onClick={() => onSetTarget(sub.id, targetDraft === "" ? null : clamp(Number(targetDraft), 0, 100))}
              className="gx-focus px-3 py-1.5 rounded-lg text-sm font-bold text-white" style={{ background: C.ink }}>Save target</button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.soft }}>Recent results</h3>
              <button onClick={() => onAddGrade(sub.id)} className="gx-focus text-xs font-bold flex items-center gap-1" style={{ color: C.accent }}>
                <Plus size={13} /> Log result
              </button>
            </div>
            <div className="space-y-1.5">
              {entries.slice(-6).reverse().map((e) => (
                <button key={e.id} onClick={() => onEditEntry(e)}
                  className="gx-focus w-full flex items-center justify-between rounded-xl border px-3 py-2 text-left hover:border-black/20"
                  style={{ background: C.card, borderColor: C.line }}>
                  <span className="flex items-center gap-2 min-w-0">
                    <TypeBadge type={e.type} />
                    <span className="text-xs truncate" style={{ color: C.soft }}>{e.title || shortDateY(e.date)}</span>
                  </span>
                  <span className="text-sm font-bold shrink-0" style={{ fontFamily: FONT.mono }}>{e.score.toFixed(1)}%</span>
                </button>
              ))}
              {entries.length === 0 && <p className="text-xs" style={{ color: C.faint }}>Nothing logged yet — this line starts with your first result.</p>}
            </div>
          </div>

          <div className="pt-2 border-t" style={{ borderColor: C.line }}>
            <button onClick={() => (confirmDel ? onDeleteSubject(sub.id) : setConfirmDel(true))}
              className="gx-focus text-xs font-bold flex items-center gap-1.5" style={{ color: C.loss }}>
              <Trash2 size={13} /> {confirmDel ? "Click again to delete subject and all its results" : "Delist subject"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ── dashboard ───────────────────────────────────────────────────────────── */

function SubjectCard({ stat, onOpen }) {
  const { sub, latest, tickDelta, scores, curAvg, forecast, volatility } = stat;
  return (
    <button onClick={onOpen}
      className="gx-focus text-left rounded-2xl border p-4 transition-shadow hover:shadow-md w-full"
      style={{ background: C.card, borderColor: C.line }}>
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sub.color }} />
          <span className="text-xs font-bold tracking-wider shrink-0" style={{ fontFamily: FONT.mono, color: sub.color }}>{sub.ticker}</span>
          <span className="text-xs truncate" style={{ color: C.soft }}>{sub.name}</span>
        </span>
        <ChevronRight size={15} style={{ color: C.faint }} />
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-3xl font-bold leading-none" style={{ fontFamily: FONT.mono }}>
          {latest ? latest.score.toFixed(1) : "—"}
        </span>
        <span className="text-xs" style={{ color: C.faint, fontFamily: FONT.mono }}>%</span>
        <Delta v={tickDelta} size="lg" nullText="new" />
      </div>
      <Sparkline scores={scores} color={sub.color} />
      <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: C.soft, fontFamily: FONT.mono }}>
        <span>term avg {curAvg != null ? curAvg.toFixed(1) : "—"}</span>
        {forecast && <span style={{ color: C.accent }}>next ≈ {forecast.pred.toFixed(1)}</span>}
        <span style={{ color: stat.sd >= 7 ? C.amber : C.faint }}>{volatility.toLowerCase()}</span>
      </div>
    </button>
  );
}

function buildInsights(stats) {
  const out = [];
  const withPd = stats.filter((s) => s.periodDelta != null);
  if (withPd.length) {
    const riser = [...withPd].sort((a, b) => b.periodDelta - a.periodDelta)[0];
    if (riser.periodDelta > 0.5) out.push({ Icon: TrendingUp, color: C.gain, text: `${riser.sub.name} is up ${riser.periodDelta.toFixed(1)} pts on last term — momentum is with you.` });
    const faller = [...withPd].sort((a, b) => a.periodDelta - b.periodDelta)[0];
    if (faller.periodDelta < -0.5) out.push({ Icon: TrendingDown, color: C.loss, text: `${faller.sub.name} has slipped ${Math.abs(faller.periodDelta).toFixed(1)} pts since last term — a review week would pay off here first.` });
  }
  const vol = stats.filter((s) => s.scores.length >= 4).sort((a, b) => b.sd - a.sd)[0];
  if (vol && vol.sd >= 6) out.push({ Icon: Activity, color: C.amber, text: `${vol.sub.name} swings ±${vol.sd.toFixed(1)} pts between assessments — steadier prep would narrow the spread.` });
  const gaps = stats
    .filter((s) => s.sub.target != null && s.curAvg != null && s.curAvg < s.sub.target - 1)
    .map((s) => ({ s, gap: round1(s.sub.target - s.curAvg) }))
    .sort((a, b) => b.gap - a.gap);
  if (gaps.length) out.push({ Icon: Target, color: C.accent, text: `${gaps[0].s.sub.name} sits ${gaps[0].gap.toFixed(1)} pts under its ${gaps[0].s.sub.target}% target — the biggest open gap on the board.` });
  const met = stats.filter((s) => s.sub.target != null && s.curAvg != null && s.curAvg >= s.sub.target);
  if (met.length) out.push({ Icon: Target, color: C.gain, text: `${met.map((s) => s.sub.ticker).join(", ")} ${met.length === 1 ? "is" : "are"} trading above target this term.` });
  const fc = stats.filter((s) => s.forecast).sort((a, b) => b.forecast.pred - a.forecast.pred)[0];
  if (fc) out.push({ Icon: Sparkles, color: C.soft, text: `The trend line tips ${fc.sub.name} for ~${fc.forecast.pred.toFixed(0)}% next time (±${fc.forecast.sigma.toFixed(1)}).` });
  if (!out.length) out.push({ Icon: Sparkles, color: C.soft, text: "Log a few more results and analyst notes will appear here." });
  return out.slice(0, 5);
}

function Dashboard({ stats, index, onOpenSubject, onAddSubject }) {
  const insights = buildInsights(stats);
  const cur = currentTermKey();
  const termCount = stats.reduce((a, s) => a + s.curCount, 0);
  const riser = stats.filter((s) => s.periodDelta != null).sort((a, b) => b.periodDelta - a.periodDelta)[0];
  const faller = stats.filter((s) => s.periodDelta != null).sort((a, b) => a.periodDelta - b.periodDelta)[0];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border p-4" style={{ background: C.ink, borderColor: C.ink }}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">GX Index · {cur.label}</div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-bold text-white" style={{ fontFamily: FONT.mono }}>
              {index.value != null ? index.value.toFixed(1) : "—"}
            </span>
            <Delta v={index.delta} size="lg" />
          </div>
          <div className="text-[11px] text-white/45 mt-0.5">average across all subjects</div>
        </div>
        {[
          { l: "Top riser", s: riser && riser.periodDelta > 0 ? riser : null, good: true },
          { l: "Under pressure", s: faller && faller.periodDelta < 0 ? faller : null, good: false },
        ].map((x, i) => (
          <div key={i} className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>{x.l}</div>
            {x.s ? (
              <>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-xl font-bold tracking-wide" style={{ fontFamily: FONT.mono, color: x.s.sub.color }}>{x.s.sub.ticker}</span>
                  <Delta v={x.s.periodDelta} size="lg" />
                </div>
                <div className="text-[11px] mt-0.5 truncate" style={{ color: C.soft }}>{x.s.sub.name}, vs last term</div>
              </>
            ) : (
              <div className="text-sm mt-2" style={{ color: C.faint }}>steady across the board</div>
            )}
          </div>
        ))}
        <div className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>This session</div>
          <div className="text-xl font-bold mt-1" style={{ fontFamily: FONT.mono }}>{termCount} <span className="text-sm font-semibold" style={{ color: C.soft }}>results</span></div>
          <div className="text-[11px] mt-0.5" style={{ color: C.soft }}>{stats.length} subjects listed · {cur.label}</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 grid sm:grid-cols-2 gap-3 content-start">
          {stats.map((s) => <SubjectCard key={s.sub.id} stat={s} onOpen={() => onOpenSubject(s.sub.id)} />)}
          <button onClick={onAddSubject}
            className="gx-focus rounded-2xl border-2 border-dashed p-4 flex flex-col items-center justify-center gap-1.5 min-h-32 hover:bg-white transition-colors"
            style={{ borderColor: C.line, color: C.soft }}>
            <Plus size={20} />
            <span className="text-sm font-bold">List a subject</span>
          </button>
        </div>
        <aside className="rounded-2xl border p-4 h-fit" style={{ background: C.card, borderColor: C.line }}>
          <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: C.soft }}>
            <Sparkles size={13} /> Analyst notes
          </h3>
          <ul className="space-y-3">
            {insights.map((it, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-snug">
                <it.Icon size={16} className="shrink-0 mt-0.5" style={{ color: it.color }} />
                <span>{it.text}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

/* ── trends ──────────────────────────────────────────────────────────────── */

const GROUPS = [
  { value: "assessment", label: "Each assessment" },
  { value: "month", label: "Monthly" },
  { value: "term", label: "By term" },
  { value: "semester", label: "By semester" },
  { value: "year", label: "Yearly" },
];

function TrendsView({ subjects, entries }) {
  const [groupBy, setGroupBy] = useState("term");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showMA, setShowMA] = useState(false);
  const [showFC, setShowFC] = useState(true);
  const [showTargets, setShowTargets] = useState(false);
  const [hidden, setHidden] = useState(() => new Set());

  const visibleSubs = subjects.filter((s) => !hidden.has(s.id));
  const subMap = useMemo(() => Object.fromEntries(subjects.map((s) => [s.id, s])), [subjects]);
  const isTime = groupBy === "assessment";

  const rows = useMemo(() => {
    const ids = visibleSubs.map((s) => s.id);
    const visEntries = entries.filter((e) => !hidden.has(e.subjectId));
    let base = isTime ? buildAssessmentRows(visEntries, typeFilter) : buildGroupedRows(visEntries, groupBy, typeFilter);
    base = base.map((r) => ({ ...r }));
    if (showMA) addMovingAvg(base, ids);
    if (showFC) base = addForecast(base, ids, groupBy);
    return base;
  }, [entries, subjects, groupBy, typeFilter, showMA, showFC, hidden]);

  let min = 100;
  for (const r of rows) for (const s of visibleSubs)
    for (const k of [s.id, s.id + "_ma", s.id + "_fc"]) if (r[k] != null && r[k] < min) min = r[k];
  const yMin = Math.max(0, Math.floor((min - 4) / 10) * 10);
  const tick = { fontSize: 11, fontFamily: FONT.mono, fill: C.soft };

  const toggle = (id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-3.5 space-y-3" style={{ background: C.card, borderColor: C.line }}>
        <div className="flex flex-wrap items-center gap-2">
          <Sel ariaLabel="Group results by" value={groupBy} onChange={setGroupBy} options={GROUPS} />
          <Sel ariaLabel="Filter by assessment type" value={typeFilter} onChange={setTypeFilter}
            options={[{ value: "all", label: "All types" }, ...TYPES.map((t) => ({ value: t, label: t + "s" }))]} />
          <span className="w-px h-6 mx-1 hidden sm:block" style={{ background: C.line }} />
          <TogglePill on={showFC} onClick={() => setShowFC(!showFC)}>Forecast</TogglePill>
          <TogglePill on={showMA} onClick={() => setShowMA(!showMA)}>Smooth (3-avg)</TogglePill>
          <TogglePill on={showTargets} onClick={() => setShowTargets(!showTargets)}>Targets</TogglePill>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {subjects.map((s) => {
            const on = !hidden.has(s.id);
            return (
              <button key={s.id} onClick={() => toggle(s.id)}
                className="gx-focus flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold transition-colors"
                style={{
                  fontFamily: FONT.mono,
                  background: on ? s.color : "#fff",
                  color: on ? "#fff" : C.faint,
                  borderColor: on ? s.color : C.line,
                }}>
                {s.ticker}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
        {rows.length < 2 || visibleSubs.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-sm" style={{ color: C.faint }}>
            {visibleSubs.length === 0 ? "Every subject is hidden — tap a ticker above to bring one back." : "Not enough results here yet. Log a couple more, or widen the filters."}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={rows} margin={{ top: 10, right: 14, bottom: 0, left: -6 }}>
              <CartesianGrid stroke={C.line} vertical={false} />
              {isTime ? (
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={shortDate} tick={tick} stroke={C.line} tickMargin={8} />
              ) : (
                <XAxis dataKey="label" tick={tick} stroke={C.line} tickMargin={8} interval="preserveStartEnd" />
              )}
              <YAxis domain={[yMin, 100]} tick={tick} stroke="transparent" width={38} tickFormatter={(v) => v + "%"} />
              <Tooltip content={<ChartTip subMap={subMap} isTime={isTime} />} />
              {showTargets && visibleSubs.filter((s) => s.target != null).map((s) => (
                <ReferenceLine key={"tg" + s.id} y={s.target} stroke={s.color} strokeDasharray="2 6" strokeOpacity={0.55}
                  label={{ value: `${s.ticker} ${s.target}`, position: "insideTopRight", fill: s.color, fontSize: 10, fontFamily: FONT.mono }} />
              ))}
              {visibleSubs.map((s) => (
                <Line key={s.id} dataKey={s.id} stroke={s.color} strokeWidth={showMA ? 1.3 : 2.4} strokeOpacity={showMA ? 0.3 : 1}
                  dot={{ r: 2.6, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              ))}
              {showMA && visibleSubs.map((s) => (
                <Line key={s.id + "ma"} dataKey={s.id + "_ma"} stroke={s.color} strokeWidth={2.4} dot={false} connectNulls isAnimationActive={false} />
              ))}
              {showFC && visibleSubs.map((s) => (
                <Line key={s.id + "fc"} dataKey={s.id + "_fc"} stroke={s.color} strokeWidth={2} strokeDasharray="6 5"
                  dot={{ r: 3, fill: "#fff", stroke: s.color, strokeWidth: 1.5 }} connectNulls isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <p className="text-[11px] mt-2" style={{ color: C.faint }}>
          Dashed segments are trend-line estimates for the next period — a guide, not a promise. Solid lines are your logged results{showMA ? "; bold lines are 3-result rolling averages" : ""}.
        </p>
      </div>
    </div>
  );
}

/* ── compare (radar) ─────────────────────────────────────────────────────── */

function CompareView({ subjects, entries }) {
  const termRows = useMemo(() => buildGroupedRows(entries, "term", "all"), [entries]);
  const opts = termRows.map((r) => ({ value: r.key, label: r.label }));
  const [keyA, setKeyA] = useState(opts.length ? opts[opts.length - 1].value : "");
  const [keyB, setKeyB] = useState(opts.length > 1 ? opts[opts.length - 2].value : "");

  useEffect(() => {
    if (opts.length && !opts.some((o) => o.value === keyA)) setKeyA(opts[opts.length - 1].value);
    if (opts.length > 1 && !opts.some((o) => o.value === keyB)) setKeyB(opts[opts.length - 2].value);
  }, [entries]);

  const rowA = termRows.find((r) => r.key === keyA);
  const rowB = termRows.find((r) => r.key === keyB);
  const labelA = rowA?.label || "—";
  const labelB = rowB?.label || "—";

  const radarData = subjects.map((s) => ({
    axis: s.ticker, name: s.name,
    A: rowA?.[s.id] ?? null, B: rowB?.[s.id] ?? null,
  }));
  const plotData = radarData.map((d) => ({ ...d, A: d.A ?? 0, B: d.B ?? 0 }));

  if (!subjects.length || termRows.length === 0) {
    return <div className="rounded-2xl border p-10 text-center text-sm" style={{ background: C.card, borderColor: C.line, color: C.faint }}>
      Log some results first — then compare any two terms side by side here.
    </div>;
  }

  return (
    <div className="grid lg:grid-cols-5 gap-5">
      <div className="lg:col-span-3 rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="w-3 h-3 rounded-sm" style={{ background: C.accent }} />
          <Sel ariaLabel="Period A" value={keyA} onChange={setKeyA} options={opts} />
          <span className="text-xs font-bold" style={{ color: C.faint }}>vs</span>
          <span className="w-3 h-3 rounded-sm border" style={{ background: "#E6E9F0", borderColor: "#98A0B3" }} />
          <Sel ariaLabel="Period B" value={keyB} onChange={setKeyB} options={opts} />
        </div>
        <ResponsiveContainer width="100%" height={380}>
          <RadarChart data={plotData} outerRadius="72%">
            <PolarGrid stroke={C.line} />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12, fontFamily: FONT.mono, fill: C.ink, fontWeight: 700 }} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} tick={{ fontSize: 9, fill: C.faint, fontFamily: FONT.mono }} stroke="transparent" />
            <Radar name={labelB} dataKey="B" stroke="#98A0B3" fill="#98A0B3" fillOpacity={0.15} strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />
            <Radar name={labelA} dataKey="A" stroke={C.accent} fill={C.accent} fillOpacity={0.22} strokeWidth={2.5} isAnimationActive={false} />
            <Tooltip formatter={(v, n) => [Number(v).toFixed(1) + "%", n]}
              contentStyle={{ borderRadius: 12, border: `1px solid ${C.line}`, fontFamily: FONT.mono, fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
        {subjects.length < 3 && <p className="text-[11px] mt-1" style={{ color: C.faint }}>The shape gets more useful from three subjects up.</p>}
      </div>
      <div className="lg:col-span-2 rounded-2xl border p-4 h-fit" style={{ background: C.card, borderColor: C.line }}>
        <h3 className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: C.soft }}>{labelA} vs {labelB}</h3>
        <div className="space-y-2">
          {radarData.map((d, i) => {
            const delta = d.A != null && d.B != null ? round1(d.A - d.B) : null;
            return (
              <div key={i} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: C.line }}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: subjects[i].color }} />
                  <span className="text-xs font-semibold truncate">{d.name}</span>
                </span>
                <span className="flex items-center gap-3 shrink-0 text-xs" style={{ fontFamily: FONT.mono }}>
                  <span className="font-bold">{d.A != null ? d.A.toFixed(1) : "—"}</span>
                  <span style={{ color: C.faint }}>{d.B != null ? d.B.toFixed(1) : "—"}</span>
                  <Delta v={delta} />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── ledger ──────────────────────────────────────────────────────────────── */

function LedgerView({ subjects, entries, onEdit, onDelete }) {
  const [subFilter, setSubFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const subMap = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const rows = entries
    .filter((e) => (subFilter === "all" || e.subjectId === subFilter) && (typeFilter === "all" || e.type === typeFilter))
    .sort((a, b) => (a.date > b.date ? -1 : 1));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sel ariaLabel="Filter by subject" value={subFilter} onChange={setSubFilter}
          options={[{ value: "all", label: "All subjects" }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]} />
        <Sel ariaLabel="Filter by type" value={typeFilter} onChange={setTypeFilter}
          options={[{ value: "all", label: "All types" }, ...TYPES.map((t) => ({ value: t, label: t + "s" }))]} />
        <span className="text-xs ml-auto" style={{ color: C.faint, fontFamily: FONT.mono }}>{rows.length} entries</span>
      </div>
      <div className="rounded-2xl border overflow-x-auto" style={{ background: C.card, borderColor: C.line }}>
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest" style={{ color: C.faint }}>
              {["Date", "Subject", "Assessment", "Score", ""].map((h, i) => (
                <th key={i} className="px-4 py-3 font-bold border-b" style={{ borderColor: C.line }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const s = subMap[e.subjectId];
              if (!s) return null;
              return (
                <tr key={e.id} className="border-b last:border-0 hover:bg-black/[0.02]" style={{ borderColor: C.line }}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs" style={{ fontFamily: FONT.mono, color: C.soft }}>{shortDateY(e.date)}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                      <span className="text-xs font-bold tracking-wide" style={{ fontFamily: FONT.mono }}>{s.ticker}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <TypeBadge type={e.type} />
                      {e.title && <span className="text-xs truncate max-w-40" style={{ color: C.soft }}>{e.title}</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-bold" style={{ fontFamily: FONT.mono }}>{e.score.toFixed(1)}%</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center justify-end gap-1">
                      <button onClick={() => onEdit(e)} aria-label="Edit result" className="gx-focus p-1.5 rounded-lg hover:bg-black/5" style={{ color: C.soft }}><Pencil size={14} /></button>
                      <button onClick={() => onDelete(e.id)} aria-label="Delete result" className="gx-focus p-1.5 rounded-lg hover:bg-black/5" style={{ color: C.loss }}><Trash2 size={14} /></button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: C.faint }}>Nothing matches these filters yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── app shell ───────────────────────────────────────────────────────────── */

const TABS = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutGrid },
  { id: "trends", label: "Trends", Icon: LineIcon },
  { id: "compare", label: "Compare", Icon: RadarIcon },
  { id: "ledger", label: "Ledger", Icon: Table2 },
];

export default function GradeExchange() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("dashboard");
  const [modal, setModal] = useState(null); // {type:'subject'} | {type:'grade', entry?, subjectId?}
  const [drawerId, setDrawerId] = useState(null);
  const [saveErr, setSaveErr] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      let d = null;
      try {
        if (window.storage) {
          const r = await window.storage.get(STORE_KEY);
          if (r && r.value) d = JSON.parse(r.value);
        }
      } catch (e) { /* first run — nothing saved yet */ }
      if (!dead) setData(d && Array.isArray(d.subjects) ? d : makeSample());
    })();
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    if (!data) return;
    (async () => {
      try {
        if (window.storage) { await window.storage.set(STORE_KEY, JSON.stringify(data)); setSaveErr(false); }
      } catch (e) { setSaveErr(true); }
    })();
  }, [data]);

  const stats = useMemo(() => (data ? computeStats(data.subjects, data.entries) : []), [data]);

  const index = useMemo(() => {
    const curVals = stats.map((s) => s.curAvg ?? s.overallAvg).filter((v) => v != null);
    const prevVals = stats.map((s) => s.prevAvg).filter((v) => v != null);
    const value = curVals.length ? round1(avg(curVals)) : null;
    const prev = prevVals.length ? round1(avg(prevVals)) : null;
    return { value, delta: value != null && prev != null ? round1(value - prev) : null };
  }, [stats]);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.paper, fontFamily: FONT.body }}>
        <style>{GLOBAL_CSS}</style>
        <div className="text-sm font-semibold" style={{ color: C.soft }}>Opening the exchange…</div>
      </div>
    );
  }

  const { subjects, entries } = data;
  const update = (patch) => setData((d) => ({ ...d, ...patch }));

  const addSubject = (sub) => { update({ subjects: [...subjects, sub], sample: data.sample }); setModal(null); };
  const saveGrade = (entry) => {
    const exists = entries.some((e) => e.id === entry.id);
    update({ entries: exists ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry] });
    setModal(null);
  };
  const deleteEntry = (id) => update({ entries: entries.filter((e) => e.id !== id) });
  const setTarget = (sid, target) => update({ subjects: subjects.map((s) => (s.id === sid ? { ...s, target } : s)) });
  const deleteSubject = (sid) => {
    update({ subjects: subjects.filter((s) => s.id !== sid), entries: entries.filter((e) => e.subjectId !== sid) });
    setDrawerId(null);
  };
  const startFresh = () => { setData({ subjects: [], entries: [], sample: false }); setDrawerId(null); };

  const drawerStat = drawerId ? stats.find((s) => s.sub.id === drawerId) : null;
  const cur = currentTermKey();

  return (
    <div className="min-h-screen" style={{
      background: C.paper, color: C.ink, fontFamily: FONT.body,
      backgroundImage: "linear-gradient(rgba(27,36,58,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(27,36,58,0.045) 1px, transparent 1px)",
      backgroundSize: "28px 28px",
    }}>
      <style>{GLOBAL_CSS}</style>
      {stats.some((s) => s.latest) && <TickerTape stats={stats} index={index} />}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        <header className="flex flex-wrap items-end justify-between gap-3 pt-6 pb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tighter leading-none">
              GRADE<span style={{ color: C.accent }}>·</span>EXCHANGE
            </h1>
            <p className="text-xs mt-1.5 font-semibold" style={{ color: C.soft, fontFamily: FONT.mono }}>
              {cur.label} session — your subjects, tracked like a portfolio
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setModal({ type: "subject" })}
              className="gx-focus flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold border bg-white"
              style={{ borderColor: C.line, color: C.ink }}>
              <Plus size={15} /> Subject
            </button>
            {subjects.length > 0 && (
              <button onClick={() => setModal({ type: "grade" })}
                className="gx-focus flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold text-white"
                style={{ background: C.ink }}>
                <Plus size={15} /> Log result
              </button>
            )}
          </div>
        </header>

        {data.sample && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-2.5 mb-4 text-xs font-semibold"
            style={{ background: C.amberBg, borderColor: "#EAD9A0", color: C.amber }}>
            <span>You're looking at sample data so the charts have something to show.</span>
            <button onClick={startFresh} className="gx-focus underline font-bold">Clear it and start with my subjects</button>
            <button onClick={() => update({ sample: false })} className="gx-focus font-bold" style={{ color: "#A08A3F" }}>Keep exploring</button>
          </div>
        )}
        {saveErr && (
          <div className="rounded-xl border px-3.5 py-2.5 mb-4 text-xs font-semibold" style={{ background: "#FBEDEB", borderColor: "#EBC5C0", color: C.loss }}>
            Couldn't save just now — your changes are held in this session, and saving will retry on your next edit.
          </div>
        )}

        <nav className="flex gap-1 border-b mb-5 overflow-x-auto" style={{ borderColor: C.line }} aria-label="Views">
          {TABS.map((t) => {
            const active = view === t.id;
            return (
              <button key={t.id} onClick={() => setView(t.id)}
                className="gx-focus flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors"
                style={{ color: active ? C.ink : C.faint, borderColor: active ? C.accent : "transparent" }}>
                <t.Icon size={15} /> {t.label}
              </button>
            );
          })}
        </nav>

        {subjects.length === 0 ? (
          <div className="rounded-2xl border p-10 sm:p-14 text-center" style={{ background: C.card, borderColor: C.line }}>
            <GraduationCap size={32} className="mx-auto mb-3" style={{ color: C.faint }} />
            <h2 className="text-xl font-black tracking-tight mb-1">The floor is quiet</h2>
            <p className="text-sm mb-5 max-w-md mx-auto" style={{ color: C.soft }}>
              List your first subject to open your exchange. Every result you log becomes a point on its line.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setModal({ type: "subject" })}
                className="gx-focus flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: C.ink }}>
                <Plus size={15} /> List a subject
              </button>
              <button onClick={() => setData(makeSample())}
                className="gx-focus flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold border bg-white" style={{ borderColor: C.line, color: C.soft }}>
                <RefreshCw size={14} /> Load sample data
              </button>
            </div>
          </div>
        ) : (
          <div className="gx-fade" key={view}>
            {view === "dashboard" && (
              <Dashboard stats={stats} index={index}
                onOpenSubject={setDrawerId} onAddSubject={() => setModal({ type: "subject" })} />
            )}
            {view === "trends" && <TrendsView subjects={subjects} entries={entries} />}
            {view === "compare" && <CompareView subjects={subjects} entries={entries} />}
            {view === "ledger" && (
              <LedgerView subjects={subjects} entries={entries}
                onEdit={(e) => setModal({ type: "grade", entry: e })} onDelete={deleteEntry} />
            )}
          </div>
        )}

        <footer className="mt-10 text-[11px]" style={{ color: C.faint, fontFamily: FONT.mono }}>
          Scores are out of 100 · terms follow the calendar quarters · forecasts are simple trend lines, not certainties.
        </footer>
      </div>

      {drawerStat && (
        <Drawer key={drawerId} stat={drawerStat} onClose={() => setDrawerId(null)}
          onSetTarget={setTarget} onDeleteSubject={deleteSubject}
          onAddGrade={(sid) => setModal({ type: "grade", subjectId: sid })}
          onEditEntry={(e) => setModal({ type: "grade", entry: e })} />
      )}
      {modal?.type === "subject" && <SubjectModal subjects={subjects} onSave={addSubject} onClose={() => setModal(null)} />}
      {modal?.type === "grade" && subjects.length > 0 && (
        <GradeModal subjects={subjects} entry={modal.entry} defaultSubjectId={modal.subjectId}
          onSave={saveGrade} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
