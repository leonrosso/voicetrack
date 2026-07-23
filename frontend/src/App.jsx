import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  Settings, X, SlidersHorizontal,
  Beef, Wheat, Droplet, Mic, AlertCircle, Check, UtensilsCrossed,
  LayoutGrid, Volume2, Loader2, MessageCircleQuestion,
  ChevronLeft, ChevronRight, Send, ScanLine, Camera,
  Pencil, Trash2, Keyboard, Plus, Minus, Search, Star
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, ReferenceLine
} from 'recharts';

// ---------------------------------------------------------------------------
// Design tokens — "nutrition readout" palette.
// Dark cutting-board charcoal, three food-coded accents (not decorative —
// each color always means the same macro everywhere in the UI), tabular
// mono numerals for anything that behaves like a scale readout.
// ---------------------------------------------------------------------------
const C = {
  bg: '#121613',
  surface: '#1A211D',
  surfaceRaised: '#212A25',
  surfacePast: '#211C18',   // marrone caldo: schede Diario nei giorni passati
  surfaceFuture: '#1A242C', // slate freddo: schede Diario nei giorni futuri
  line: '#2B352F',
  linePast: '#3A322C',
  lineFuture: '#2A3540',
  ink: '#EFEDE4',
  inkMuted: '#8C978F',
  inkFaint: '#5B655E',
  protein: '#B5502F',   // rust / seared meat
  carbs: '#D9A441',     // wheat gold
  fat: '#7C9070',        // olive
  good: '#8FAE86',
  alert: '#E2664F',
  amber: '#D9A441',
};

const FONT_IMPORT = "@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');";

// Animazione del microfono in ascolto (anello che pulsa) + collapse pannello edit.
const EXTRA_CSS = `
@keyframes vt-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(143, 174, 134, 0.45); }
  70%  { box-shadow: 0 0 0 18px rgba(143, 174, 134, 0); }
  100% { box-shadow: 0 0 0 0 rgba(143, 174, 134, 0); }
}
.vt-edit-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.28s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.vt-edit-collapse.is-open {
  grid-template-rows: 1fr;
}
.vt-edit-collapse-inner {
  min-height: 0;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.22s ease;
}
.vt-edit-collapse.is-open > .vt-edit-collapse-inner {
  opacity: 1;
}
/* Scroll interno Obiettivi senza barra visibile (evita flash in apertura). */
.vt-targets-scroll {
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.vt-targets-scroll::-webkit-scrollbar {
  display: none;
}
.vt-delete-confirm-fill {
  transform-origin: right center;
  transform: scaleX(0);
  transition: transform 0.28s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.vt-delete-confirm-fill.is-open {
  transform: scaleX(1);
}
.vt-delete-confirm-content {
  opacity: 0;
  transform: translateX(12px);
  transition: opacity 0.28s cubic-bezier(0.25, 0.8, 0.25, 1), transform 0.28s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.vt-delete-confirm-content.is-open {
  opacity: 1;
  transform: translateX(0);
}
.vt-edit-confirm-fill {
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 0.28s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.vt-edit-confirm-fill.is-open {
  transform: scaleX(1);
}
.vt-edit-confirm-content {
  opacity: 0;
  transform: translateX(-12px);
  transition: opacity 0.28s cubic-bezier(0.25, 0.8, 0.25, 1), transform 0.28s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.vt-edit-confirm-content.is-open {
  opacity: 1;
  transform: translateX(0);
}`;

// ---------------------------------------------------------------------------
// Web Speech API — riconoscimento vocale del browser.
// Su Chrome/Android usa il motore Google (stessa qualita' di Tasker).
// lang = 'it-IT' e' HARDCODED piu' sotto: il problema "sistema in francese"
// sparisce strutturalmente, nessun menu che gli update possono resettare.
// ---------------------------------------------------------------------------
const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

// Convenzione needs_clarification (§3.4 del Piano di Consolidamento):
// il backend e' stateless, quindi il secondo POST contiene il testo
// originale + la risposta al chiarimento, concatenati con una virgola
// (es. "un piatto di pasta, 300 grammi"). Questa e' la convenzione
// standard: Tasker andra' allineato allo stesso schema.
const CLARIFY_JOIN = ', ';
const MAX_CLARIFY_ROUNDS = 3;

/** Normalizza nomi alimento per match catalogo ↔ riga Diario. */
const normalizeFoodName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Storage: usa localStorage del browser (persiste tra refresh e riavvii della
// PWA). Mantiene la stessa interfaccia di window.storage (get/set/delete) che
// esiste solo dentro Claude, cosi' il resto del codice non cambia.
// ---------------------------------------------------------------------------
const storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    return value === null ? null : { key, value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

// ---------------------------------------------------------------------------
// Demo data — mirrors the schema the /log_meal endpoint already writes to
// Sheets, so swapping in real data from /dashboard later is a straight
// field-for-field match.
// ---------------------------------------------------------------------------
const DEMO_TARGET = { kcal: 2200, proteine: 165, carboidrati: 220, grassi: 70 };

const DEMO_MEALS_TODAY = [
  { id: 1, pasto: 'colazione', time: '07:45', alimento: 'Yogurt greco, miele e noci', grammi: 200, kcal: 310, proteine: 18, carboidrati: 22, grassi: 16, fonte: 'voce' },
  { id: 2, pasto: 'pranzo', time: '13:10', alimento: 'Petto di tacchino alla griglia', grammi: 500, kcal: 550, proteine: 110, carboidrati: 0, grassi: 8, fonte: 'voce' },
  { id: 3, pasto: 'pranzo', time: '13:10', alimento: 'Insalata mista', grammi: 150, kcal: 25, proteine: 2, carboidrati: 4, grassi: 0.5, fonte: 'voce' },
  { id: 4, pasto: 'pranzo', time: '13:10', alimento: 'Olio extravergine di oliva', grammi: 10, kcal: 90, proteine: 0, carboidrati: 0, grassi: 10, fonte: 'voce' },
  { id: 5, pasto: 'spuntino', time: '17:20', alimento: 'Barretta proteica', grammi: 40, kcal: 160, proteine: 15, carboidrati: 12, grassi: 5, fonte: 'barcode' },
];

// YYYY-MM-DD in ora locale (niente toISOString: sballerebbe il fuso).
const fmtYMD = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Indicizzato su Date.getDay() (0 = domenica), stesse etichette di WEEKDAY_IT
// nel backend (che invece indicizza su weekday(), 0 = lunedi').
const WEEKDAY_IT_BY_JSDAY = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

// Date reali degli ultimi 7 giorni (oggi compreso), come /dashboard: cosi'
// anche in demo il tap su un giorno del grafico porta al giorno giusto.
function buildDemoWeek() {
  const kcals = [1950, 2080, 1740, 2260, 2190, 2380, 1135];
  const today = new Date();
  const week = [];
  for (let j = 6; j >= 0; j--) {
    const d = new Date(today);
    d.setDate(d.getDate() - j);
    week.push({ label: WEEKDAY_IT_BY_JSDAY[d.getDay()], date: fmtYMD(d), kcal: kcals[6 - j] });
  }
  return week;
}
const DEMO_WEEK = buildDemoWeek();

const MONTH_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

// Ultime 5 settimane rolling (media giornaliera), allineato a /dashboard.
function buildDemoMonth() {
  const kcals = [1980, 2050, 1890, 2210, 2100];
  const today = new Date();
  const out = [];
  for (let w = 4; w >= 0; w--) {
    const start = new Date(today);
    start.setDate(start.getDate() - (w * 7 + 6));
    out.push({
      label: `${start.getDate()}/${start.getMonth() + 1}`,
      date: fmtYMD(start),
      kcal: kcals[4 - w],
    });
  }
  return out;
}
const DEMO_MONTH = buildDemoMonth();

// Ultimi 12 mesi (media giornaliera), allineato a /dashboard.
function buildDemoYear() {
  const kcals = [2050, 1980, 2120, 1900, 2180, 2250, 2080, 1950, 2020, 2150, 2100, 2030];
  const today = new Date();
  const out = [];
  for (let m = 11; m >= 0; m--) {
    const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
    out.push({
      label: MONTH_IT[d.getMonth()],
      date: fmtYMD(d),
      kcal: kcals[11 - m],
    });
  }
  return out;
}
const DEMO_YEAR = buildDemoYear();

const TREND_RANGES = [
  { id: 'year', label: 'ANNO' },
  { id: 'month', label: 'MESE' },
  { id: 'week', label: 'SETTIMANA' },
];
const TREND_TITLE = {
  week: 'Ultimi 7 giorni · tocca un giorno per aprirlo',
  month: 'Ultime 5 settimane · tocca una settimana per aprirla',
  year: 'Ultimi 12 mesi · tocca un mese per aprirlo',
};
const PASTO_ORDER = ['colazione', 'pranzo', 'spuntino', 'cena'];
const PASTO_LABEL = { colazione: 'Colazione', pranzo: 'Pranzo', spuntino: 'Spuntino', cena: 'Cena' };
const TAB_ORDER = ['diario', 'traccia', 'scan'];
// Zoom digitale di rinforzo sullo scan barcode (preview CSS + crop del detector).
// Il fix principale e' lo zoom hardware / deviceId (§7.2): questo resta un aiuto
// leggero dopo che la lente e' quella giusta, non un sostituto del fuoco ottico.
const SCAN_DIGITAL_ZOOM = 1.35;
const SCAN_CAMERA_ID_KEY = 'vt-scan-camera-id';
const SCAN_TARGET_ZOOM = 2; // tipicamente fa uscire dalla 0.5x sulla lente principale

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Preferisce la back camera "normale", evita ultra-wide / front se le label ci sono. */
function pickScanCameraId(devices, currentId) {
  const videos = devices.filter((d) => d.kind === 'videoinput');
  if (videos.length === 0) return currentId || null;

  const labelOf = (d) => String(d.label || '').toLowerCase();
  const isFront = (d) => /front|user|selfie|faccia/.test(labelOf(d));
  const isUltra = (d) => /ultra|uw\b|0\s*\.?\s*5|grandangol|wide-angle|wide angle/.test(labelOf(d));
  const isBackish = (d) => /back|rear|environment|facing back|camera2\s*0|world/.test(labelOf(d));

  const back = videos.filter((d) => !isFront(d));
  const pool = back.length ? back : videos;
  const notUltra = pool.filter((d) => !isUltra(d));
  const candidates = notUltra.length ? notUltra : pool;

  const preferred =
    candidates.find(isBackish) ||
    candidates.find((d) => d.deviceId === currentId) ||
    candidates[0];
  return preferred?.deviceId || currentId || null;
}

async function openScanCameraStream() {
  const videoBase = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const savedId = localStorage.getItem(SCAN_CAMERA_ID_KEY);

  let stream = null;
  if (savedId) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { ...videoBase, deviceId: { exact: savedId } },
        audio: false,
      });
    } catch (e) {
      // deviceId stale (cambio telefono / permesso): ricadi su facingMode
      try { localStorage.removeItem(SCAN_CAMERA_ID_KEY); } catch (err) {}
    }
  }
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { ...videoBase, facingMode: { ideal: 'environment' } },
      audio: false,
    });
  }

  // Dopo il permesso le label sono popolate: se siamo sull'ultra-wide, riprova con
  // una back camera migliore e ricorda il deviceId per i prossimi scan.
  try {
    const track = stream.getVideoTracks()[0];
    const currentId = track?.getSettings?.()?.deviceId || '';
    const devices = await navigator.mediaDevices.enumerateDevices();
    const betterId = pickScanCameraId(devices, currentId);
    if (betterId && betterId !== currentId) {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { ...videoBase, deviceId: { exact: betterId } },
        audio: false,
      });
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      stream = next;
    }
    const finalId = stream.getVideoTracks()[0]?.getSettings?.()?.deviceId;
    if (finalId) localStorage.setItem(SCAN_CAMERA_ID_KEY, finalId);
  } catch (e) { /* enumerate/switch best-effort */ }

  return stream;
}

/** Zoom fisico ~2x + AF/esposizione continui: su molti Android porta fuori dalla 0.5x. */
async function applyScanTrackConstraints(track) {
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities() ?? {};
  const advanced = {};
  if (caps.zoom) {
    const zMin = caps.zoom.min ?? 1;
    const zMax = caps.zoom.max ?? 1;
    if (zMax > zMin) {
      // Mira a SCAN_TARGET_ZOOM; se il range e' stretto resta il massimo utile.
      advanced.zoom = clamp(SCAN_TARGET_ZOOM, zMin, zMax);
    }
  }
  if (caps.focusMode?.includes('continuous')) advanced.focusMode = 'continuous';
  if (caps.exposureMode?.includes('continuous')) advanced.exposureMode = 'continuous';
  if (caps.whiteBalanceMode?.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
  if (Object.keys(advanced).length === 0) return;
  try {
    await track.applyConstraints({ advanced: [advanced] });
  } catch (e) {
    // Alcuni browser accettano zoom solo come constraint di primo livello.
    if (advanced.zoom != null) {
      try { await track.applyConstraints({ zoom: advanced.zoom }); } catch (err) {}
    }
  }
}

function groupByPasto(meals) {
  const groups = {};
  for (const m of meals) {
    if (!groups[m.pasto]) groups[m.pasto] = [];
    groups[m.pasto].push(m);
  }
  return PASTO_ORDER.filter((p) => groups[p]).map((p) => ({ pasto: p, items: groups[p] }));
}

function sumTotals(meals) {
  return meals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      proteine: acc.proteine + m.proteine,
      carboidrati: acc.carboidrati + m.carboidrati,
      grassi: acc.grassi + m.grassi,
    }),
    { kcal: 0, proteine: 0, carboidrati: 0, grassi: 0 }
  );
}

const dayLabel = (d = new Date()) => {
  const s = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const dateForOffset = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};

// Cache giorni ≠ oggi: persistenza localStorage (come vt-cache) + SWR in App.
const DAY_CACHE_KEY = 'vt-day-cache';
const DAY_CACHE_STALE_MS = 2 * 60 * 1000; // rifetch background se più vecchio di 2 min
const DAY_CACHE_MAX_DAYS = 40;

function prunePersistedDays(days) {
  const entries = Object.entries(days || {});
  if (entries.length <= DAY_CACHE_MAX_DAYS) return days;
  entries.sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0));
  return Object.fromEntries(entries.slice(0, DAY_CACHE_MAX_DAYS));
}

async function loadPersistedDayCache() {
  try {
    const raw = await storage.get(DAY_CACHE_KEY);
    if (!raw?.value) return {};
    const parsed = JSON.parse(raw.value);
    if (parsed?.version !== 1 || !parsed.days) return {};
    const out = {};
    for (const [str, entry] of Object.entries(parsed.days)) {
      if (Array.isArray(entry?.meals)) {
        out[str] = { meals: entry.meals, loading: false, error: '', at: entry.at || 0 };
      }
    }
    return out;
  } catch (e) {
    return {};
  }
}

async function persistDayCacheEntry(str, meals) {
  try {
    const raw = await storage.get(DAY_CACHE_KEY);
    let days = {};
    if (raw?.value) {
      const parsed = JSON.parse(raw.value);
      if (parsed?.version === 1 && parsed.days) days = { ...parsed.days };
    }
    days[str] = { meals, at: Date.now() };
    await storage.set(DAY_CACHE_KEY, JSON.stringify({ version: 1, days: prunePersistedDays(days) }));
  } catch (e) {}
}

async function removePersistedDay(str) {
  try {
    const raw = await storage.get(DAY_CACHE_KEY);
    if (!raw?.value) return;
    const parsed = JSON.parse(raw.value);
    if (parsed?.version !== 1 || !parsed.days || !(str in parsed.days)) return;
    const days = { ...parsed.days };
    delete days[str];
    await storage.set(DAY_CACHE_KEY, JSON.stringify({ version: 1, days }));
  } catch (e) {}
}

const daySurface = (offset) => {
  if (offset > 0) return C.surfaceFuture;
  if (offset < 0) return C.surfacePast;
  return C.surface;
};
const dayLine = (offset) => {
  if (offset > 0) return C.lineFuture;
  if (offset < 0) return C.linePast;
  return C.line;
};

/** Titolo scheda Diario: Ieri / Oggi / Domani, altrimenti data completa. */
const diaryDayTitle = (offset, date) => {
  if (offset === 0) return dayLabel();
  if (offset === -1) return 'Ieri';
  if (offset === 1) return 'Domani';
  return dayLabel(date || dateForOffset(offset));
};

const diaryMealsHeading = (offset, date) => {
  if (offset === 0) return 'Pasti di oggi';
  if (offset === -1) return 'Pasti di ieri';
  if (offset === 1) return 'Pasti di domani';
  const d = date || dateForOffset(offset);
  return `Pasti del ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}`;
};

// Anteprima giorno adiacente nel carosello Diario (sola lettura).
// Stesso above-the-fold del centro (calorie+frecce+azioni+macro) per evitare
// il flash di layout a fine swipe; niente handler, pointer-events off.
function DayPeek({ offset, meals, loading, error, target }) {
  const date = dateForOffset(offset);
  const totals = sumTotals(meals);
  const remaining = target.kcal - totals.kcal;
  const overTarget = remaining < 0;
  const pct = Math.min(totals.kcal / Math.max(target.kcal, 1), 1.25);
  const grouped = groupByPasto(meals);
  const macroCalData = [
    { name: 'Proteine', grams: totals.proteine, cal: totals.proteine * 4, color: C.protein },
    { name: 'Carboidrati', grams: totals.carboidrati, cal: totals.carboidrati * 4, color: C.carbs },
    { name: 'Grassi', grams: totals.grassi, cal: totals.grassi * 9, color: C.fat },
  ];
  const surf = daySurface(offset);
  const line = dayLine(offset);
  const quickActions = [
    { id: 'text', label: 'TESTO', icon: <Keyboard size={22} /> },
    { id: 'cerca', label: 'CERCA', icon: <Search size={22} /> },
    { id: 'scan', label: 'SCAN', icon: <ScanLine size={22} /> },
    { id: 'voice', label: 'VOCE', icon: <Mic size={22} /> },
  ];

  return (
    <div
      className="flex flex-col gap-4"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      aria-hidden
    >
      <div
        style={{
          display: 'grid',
          gridTemplateRows: 'minmax(0, 1fr) minmax(0, 2fr)',
          gap: '22px',
          height: 'calc(var(--app-height, 100dvh) - 150px)',
          paddingBottom: 'max(40px, env(safe-area-inset-bottom, 0px))',
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            background: surf,
            border: `1px solid ${line}`,
            borderRadius: '14px',
            padding: '22px 22px 34px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            minHeight: 0,
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ flexShrink: 0, maxHeight: 40, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 32px', alignItems: 'center' }}>
              <div style={{ color: C.inkMuted, padding: '4px', display: 'flex', justifyContent: 'center', width: '32px' }}>
                <ChevronLeft size={22} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', color: offset === 0 ? C.inkMuted : C.ink }}>
                  {diaryDayTitle(offset, date)}
                </span>
                {offset !== 0 && (
                  <span style={{ color: C.good, border: `1px solid ${line}`, borderRadius: '6px', padding: '2px 8px', fontSize: '11px' }}>
                    {loading ? '…' : 'Oggi'}
                  </span>
                )}
              </div>
              <div style={{ color: C.inkMuted, padding: '4px', display: 'flex', justifyContent: 'center', width: '32px' }}>
                <ChevronRight size={22} />
              </div>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="flex items-end justify-between gap-2">
              <div className="flex items-end gap-2 min-w-0">
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '44px', fontWeight: 600, lineHeight: 1 }}>
                  {loading ? '…' : Math.round(totals.kcal)}
                </span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '16px', color: C.inkMuted, marginBottom: '6px' }}>
                  / {target.kcal} kcal
                </span>
              </div>
              <span
                style={{
                  color: C.inkMuted,
                  background: C.surfaceRaised,
                  border: `1px solid ${C.line}`,
                  borderRadius: '8px',
                  padding: '6px 10px',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  flexShrink: 0,
                  marginBottom: '4px',
                }}
              >
                <SlidersHorizontal size={12} /> Obiettivi
              </span>
            </div>
            <div style={{ marginTop: '4px' }}>
              <span style={{ fontSize: '13px', color: loading ? C.inkMuted : (overTarget ? C.alert : C.good) }}>
                {loading
                  ? 'Carico…'
                  : overTarget
                    ? `Superato di ${Math.round(-remaining)} kcal`
                    : `Restano ${Math.round(remaining)} kcal`}
              </span>
            </div>
          </div>

          <div style={{ flexShrink: 0, height: 8, marginTop: 14 }}>
            <div style={{ height: '8px', borderRadius: '999px', background: line, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(pct, 1) * 100}%`, height: '100%',
                background: overTarget ? C.alert : C.good, borderRadius: '999px',
              }} />
              {overTarget && (
                <div style={{ position: 'absolute', left: '100%', top: 0, height: '100%', width: `${Math.min(pct - 1, 0.25) * 100}%`, background: C.alert, opacity: 0.5 }} />
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '22px',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              background: surf,
              border: `1px solid ${line}`,
              borderRadius: '14px',
              padding: '18px 22px',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minHeight: 0,
            }}
          >
            <div className="flex items-center" style={{ justifyContent: 'space-around' }}>
              {quickActions.map((btn) => (
                <div key={btn.id} className="flex flex-col items-center" style={{ gap: '8px' }}>
                  <div
                    style={{
                      width: '56px', height: '56px', borderRadius: '999px',
                      border: `1px solid ${C.line}`,
                      background: C.surfaceRaised,
                      color: C.ink,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {btn.icon}
                  </div>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', color: C.inkMuted, letterSpacing: '0.06em' }}>
                    {btn.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              background: surf,
              border: `1px solid ${line}`,
              borderRadius: '14px',
              padding: '22px',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minHeight: 0,
            }}
          >
            <span style={{ fontSize: '12px', color: C.inkMuted }}>Macronutrienti</span>
            <div className="flex items-center gap-4 mt-3">
              <div style={{ width: '110px', height: '110px', position: 'relative', flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={macroCalData} dataKey="cal" innerRadius={34} outerRadius={52} startAngle={90} endAngle={-270} stroke="none">
                      {macroCalData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UtensilsCrossed size={18} color={C.inkFaint} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
                <MacroRow icon={<Beef size={14} color={C.protein} />} label="Proteine" grams={totals.proteine} target={target.proteine} color={C.protein} />
                <MacroRow icon={<Wheat size={14} color={C.carbs} />} label="Carboidrati" grams={totals.carboidrati} target={target.carboidrati} color={C.carbs} />
                <MacroRow icon={<Droplet size={14} color={C.fat} />} label="Grassi" grams={totals.grassi} target={target.grassi} color={C.fat} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: surf, border: `1px solid ${line}`, borderRadius: '14px', padding: '20px' }}>
        <span style={{ fontSize: '12px', color: C.inkMuted }}>
          {diaryMealsHeading(offset, date)} · {meals.length}
        </span>
        {error && (
          <div style={{ color: C.alert, fontSize: '12px', marginTop: '8px' }}>{error}</div>
        )}
        {!error && grouped.length === 0 && (
          <div style={{ color: C.inkFaint, fontSize: '13px', marginTop: '10px' }}>
            {loading ? 'Carico il giorno…' : 'Nessun pasto registrato in questo giorno.'}
          </div>
        )}
        {grouped.map((g) => (
          <div key={g.pasto} style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: C.inkMuted, letterSpacing: '0.06em', marginBottom: '4px' }}>
              {PASTO_LABEL[g.pasto] || g.pasto}
            </div>
            {g.items.map((m) => (
              <div key={m.id} style={{ fontSize: '13px', padding: '6px 0', borderBottom: `1px solid ${line}`, display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.alimento}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.inkMuted, flexShrink: 0 }}>{Math.round(m.kcal)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ripartizione macro come percentuali (Deploy 5 §7.2).
// Il target salvato resta in grammi {kcal, proteine, carboidrati, grassi};
// nell'editor lo pilotiamo però come split percentuale che somma SEMPRE a 100.
// P/C valgono 4 kcal/g, G vale 9 kcal/g.
// ---------------------------------------------------------------------------
const toNum = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// Arrotonda {p,c,g} a interi che sommano ESATTAMENTE a 100 (metodo del resto
// più grande): floor di ciascuno, poi i punti mancanti vanno alle frazioni
// più alte.
function normalize100({ p, c, g }) {
  const raw = [p, c, g];
  const floor = raw.map((v) => Math.floor(v));
  let rem = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, f: v - floor[i] }))
    .sort((a, b) => b.f - a.f);
  const out = [...floor];
  for (let k = 0; k < rem; k++) out[order[k % 3].i] += 1;
  return { p: out[0], c: out[1], g: out[2] };
}

// Percentuali (somma 100) a partire dai grammi salvati. Se i macro non hanno
// calorie (target vuoto) ripiega su una ripartizione neutra 34/33/33.
function pctFromGrams(t) {
  const kP = toNum(t.proteine) * 4;
  const kC = toNum(t.carboidrati) * 4;
  const kG = toNum(t.grassi) * 9;
  const sum = kP + kC + kG;
  if (sum <= 0) return { p: 34, c: 33, g: 33 };
  return normalize100({ p: (kP / sum) * 100, c: (kC / sum) * 100, g: (kG / sum) * 100 });
}

const MACRO_KEYS = { p: 'proteine', c: 'carboidrati', g: 'grassi' };
const MACRO_FACTOR = { p: 4, c: 4, g: 9 };

// % di un macro rispetto alle kcal target (non normalizzata sugli altri).
function pctFromGramsVsKcal(grams, factor, kcal) {
  const k = toNum(kcal);
  if (k <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((toNum(grams) * factor / k) * 100)));
}

function gramsFromPctOne(pct, factor, kcal) {
  const k = toNum(kcal);
  const p = Math.max(0, Math.min(100, Math.round(toNum(pct))));
  return Math.max(0, Math.round(((p / 100) * k) / factor));
}

// ---------------------------------------------------------------------------

export default function VoiceTrackDashboard() {
  const [config, setConfig] = useState({ apiUrl: '', apiKey: '' });
  const [configDraft, setConfigDraft] = useState({ apiUrl: '', apiKey: '' });
  const [configOpen, setConfigOpen] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | demo | live | error
  const [errorMsg, setErrorMsg] = useState('');
  const [meals, setMeals] = useState(DEMO_MEALS_TODAY);
  const [week, setWeek] = useState(DEMO_WEEK);
  const [month, setMonth] = useState(DEMO_MONTH);
  const [year, setYear] = useState(DEMO_YEAR);
  const [trendRange, setTrendRange] = useState('week'); // week | month | year
  const [target, setTarget] = useState(DEMO_TARGET);
  const [storageReady, setStorageReady] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targetsMounted, setTargetsMounted] = useState(false);
  const [targetsAnimOpen, setTargetsAnimOpen] = useState(false);
  const targetsCloseTimerRef = useRef(null);
  const targetsMountedRef = useRef(false);
  targetsMountedRef.current = targetsMounted;
  const [targetDraft, setTargetDraft] = useState(DEMO_TARGET);
  const [savingTargets, setSavingTargets] = useState(false);
  const [targetMsg, setTargetMsg] = useState('');
  const [lastSync, setLastSync] = useState(null);
  // Ripartizione macro (%) mentre l'editor Obiettivi è aperto (indipendenti).
  // Inizializzata dai grammi all'apertura; i grammi precisi restano in targetDraft.
  const [macroPct, setMacroPct] = useState(() => pctFromGrams(DEMO_TARGET));

  // --- Tab attivo: 'diario' (dashboard) | 'traccia' (voce) ---
  const [view, setView] = useState('diario');

  // --- Sfoglia diario: 0 = oggi, -1 = ieri, +1 = domani (nessun tetto). ---
  const [dayOffset, setDayOffset] = useState(0);
  // Cache pasti per giorni ≠ oggi (chiave YYYY-MM-DD) — include prefetch adiacenti.
  const [dayCache, setDayCache] = useState({});
  // Bump per rieseguire il loader dei giorni passati dopo edit/delete (§5.2 del piano).
  const [historyTick, setHistoryTick] = useState(0);

  // Carosello giorno (stesso pattern del carosello tab): drag + settle.
  const dayPagerRef = useRef(null);
  const dayTrackRef = useRef(null);
  const daySwipeRef = useRef(null);
  const dayDragXRef = useRef(0);
  const dayPendingCommitRef = useRef(null);
  const [dayDragX, setDayDragX] = useState(0);
  const [dayDragging, setDayDragging] = useState(false);

  // --- Edit / delete pasti (Deploy 5 §7.2) ---
  const [editingId, setEditingId] = useState(null);        // id del pasto col pannello aperto
  const [editDraft, setEditDraft] = useState(null);        // { alimento, grammi, kcal, proteine, carboidrati, grassi }
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null); // id in attesa di conferma elimina
  const [confirmEditId, setConfirmEditId] = useState(null);     // id in attesa di conferma modifica (swipe)
  const [swipeId, setSwipeId] = useState(null);            // riga trascinata
  const [swipeX, setSwipeX] = useState(0);                 // offset corrente (px, ±SWIPE_MAX)
  const suppressRowClickRef = useRef(false);                // evita che il click sintetico post-touch riapra il pannello appena chiuso

  const POLL_MS = 20000; // refresh dati ogni 20s mentre l'app e' aperta e visibile

  const fetchLive = useCallback(async (cfg, silent = false) => {
    if (!silent) setStatus('loading');
    setErrorMsg('');
    try {
      const base = cfg.apiUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/dashboard`, {
        headers: cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {},
      });
      if (!res.ok) throw new Error(`Risposta ${res.status} dal server`);
      const json = await res.json();
      const loadedTarget = json?.target ?? DEMO_TARGET;
      const nextMeals = json?.oggi?.pasti ?? [];
      const nextWeek = json?.storico_settimanale ?? DEMO_WEEK;
      const nextMonth = json?.storico_mensile ?? DEMO_MONTH;
      const nextYear = json?.storico_annuale ?? DEMO_YEAR;
      setMeals(nextMeals);
      setWeek(nextWeek);
      setMonth(nextMonth);
      setYear(nextYear);
      setTarget(loadedTarget);
      setTargetDraft((prev) => (targetsOpen ? prev : loadedTarget));
      setStatus('live');
      setLastSync(new Date());
      // Salva l'ultimo dato buono in cache: al prossimo reload lo mostriamo
      // subito (istantaneo) mentre la Cloud Function esce dal cold start.
      try {
        await storage.set('vt-cache', JSON.stringify({
          meals: nextMeals, week: nextWeek, month: nextMonth, year: nextYear,
          target: loadedTarget, at: Date.now(),
        }));
      } catch (e) {}
    } catch (e) {
      // In un refresh silenzioso non buttiamo giu' l'app sui dati demo:
      // teniamo l'ultimo dato buono e segnaliamo solo l'errore.
      if (!silent) {
        setMeals(DEMO_MEALS_TODAY);
        setWeek(DEMO_WEEK);
        setMonth(DEMO_MONTH);
        setYear(DEMO_YEAR);
        setTarget(DEMO_TARGET);
        setStatus('error');
      }
      setErrorMsg(e.message || 'Impossibile raggiungere il backend');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsOpen]);

  // Pannello Obiettivi: montato durante exit così altezza/opacità possono chiudersi.
  // Hero a slot fissi (data | medio | gauge): il readout resta nello slot medio e
  // riappare solo dopo lo smontaggio (niente spacer flex-grow / drift verticale).
  useEffect(() => {
    if (targetsCloseTimerRef.current) {
      clearTimeout(targetsCloseTimerRef.current);
      targetsCloseTimerRef.current = null;
    }
    if (targetsOpen) {
      setTargetsMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setTargetsAnimOpen(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    if (targetsMountedRef.current) {
      setTargetsAnimOpen(false);
      targetsCloseTimerRef.current = setTimeout(() => {
        setTargetsMounted(false);
        targetsCloseTimerRef.current = null;
      }, 300);
    }
    return () => {
      if (targetsCloseTimerRef.current) {
        clearTimeout(targetsCloseTimerRef.current);
        targetsCloseTimerRef.current = null;
      }
    };
  }, [targetsOpen]);

  // Evita il flash della scrollbar di pagina mentre Obiettivi apre/è aperto,
  // senza maxHeight sulla fold (che costringeva a scorrere dentro la scheda).
  useEffect(() => {
    if (!targetsMounted) return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [targetsMounted]);

  // --app-height da visualViewport: su Android PWA 100dvh al refresh diventa più alto
  // (include gesture bar) e slarga il fold. Lo script in index.html fa il primo set;
  // qui teniamo i listener anche dopo il mount React.
  useEffect(() => {
    const setAppHeight = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
    };
    setAppHeight();
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);
    window.addEventListener('pageshow', setAppHeight);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', setAppHeight);
    vv?.addEventListener('scroll', setAppHeight);
    return () => {
      window.removeEventListener('resize', setAppHeight);
      window.removeEventListener('orientationchange', setAppHeight);
      window.removeEventListener('pageshow', setAppHeight);
      vv?.removeEventListener('resize', setAppHeight);
      vv?.removeEventListener('scroll', setAppHeight);
    };
  }, []);

  // Load saved endpoint config on mount.
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get('vt-config');
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setConfig(parsed);
          setConfigDraft(parsed);
          if (parsed.apiUrl) {
            // Mostra subito gli ultimi dati reali salvati (istantaneo), poi
            // aggiorna in background. Cosi' al reload non vedi i dati demo
            // durante i ~5-10s di cold start della Cloud Function.
            let hasCache = false;
            try {
              const cached = await storage.get('vt-cache');
              if (cached && cached.value) {
                const c = JSON.parse(cached.value);
                if (Array.isArray(c.meals)) setMeals(c.meals);
                if (Array.isArray(c.week)) setWeek(c.week);
                if (Array.isArray(c.month)) setMonth(c.month);
                if (Array.isArray(c.year)) setYear(c.year);
                if (c.target) setTarget(c.target);
                setStatus('live');
                hasCache = true;
              }
            } catch (e) {}
            try {
              const dayHydrated = await loadPersistedDayCache();
              if (Object.keys(dayHydrated).length) setDayCache(dayHydrated);
            } catch (e) {}
            await fetchLive(parsed, hasCache); // silent=true se avevamo gia' la cache
          } else {
            setStatus('demo');
          }
        } else {
          setStatus('demo');
        }
      } catch (e) {
        setStatus('demo');
      } finally {
        setStorageReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh: mentre l'app e' aperta e in primo piano, ricarica ogni 20s.
  // Quando va in background il polling si ferma (niente chiamate sprecate);
  // al ritorno in primo piano ricarica subito, cosi' dopo aver parlato a
  // Tasker ritrovi i dati aggiornati appena riapri VoiceTrack.
  useEffect(() => {
    if (!config.apiUrl) return; // solo in modalita' live

    let timer = null;

    const startPolling = () => {
      stopPolling();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchLive(config, true); // silent: nessun flicker di caricamento
        }
      }, POLL_MS);
    };
    const stopPolling = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchLive(config, true); // ricarica subito al ritorno in primo piano
        startPolling();
      } else {
        stopPolling();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') startPolling();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.apiUrl, config.apiKey, fetchLive]);

  const saveConfig = async () => {
    try {
      await storage.set('vt-config', JSON.stringify(configDraft));
    } catch (e) {
      // storage failure shouldn't block using the app this session
    }
    setConfig(configDraft);
    setConfigOpen(false);
    if (configDraft.apiUrl) {
      await fetchLive(configDraft);
    } else {
      setStatus('demo');
    }
  };

  const useDemo = async () => {
    try {
      await storage.delete('vt-config');
    } catch (e) {}
    setConfig({ apiUrl: '', apiKey: '' });
    setConfigDraft({ apiUrl: '', apiKey: '' });
    setMeals(DEMO_MEALS_TODAY);
    setWeek(DEMO_WEEK);
    setMonth(DEMO_MONTH);
    setYear(DEMO_YEAR);
    setTarget(DEMO_TARGET);
    setStatus('demo');
    setConfigOpen(false);
  };

  const saveTargets = async () => {
    // Macro indipendenti: si salva solo con ripartizione al 100%. I grammi
    // restano quelli in bozza (digitati / ±1), non ricalcolati dallo split %.
    if (macroPct.p + macroPct.c + macroPct.g !== 100) {
      setTargetMsg('Serve una ripartizione al 100% per salvare');
      return;
    }
    const kcal = Number(targetDraft.kcal) || DEMO_TARGET.kcal;
    const clean = {
      kcal,
      proteine: Math.round(toNum(targetDraft.proteine)),
      carboidrati: Math.round(toNum(targetDraft.carboidrati)),
      grassi: Math.round(toNum(targetDraft.grassi)),
    };
    // Live: salva sul backend nella tab Config
    if (config.apiUrl) {
      setSavingTargets(true);
      setTargetMsg('');
      try {
        const base = config.apiUrl.replace(/\/$/, '');
        const res = await fetch(`${base}/config`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
          },
          body: JSON.stringify({ target: clean }),
        });
        if (!res.ok) throw new Error(`Risposta ${res.status}`);
        const json = await res.json();
        const saved = json?.target ?? clean;
        setTarget(saved);
        setTargetDraft(saved);
        setTargetMsg('Obiettivi salvati sul foglio');
        setTargetsOpen(false);
      } catch (e) {
        setTargetMsg(`Errore nel salvataggio: ${e.message}`);
      } finally {
        setSavingTargets(false);
      }
    } else {
      // Demo: solo stato locale
      setTarget(clean);
      setTargetDraft(clean);
      setTargetMsg('Salvato (demo — non persistito)');
      setTargetsOpen(false);
    }
  };

  // =========================================================================
  // TAB "TRACCIA" — voce nella PWA (Deploy 3)
  // Stati del microfono: idle → listening → processing → speaking → idle
  // =========================================================================
  const [micState, setMicState] = useState('idle');
  const [transcript, setTranscript] = useState('');     // trascrizione live a schermo
  const [trackResult, setTrackResult] = useState(null); // ultimo pasto registrato
  const [trackError, setTrackError] = useState('');
  const [clarifyQuestion, setClarifyQuestion] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);

  const recognitionRef = useRef(null);
  const pendingTextRef = useRef('');   // testo accumulato in attesa di chiarimento
  const clarifyRoundsRef = useRef(0);
  const activeLogDateRef = useRef(''); // YYYY-MM-DD bloccata all'avvio del flusso di log
  const voiceRef = useRef(null);       // voce italiana per SpeechSynthesis
  const pendingActionRef = useRef(null); // 'text' | 'voice' | 'scan' | 'cerca' | null
  const typedInputRef = useRef(null);
  const searchInputRef = useRef(null);

  const speechSupported = !!SpeechRecognitionAPI && typeof window.speechSynthesis !== 'undefined';

  // getVoices() e' asincrono su Chrome: la lista arriva con 'voiceschanged'.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices() || [];
      voiceRef.current =
        voices.find((v) => v.lang === 'it-IT') ||
        voices.find((v) => (v.lang || '').toLowerCase().startsWith('it')) ||
        null;
    };
    pickVoice();
    window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', pickVoice);
  }, []);

  // Warm-up anti cold start (§3.2 del Piano): Diario / Traccia / Scan
  // pingano /health cosi' swipe giorno e log non pagano il cold start.
  useEffect(() => {
    if ((view !== 'diario' && view !== 'traccia' && view !== 'scan') || !config.apiUrl) return;
    const base = config.apiUrl.replace(/\/$/, '');
    fetch(`${base}/health`).catch(() => {});
  }, [view, config.apiUrl]);

  // Uscendo dal tab (o smontando l'app): ferma tutto, pulito.
  useEffect(() => {
    if (view === 'traccia') return;
    try { recognitionRef.current?.abort?.(); } catch (e) {}
    try { window.speechSynthesis?.cancel(); } catch (e) {}
    setMicState('idle');
    setSummaryBusy(false);
  }, [view]);

  const speak = useCallback((text, onEnd) => {
    if (!text || !window.speechSynthesis) { onEnd && onEnd(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'it-IT';
      if (voiceRef.current) u.voice = voiceRef.current;
      u.onend = () => onEnd && onEnd();
      u.onerror = () => onEnd && onEnd();
      window.speechSynthesis.speak(u);
    } catch (e) {
      onEnd && onEnd();
    }
  }, []);

  const getDiaryDateStr = useCallback(() => fmtYMD(dateForOffset(dayOffset)), [dayOffset]);
  const beginLogFlow = useCallback(() => {
    // Ri-aggancia sempre il giorno attivo: un flusso abbandonato non deve
    // lasciare una data vecchia nel latch. I passi successivi (chiarimenti
    // voce, grammi scan) non ripassano di qui e conservano la data del primo step.
    activeLogDateRef.current = getDiaryDateStr();
    return activeLogDateRef.current;
  }, [getDiaryDateStr]);
  const clearLogFlow = useCallback(() => {
    activeLogDateRef.current = '';
  }, []);
  const getTargetDateForLog = useCallback(
    () => activeLogDateRef.current || getDiaryDateStr(),
    [getDiaryDateStr],
  );
  const refreshAfterLog = useCallback((targetStr) => {
    // Aggiorna il giorno su cui il log e' finito davvero (puo' differire dal
    // latch Diario se la voce ha detto "ieri" / una data).
    const t = targetStr || activeLogDateRef.current || getDiaryDateStr();
    const todayStr = fmtYMD(new Date());

    // Porta il Diario sul giorno dichiarato (voce batte il giorno a schermo).
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
      const [y, m, d] = t.split('-').map(Number);
      const targetDate = new Date(y, m - 1, d);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      targetDate.setHours(0, 0, 0, 0);
      const nextOffset = Math.round((targetDate - today) / 86400000);
      if (nextOffset !== dayOffset) {
        dayPendingCommitRef.current = null;
        setDayDragging(true);
        setDayDragX(0);
        dayDragXRef.current = 0;
        setDayOffset(nextOffset);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setDayDragging(false));
        });
      }
    }

    // Oggi via dashboard; giorni passati: invalida dayCache + historyTick.
    fetchLive(config, true);
    if (t && t !== todayStr) {
      setDayCache((prev) => {
        const next = { ...prev };
        delete next[t];
        return next;
      });
      removePersistedDay(t);
      setHistoryTick((tick) => tick + 1);
    }
  }, [dayOffset, config, fetchLive, getDiaryDateStr]);

  const submitMeal = useCallback(async (spokenText, isClarification, viaVoice = true) => {
    setMicState('processing');
    setTrackError('');
    if (!isClarification) beginLogFlow();

    // Convenzione §3.4: backend stateless → al chiarimento rimandiamo
    // testo originale + risposta concatenati ("un piatto di pasta, 300 grammi").
    const fullText = isClarification && pendingTextRef.current
      ? `${pendingTextRef.current}${CLARIFY_JOIN}${spokenText}`
      : spokenText;
    const targetDate = getTargetDateForLog();

    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/log_meal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
        },
        body: JSON.stringify({
          text: fullText,
          fonte: viaVoice ? 'pwa-voce' : 'pwa-testo',
          target_date: targetDate,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error(`Risposta ${res.status} dal server`);

      if (json.status === 'needs_clarification') {
        clarifyRoundsRef.current += 1;
        if (clarifyRoundsRef.current > MAX_CLARIFY_ROUNDS) {
          pendingTextRef.current = '';
          clarifyRoundsRef.current = 0;
          clearLogFlow();
          setClarifyQuestion('');
          setTrackError('Troppi chiarimenti di fila: riprova descrivendo il pasto con le quantita\u0300 in grammi.');
          setMicState('idle');
          return;
        }
        pendingTextRef.current = fullText;
        const question = json.riepilogo_vocale || json.message || 'Puoi specificare la quantit\u00e0?';
        setClarifyQuestion(question);
        if (viaVoice) {
          // Loop chiarimento vocale: prima parla, POI riapre il microfono su onend.
          setMicState('speaking');
          speak(question, () => startListening(true));
        } else {
          // Input digitato: la domanda resta a schermo, si risponde scrivendo (o col mic).
          setMicState('idle');
        }
        return;
      }

      if (json.status === 'ok') {
        pendingTextRef.current = '';
        clarifyRoundsRef.current = 0;
        clearLogFlow();
        setClarifyQuestion('');
        setTrackResult(json);
        if (viaVoice) {
          const summary = json.riepilogo_vocale || 'Pasto registrato.';
          setMicState('speaking');
          speak(summary, () => setMicState('idle'));
        } else {
          setMicState('idle');
        }
        // Aggiorna il giorno mostrato: priorita' a data_dichiarata dal backend.
        refreshAfterLog(json.data_dichiarata || targetDate);
        return;
      }

      // status === 'error' (o inatteso) dal backend
      clearLogFlow();
      const msg = json.riepilogo_vocale || json.message || 'Errore dal server.';
      setTrackError(json.message || msg);
      if (viaVoice) {
        setMicState('speaking');
        speak(msg, () => setMicState('idle'));
      } else {
        setMicState('idle');
      }
    } catch (e) {
      pendingTextRef.current = '';
      clarifyRoundsRef.current = 0;
      clearLogFlow();
      setClarifyQuestion('');
      setTrackError(e.message || 'Impossibile raggiungere il backend');
      setMicState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, speak, beginLogFlow, clearLogFlow, getTargetDateForLog, refreshAfterLog]);

  const startListening = useCallback((isClarification = false) => {
    if (!SpeechRecognitionAPI) return;
    try { window.speechSynthesis?.cancel(); } catch (e) {}

    const rec = new SpeechRecognitionAPI();
    rec.lang = 'it-IT'; // hardcoded: mai piu' riconoscimento in francese
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = '';
    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      setTranscript((finalText + interim).trim());
    };
    rec.onend = () => {
      recognitionRef.current = null;
      const said = finalText.trim();
      if (said) {
        submitMeal(said, isClarification);
      } else {
        // Nessun parlato catturato: se eravamo in un chiarimento, non
        // buttiamo via il testo originale — si puo' ritoccare il mic.
        setMicState('idle');
      }
    };
    rec.onerror = (event) => {
      recognitionRef.current = null;
      if (event.error === 'no-speech' || event.error === 'aborted') {
        setMicState('idle');
        return;
      }
      const msg = event.error === 'not-allowed'
        ? 'Permesso microfono negato: abilitalo nelle impostazioni del browser.'
        : `Errore riconoscimento vocale: ${event.error}`;
      setTrackError(msg);
      setMicState('idle');
    };

    recognitionRef.current = rec;
    setTranscript('');
    setTrackError('');
    if (!isClarification) {
      clearLogFlow();
      setTrackResult(null);
      setClarifyQuestion('');
      pendingTextRef.current = '';
      clarifyRoundsRef.current = 0;
    }
    setMicState('listening');
    try {
      rec.start();
    } catch (e) {
      setMicState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitMeal, clearLogFlow]);

  const onMicTap = useCallback(() => {
    if (micState === 'listening') {
      // Secondo tocco = "ho finito di parlare": chiude e invia (onend fa il resto).
      try { recognitionRef.current?.stop(); } catch (e) {}
      return;
    }
    if (micState !== 'idle') return; // processing/speaking: ignora i tocchi
    // Se c'era un chiarimento in sospeso, il tocco riapre il mic per rispondere.
    startListening(!!pendingTextRef.current);
  }, [micState, startListening]);

  // --- Input digitato: stessa pipeline della voce, fonte = pwa-testo ---
  const [typedText, setTypedText] = useState('');

  // Overlay CERCA (catalogo + OFF) — fuori dal carosello, così focus/layout non sfasano i tab
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchProduct, setSearchProduct] = useState(null); // item selezionato
  const [searchQty, setSearchQty] = useState('');
  const [searchLogBusy, setSearchLogBusy] = useState(false);
  const [searchResult, setSearchResult] = useState(null); // esito log_catalog
  const [searchQtyListening, setSearchQtyListening] = useState(false);
  const [searchDragY, setSearchDragY] = useState(0);
  const [searchDragging, setSearchDragging] = useState(false);
  const searchDebounceRef = useRef(null);
  const searchQtyRecRef = useRef(null);
  const searchDismissRef = useRef(null);
  const searchDragYRef = useRef(0);

  // Scan not_found → form aggiungi al catalogo
  const [catalogFormOpen, setCatalogFormOpen] = useState(false);
  const [catalogForm, setCatalogForm] = useState({ nome: '', kcal: '', proteine: '', carboidrati: '', grassi: '' });
  const [catalogFormBusy, setCatalogFormBusy] = useState(false);
  const [catalogFormMsg, setCatalogFormMsg] = useState('');
  const [scanBarcodeForCatalog, setScanBarcodeForCatalog] = useState('');

  // Diario → salva in catalogo (overlay fuori dal carosello)
  const [saveCatalogMeal, setSaveCatalogMeal] = useState(null); // meal | null
  const [saveCatalogForm, setSaveCatalogForm] = useState(null);
  const [saveCatalogBusy, setSaveCatalogBusy] = useState(false);
  const [saveCatalogMsg, setSaveCatalogMsg] = useState('');
  const saveCatalogNomeRef = useRef(null);

  // Indice catalogo per stelline Diario + toggle preferiti CERCA
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogStarBusyId, setCatalogStarBusyId] = useState(null);
  const [toast, setToast] = useState(null); // { message } | null
  const toastTimerRef = useRef(null);

  const submitTyped = useCallback(() => {
    const t = typedText.trim();
    if (!t || micState !== 'idle') return;
    setTypedText('');
    setTranscript('');
    const isClarification = !!pendingTextRef.current;
    if (!isClarification) {
      setTrackResult(null);
      setClarifyQuestion('');
      clarifyRoundsRef.current = 0;
    }
    submitMeal(t, isClarification, false);
  }, [typedText, micState, submitMeal]);

  // Definita prima dei flussi CERCA/scan che la richiamano nei success path.
  const fetchCatalog = useCallback(async () => {
    if (!config.apiUrl) {
      setCatalogItems([]);
      return;
    }
    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/catalog`, {
        headers: config.apiKey ? { 'X-API-Key': config.apiKey } : {},
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.status !== 'ok') return;
      setCatalogItems(json.items || []);
    } catch (e) {
      // silenzioso: le stelline restano vuote se il catalogo non risponde
    }
  }, [config]);

  const runSearch = useCallback(async (q) => {
    if (!config.apiUrl) return;
    setSearchBusy(true);
    setSearchError('');
    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
        },
        body: JSON.stringify({ q: q || '' }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.status !== 'ok') {
        throw new Error(json?.message || `Risposta ${res.status}`);
      }
      setSearchResults(json.items || []);
    } catch (e) {
      setSearchError(e.message || 'Ricerca non riuscita');
      setSearchResults([]);
    } finally {
      setSearchBusy(false);
    }
  }, [config]);

  const scheduleSearch = useCallback((q) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => runSearch(q), 280);
  }, [runSearch]);

  const resetCerca = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchError('');
    setSearchProduct(null);
    setSearchQty('');
    setSearchResult(null);
    setSearchLogBusy(false);
    setSearchBusy(false);
    try { searchQtyRecRef.current?.abort?.(); } catch (e) {}
    setSearchQtyListening(false);
  }, []);

  const closeSearch = useCallback(() => {
    clearLogFlow();
    setSearchOpen(false);
    setSearchDragY(0);
    setSearchDragging(false);
    searchDragYRef.current = 0;
    searchDismissRef.current = null;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    try { searchQtyRecRef.current?.abort?.(); } catch (e) {}
    setSearchQtyListening(false);
    try { recognitionRef.current?.abort?.(); } catch (e) {}
    setMicState((s) => (s === 'listening' ? 'idle' : s));
  }, [clearLogFlow]);

  const openSearch = useCallback(() => {
    resetCerca();
    setSearchDragY(0);
    setSearchDragging(false);
    searchDragYRef.current = 0;
    searchDismissRef.current = null;
    setSearchOpen(true);
  }, [resetCerca]);

  // Swipe verso il basso dalla cima dell'overlay → chiude (come sheet iOS).
  const SEARCH_DISMISS_MIN = 100;
  const onSearchDismissStart = useCallback((e) => {
    if (e.target.closest?.('button, input, textarea, select, a')) {
      searchDismissRef.current = null;
      return;
    }
    searchDismissRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      axis: null,
    };
  }, []);

  const onSearchDismissMove = useCallback((e) => {
    const s = searchDismissRef.current;
    if (!s) return;
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.axis = Math.abs(dy) > Math.abs(dx) * 1.05 ? 'y' : 'x';
      if (s.axis !== 'y' || dy < 0) {
        searchDismissRef.current = null;
        return;
      }
      setSearchDragging(true);
    }
    if (s.axis !== 'y') return;
    const y = Math.max(0, dy);
    searchDragYRef.current = y;
    setSearchDragY(y);
  }, []);

  const onSearchDismissEnd = useCallback(() => {
    const s = searchDismissRef.current;
    searchDismissRef.current = null;
    if (!s || s.axis !== 'y') {
      setSearchDragging(false);
      setSearchDragY(0);
      searchDragYRef.current = 0;
      return;
    }
    if (searchDragYRef.current >= SEARCH_DISMISS_MIN) {
      closeSearch();
      return;
    }
    setSearchDragging(false);
    setSearchDragY(0);
    searchDragYRef.current = 0;
  }, [closeSearch]);

  const selectSearchProduct = useCallback((item) => {
    setSearchProduct(item);
    setSearchQty('');
    setSearchResult(null);
    setSearchError('');
  }, []);

  const confirmSearchQty = useCallback(async () => {
    const n = parseFloat(String(searchQty).replace(',', '.'));
    if (!searchProduct || !Number.isFinite(n) || n <= 0 || searchLogBusy) return;
    beginLogFlow();
    setSearchLogBusy(true);
    setSearchError('');
    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const targetDate = getTargetDateForLog();
      const body = {
        grammi: n,
        fonte: 'pwa-catalogo',
        target_date: targetDate,
      };
      if (searchProduct.id) body.catalog_id = searchProduct.id;
      if (searchProduct.barcode) body.barcode = searchProduct.barcode;
      if (searchProduct.off_code) body.off_code = searchProduct.off_code;
      // Prodotto non ancora in catalogo (arriva da OFF): i valori li abbiamo
      // gia' dalla ricerca appena fatta, evitiamo un secondo fetch OFF lato
      // backend (causa nota di "failed to fetch" con OFF lento / cold start).
      if (!searchProduct.id && searchProduct.per_100g) {
        body.nome = searchProduct.nome;
        body.per_100g = searchProduct.per_100g;
      }

      const res = await fetch(`${base}/log_catalog`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!json || json.status !== 'ok') {
        throw new Error(json?.message || json?.riepilogo_vocale || `Risposta ${res.status}`);
      }
      setSearchResult(json);
      setSearchProduct(null);
      setSearchQty('');
      clearLogFlow();
      speak(json.riepilogo_vocale || 'Prodotto registrato.');
      refreshAfterLog(json.data_dichiarata || targetDate);
      runSearch(searchQuery);
      // Il backend ha fatto upsert/bump nel catalogo: riallinea stelline e conteggi.
      fetchCatalog();
    } catch (e) {
      setSearchError(e.message || 'Registrazione non riuscita');
    } finally {
      setSearchLogBusy(false);
    }
  }, [searchQty, searchProduct, searchLogBusy, config, speak, runSearch, searchQuery, beginLogFlow, getTargetDateForLog, clearLogFlow, refreshAfterLog, fetchCatalog]);

  const listenSearchQty = useCallback(() => {
    if (!SpeechRecognitionAPI || searchQtyListening || !searchProduct) return;
    try { window.speechSynthesis?.cancel(); } catch (e) {}
    const rec = new SpeechRecognitionAPI();
    rec.lang = 'it-IT';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const said = event.results?.[0]?.[0]?.transcript || '';
      const m = said.replace(',', '.').match(/\d+(\.\d+)?/);
      if (m) setSearchQty(m[0]);
    };
    rec.onend = () => { searchQtyRecRef.current = null; setSearchQtyListening(false); };
    rec.onerror = () => { searchQtyRecRef.current = null; setSearchQtyListening(false); };
    searchQtyRecRef.current = rec;
    setSearchQtyListening(true);
    try { rec.start(); } catch (e) { setSearchQtyListening(false); }
  }, [searchQtyListening, searchProduct]);

  const listenSearchQuery = useCallback(() => {
    if (!SpeechRecognitionAPI || micState !== 'idle') return;
    try { window.speechSynthesis?.cancel(); } catch (e) {}
    const rec = new SpeechRecognitionAPI();
    rec.lang = 'it-IT';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const said = (event.results?.[0]?.[0]?.transcript || '').trim();
      if (said) {
        setSearchQuery(said);
        runSearch(said);
      }
    };
    recognitionRef.current = rec;
    setMicState('listening');
    rec.onend = () => { setMicState('idle'); recognitionRef.current = null; };
    rec.onerror = () => { setMicState('idle'); recognitionRef.current = null; };
    try { rec.start(); } catch (e) { setMicState('idle'); }
  }, [micState, runSearch]);

  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    if (config.apiUrl) fetchCatalog();
  }, [config.apiUrl, config.apiKey, fetchCatalog]);

  const findCatalogForAlimento = useCallback((alimento) => {
    const key = normalizeFoodName(alimento);
    if (!key || catalogItems.length === 0) return null;
    const matches = catalogItems.filter((e) => {
      if (normalizeFoodName(e.nome) === key) return true;
      const aliases = String(e.alias || '').split(/[,;|]/).map(normalizeFoodName).filter(Boolean);
      return aliases.includes(key);
    });
    if (matches.length === 0) return null;
    return matches.find((m) => m.preferito) || matches[0];
  }, [catalogItems]);

  const postCatalog = useCallback(async (payload) => {
    const base = config.apiUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/catalog`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.status !== 'ok') {
      throw new Error(json?.message || `Risposta ${res.status}`);
    }
    return json;
  }, [config]);

  const patchCatalogLocal = useCallback((id, patch) => {
    setCatalogItems((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setSearchResults((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setSearchProduct((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  const removeCatalogLocal = useCallback((id) => {
    setCatalogItems((prev) => prev.filter((e) => e.id !== id));
    setSearchResults((prev) => prev.filter((e) => e.id !== id));
    setSearchProduct((prev) => (prev && prev.id === id ? null : prev));
  }, []);

  const toggleCatalogPreferito = useCallback(async (entry) => {
    if (!entry?.id || catalogStarBusyId) return;
    const nextPreferito = !entry.preferito;
    setCatalogStarBusyId(entry.id);
    try {
      await postCatalog({ id: entry.id, action: nextPreferito ? 'star' : 'unstar' });
      patchCatalogLocal(entry.id, { preferito: nextPreferito });
      showToast(nextPreferito ? 'Aggiunto ai preferiti' : 'Rimosso dai preferiti');
    } catch (e) {
      showToast(e.message || 'Operazione non riuscita');
    } finally {
      setCatalogStarBusyId(null);
    }
  }, [catalogStarBusyId, postCatalog, patchCatalogLocal, showToast]);

  const deleteCatalogItem = useCallback(async (entry) => {
    if (!entry?.id || catalogStarBusyId) return;
    if (!window.confirm(`Eliminare «${entry.nome}» dal catalogo?`)) return;
    setCatalogStarBusyId(entry.id);
    try {
      await postCatalog({ id: entry.id, action: 'delete' });
      removeCatalogLocal(entry.id);
      showToast('Rimosso dal catalogo');
    } catch (e) {
      showToast(e.message || 'Eliminazione non riuscita');
    } finally {
      setCatalogStarBusyId(null);
    }
  }, [catalogStarBusyId, postCatalog, removeCatalogLocal, showToast]);

  const submitScanCatalogForm = useCallback(async () => {
    const nome = catalogForm.nome.trim();
    const kcal = parseFloat(String(catalogForm.kcal).replace(',', '.'));
    if (!nome || !Number.isFinite(kcal)) {
      setCatalogFormMsg('Nome e kcal per 100 g obbligatori.');
      return;
    }
    setCatalogFormBusy(true);
    setCatalogFormMsg('');
    try {
      await postCatalog({
        nome,
        barcode: scanBarcodeForCatalog || '',
        off_code: scanBarcodeForCatalog || '',
        fonte: 'manuale',
        preferito: true,
        per_100g: {
          kcal,
          proteine: parseFloat(String(catalogForm.proteine).replace(',', '.')) || 0,
          carboidrati: parseFloat(String(catalogForm.carboidrati).replace(',', '.')) || 0,
          grassi: parseFloat(String(catalogForm.grassi).replace(',', '.')) || 0,
        },
      });
      setCatalogFormMsg('Salvato nel catalogo.');
      setCatalogFormOpen(false);
      setScanNotFound('');
      setScanBarcodeForCatalog('');
      await fetchCatalog();
      showToast('Aggiunto ai preferiti');
    } catch (e) {
      setCatalogFormMsg(e.message || 'Salvataggio non riuscito');
    } finally {
      setCatalogFormBusy(false);
    }
  }, [catalogForm, scanBarcodeForCatalog, postCatalog, fetchCatalog, showToast]);

  const closeSaveCatalog = useCallback(() => {
    setSaveCatalogMeal(null);
    setSaveCatalogForm(null);
    setSaveCatalogMsg('');
  }, []);

  const openSaveCatalogFromMeal = useCallback((meal) => {
    const g = Number(meal.grammi) || 0;
    const factor = g > 0 ? 100 / g : 1;
    setSaveCatalogMeal(meal);
    setSaveCatalogMsg('');
    setSaveCatalogForm({
      nome: meal.alimento || '',
      kcal: g > 0 ? String(Math.round((meal.kcal || 0) * factor * 10) / 10) : String(meal.kcal || ''),
      proteine: g > 0 ? String(Math.round((meal.proteine || 0) * factor * 10) / 10) : String(meal.proteine || ''),
      carboidrati: g > 0 ? String(Math.round((meal.carboidrati || 0) * factor * 10) / 10) : String(meal.carboidrati || ''),
      grassi: g > 0 ? String(Math.round((meal.grassi || 0) * factor * 10) / 10) : String(meal.grassi || ''),
      preferito: true,
    });
  }, []);

  const onMealCatalogStarClick = useCallback(async (meal) => {
    if (!config.apiUrl || !meal) return;
    const entry = findCatalogForAlimento(meal.alimento);
    if (!entry) {
      openSaveCatalogFromMeal(meal);
      return;
    }
    await toggleCatalogPreferito(entry);
  }, [config.apiUrl, findCatalogForAlimento, openSaveCatalogFromMeal, toggleCatalogPreferito]);

  const submitSaveCatalogFromMeal = useCallback(async () => {
    if (!saveCatalogForm) return;
    const nome = saveCatalogForm.nome.trim();
    const kcal = parseFloat(String(saveCatalogForm.kcal).replace(',', '.'));
    if (!nome || !Number.isFinite(kcal)) {
      setSaveCatalogMsg('Nome e kcal per 100 g obbligatori.');
      return;
    }
    setSaveCatalogBusy(true);
    setSaveCatalogMsg('');
    try {
      const isBarcode = String(saveCatalogMeal?.fonte || '').includes('barcode');
      await postCatalog({
        nome,
        fonte: isBarcode ? 'barcode' : 'manuale',
        preferito: !!saveCatalogForm.preferito,
        per_100g: {
          kcal,
          proteine: parseFloat(String(saveCatalogForm.proteine).replace(',', '.')) || 0,
          carboidrati: parseFloat(String(saveCatalogForm.carboidrati).replace(',', '.')) || 0,
          grassi: parseFloat(String(saveCatalogForm.grassi).replace(',', '.')) || 0,
        },
      });
      setSaveCatalogMsg('Salvato nel catalogo.');
      setSaveCatalogMeal(null);
      setSaveCatalogForm(null);
      await fetchCatalog();
      showToast(saveCatalogForm.preferito ? 'Aggiunto ai preferiti' : 'Salvato nel catalogo');
    } catch (e) {
      setSaveCatalogMsg(e.message || 'Salvataggio non riuscito');
    } finally {
      setSaveCatalogBusy(false);
    }
  }, [saveCatalogForm, saveCatalogMeal, postCatalog, fetchCatalog, showToast]);

  const speakSummary = useCallback(async () => {
    if (!config.apiUrl || summaryBusy || micState !== 'idle') return;
    setSummaryBusy(true);
    setTrackError('');
    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/daily_summary`, {
        headers: config.apiKey ? { 'X-API-Key': config.apiKey } : {},
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error(`Risposta ${res.status} dal server`);
      const text = json.riepilogo_vocale || 'Nessun riepilogo disponibile.';
      setMicState('speaking');
      speak(text, () => { setMicState('idle'); setSummaryBusy(false); });
    } catch (e) {
      setTrackError(e.message || 'Impossibile raggiungere il backend');
      setSummaryBusy(false);
    }
  }, [config, summaryBusy, micState, speak]);

  // =========================================================================
  // TAB "SCAN" — barcode nella PWA (Deploy 4, §5 del Piano di Consolidamento)
  // BarcodeDetector nativo con feature detection; niente fallback zxing per
  // ora (decisione annotata: si aggiunge solo a domanda reale, §3.10 registro).
  // Flusso stateless col backend: 1° POST solo barcode → needs_clarification
  // con scheda prodotto → 2° POST barcode + grammi → scrittura su Sheets.
  // =========================================================================
  const [scanState, setScanState] = useState('idle'); // idle | scanning | asking_qty | processing | speaking
  const [scanProduct, setScanProduct] = useState(null); // { barcode, nome, per_100g }
  const [scanQty, setScanQty] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [scanNotFound, setScanNotFound] = useState('');
  const [qtyListening, setQtyListening] = useState(false);
  const [eanListening, setEanListening] = useState(false);
  const [manualEan, setManualEan] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectTimerRef = useRef(null);
  const qtyRecRef = useRef(null);
  const eanRecRef = useRef(null);

  const barcodeSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  const stopCamera = useCallback(() => {
    if (detectTimerRef.current) { clearInterval(detectTimerRef.current); detectTimerRef.current = null; }
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch (e) {}
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetScan = useCallback(() => {
    clearLogFlow();
    stopCamera();
    try { qtyRecRef.current?.abort?.(); } catch (e) {}
    try { eanRecRef.current?.abort?.(); } catch (e) {}
    setScanState('idle');
    setScanProduct(null);
    setScanQty('');
    setScanResult(null);
    setScanError('');
    setScanNotFound('');
    setQtyListening(false);
    setEanListening(false);
    setManualEan('');
  }, [stopCamera, clearLogFlow]);

  // Uscendo dal tab Scan (o smontando): camera spenta, stato pulito.
  useEffect(() => {
    if (view === 'scan') return;
    resetScan();
  }, [view, resetScan]);

  const sendBarcode = useCallback(async (barcode, grammi) => {
    if (grammi == null) beginLogFlow();
    setScanState('processing');
    setScanError('');
    setScanNotFound('');
    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const targetDate = getTargetDateForLog();
      const res = await fetch(`${base}/scan_barcode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
        },
        body: JSON.stringify({
          barcode,
          ...(grammi != null ? { grammi } : {}),
          fonte: 'pwa-barcode',
          target_date: targetDate,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!json) throw new Error(`Risposta ${res.status} dal server`);

      if (json.status === 'needs_clarification' && json.product) {
        // Prodotto trovato, manca la quantita': input touch (default §9.3) + mic.
        setScanProduct({ barcode, ...json.product });
        setScanState('speaking');
        speak(json.riepilogo_vocale || `Trovato ${json.product.nome}. Quanti grammi?`, () => setScanState('asking_qty'));
        return;
      }

      if (json.status === 'not_found') {
        // §3.9: esito normale, non un guasto — messaggio chiaro, nessuna riga scritta.
        setScanNotFound(json.message || 'Prodotto non trovato su Open Food Facts.');
        setScanBarcodeForCatalog(barcode);
        setCatalogFormOpen(false);
        setCatalogForm({ nome: '', kcal: '', proteine: '', carboidrati: '', grassi: '' });
        setCatalogFormMsg('');
        clearLogFlow();
        setScanState('speaking');
        speak(json.riepilogo_vocale || 'Prodotto non trovato.', () => setScanState('idle'));
        return;
      }

      if (json.status === 'ok') {
        setScanProduct(null);
        setScanQty('');
        setScanResult(json);
        clearLogFlow();
        setScanState('speaking');
        speak(json.riepilogo_vocale || 'Prodotto registrato.', () => setScanState('idle'));
        refreshAfterLog(json.data_dichiarata || targetDate);
        // Lo scan ok fa upsert silenzioso nel catalogo: riallinea le stelline.
        fetchCatalog();
        return;
      }

      clearLogFlow();
      const msg = json.message || json.riepilogo_vocale || 'Errore dal server.';
      setScanError(msg);
      setScanState('speaking');
      speak(json.riepilogo_vocale || msg, () => setScanState('idle'));
    } catch (e) {
      clearLogFlow();
      setScanError(e.message || 'Impossibile raggiungere il backend');
      setScanState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, speak, beginLogFlow, clearLogFlow, getTargetDateForLog, refreshAfterLog, fetchCatalog]);

  // Inserimento manuale dell'EAN: stessa strada di sendBarcode, utile quando la
  // fotocamera legge un codice sbagliato (riflessi/etichetta curva) o manca del tutto.
  const submitManualEan = useCallback(() => {
    const code = manualEan.trim();
    if (!code || scanState !== 'idle') return;
    stopCamera();
    sendBarcode(code, null);
    setManualEan('');
  }, [manualEan, scanState, stopCamera, sendBarcode]);

  const startScan = useCallback(async () => {
    if (!barcodeSupported || scanState !== 'idle') return;
    setScanResult(null);
    setScanError('');
    setScanNotFound('');
    setScanProduct(null);
    try {
      const stream = await openScanCameraStream();
      streamRef.current = stream;
      setScanState('scanning');
      // Il <video> viene montato dal render di 'scanning': aggancio al frame dopo.
      requestAnimationFrame(async () => {
        if (!videoRef.current || !streamRef.current) return;
        videoRef.current.srcObject = streamRef.current;
        try { await videoRef.current.play(); } catch (e) {}

        // Zoom hardware ~2x + AF continuo: esce dalla 0.5x quando il browser lo espone.
        const track = streamRef.current.getVideoTracks()[0];
        await applyScanTrackConstraints(track);

        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8'] });
        detectTimerRef.current = setInterval(async () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || !video.videoWidth) return;
          try {
            // Crop centrale allineato alla linea di mira (rinforzo dopo lo zoom fisico).
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            const cropW = vw / SCAN_DIGITAL_ZOOM;
            const cropH = vh / SCAN_DIGITAL_ZOOM;
            const sx = (vw - cropW) / 2;
            const sy = (vh - cropH) / 2;
            const bitmap = await createImageBitmap(video, sx, sy, cropW, cropH, {
              resizeWidth: Math.round(cropW * SCAN_DIGITAL_ZOOM),
              resizeHeight: Math.round(cropH * SCAN_DIGITAL_ZOOM),
              resizeQuality: 'high',
            });
            let codes;
            try {
              codes = await detector.detect(bitmap);
            } finally {
              bitmap.close();
            }
            if (codes && codes.length > 0) {
              const code = (codes[0].rawValue || '').trim();
              if (code) {
                stopCamera();
                sendBarcode(code, null);
              }
            }
          } catch (e) { /* frame perso: si riprova al tick dopo */ }
        }, 300);
      });
    } catch (e) {
      stopCamera();
      setScanError(e.name === 'NotAllowedError'
        ? 'Permesso fotocamera negato: abilitalo nelle impostazioni del browser.'
        : `Impossibile aprire la fotocamera: ${e.message || e.name}`);
      setScanState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcodeSupported, scanState, sendBarcode, stopCamera]);

  // Card azioni rapide sul Diario: dopo setView, avvia focus / mic / camera.
  // CERCA apre un overlay fisso (non entra nel carosello Traccia).
  // Se siamo già sul tab target, setView è no-op → esegui subito (deep link / re-entry PWA).
  const launchQuickAction = useCallback((action) => {
    beginLogFlow();
    if (action === 'cerca') {
      openSearch();
      return;
    }
    const targetView = action === 'scan' ? 'scan' : 'traccia';
    if (view === targetView) {
      pendingActionRef.current = null;
      if (action === 'scan') {
        startScan();
      } else if (action === 'voice') {
        if (micState === 'idle') startListening(false);
      } else if (action === 'text') {
        requestAnimationFrame(() => typedInputRef.current?.focus?.({ preventScroll: true }));
      }
      return;
    }
    pendingActionRef.current = action;
    setView(targetView);
  }, [openSearch, beginLogFlow, view, startScan, startListening, micState]);

  useEffect(() => {
    const action = pendingActionRef.current;
    if (!action) return;
    if (action === 'text' && view === 'traccia') {
      pendingActionRef.current = null;
      requestAnimationFrame(() => typedInputRef.current?.focus?.({ preventScroll: true }));
    } else if (action === 'voice' && view === 'traccia') {
      pendingActionRef.current = null;
      if (micState === 'idle') startListening(false);
    } else if (action === 'scan' && view === 'scan') {
      pendingActionRef.current = null;
      startScan();
    }
  }, [view, micState, startListening, startScan]);

  // Deep link ?action=… (Tasker / shortcuts manifest). Pulisce l'URL dopo il consume
  // così refresh / swipe-back non ri-triggerano. Re-legge su visibility/pageshow perché
  // la PWA standalone in background spesso non rimonta React.
  const consumeUrlAction = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('action');
    if (!raw) return;
    const map = {
      scan: 'scan',
      cerca: 'cerca',
      voice: 'voice',
      voce: 'voice',
      text: 'text',
      testo: 'text',
    };
    const mapped = map[raw];
    params.delete('action');
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', next);
    if (mapped) launchQuickAction(mapped);
  }, [launchQuickAction]);

  useEffect(() => {
    consumeUrlAction();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') consumeUrlAction();
    };
    const onPageShow = () => consumeUrlAction();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [consumeUrlAction]);

  // Overlay CERCA aperto: carica frequenti + focus senza scroll-into-view (rompe il carosello).
  useEffect(() => {
    if (!searchOpen) return undefined;
    runSearch('');
    fetchCatalog();
    const t = requestAnimationFrame(() => {
      searchInputRef.current?.focus?.({ preventScroll: true });
    });
    const onKey = (e) => {
      if (e.key === 'Escape') closeSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('keydown', onKey);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchOpen, runSearch, closeSearch, fetchCatalog]);

  // Blocca scroll pagina sotto l'overlay (come Obiettivi).
  useEffect(() => {
    if (!searchOpen) return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [searchOpen]);

  // Overlay salva-catalogo: focus senza scroll-into-view + Esc (stesso pattern CERCA).
  const saveCatalogOpen = !!(saveCatalogMeal && saveCatalogForm);
  useEffect(() => {
    if (!saveCatalogOpen) return undefined;
    if (pagerRef.current) pagerRef.current.scrollLeft = 0;
    const t = requestAnimationFrame(() => {
      saveCatalogNomeRef.current?.focus?.({ preventScroll: true });
    });
    const onKey = (e) => {
      if (e.key === 'Escape') closeSaveCatalog();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [saveCatalogOpen, closeSaveCatalog]);

  useEffect(() => {
    if (!saveCatalogOpen) return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [saveCatalogOpen]);

  const confirmQty = useCallback(() => {
    const n = parseFloat(String(scanQty).replace(',', '.'));
    if (!scanProduct || !Number.isFinite(n) || n <= 0) return;
    sendBarcode(scanProduct.barcode, n);
  }, [scanQty, scanProduct, sendBarcode]);

  // Opzione microfono per la quantita' (§9.3): one-shot, estrae il primo numero.
  const listenQty = useCallback(() => {
    if (!SpeechRecognitionAPI || qtyListening || scanState !== 'asking_qty') return;
    try { window.speechSynthesis?.cancel(); } catch (e) {}
    const rec = new SpeechRecognitionAPI();
    rec.lang = 'it-IT';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const said = event.results?.[0]?.[0]?.transcript || '';
      const m = said.replace(',', '.').match(/\d+(\.\d+)?/);
      if (m) setScanQty(m[0]);
    };
    rec.onend = () => { qtyRecRef.current = null; setQtyListening(false); };
    rec.onerror = () => { qtyRecRef.current = null; setQtyListening(false); };
    qtyRecRef.current = rec;
    setQtyListening(true);
    try { rec.start(); } catch (e) { setQtyListening(false); }
  }, [qtyListening, scanState]);

  // Microfono per EAN a mano: one-shot, tiene solo le cifre dette.
  const listenManualEan = useCallback(() => {
    if (!SpeechRecognitionAPI || eanListening || scanState !== 'idle') return;
    try { window.speechSynthesis?.cancel(); } catch (e) {}
    const rec = new SpeechRecognitionAPI();
    rec.lang = 'it-IT';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const said = event.results?.[0]?.[0]?.transcript || '';
      const digits = said.replace(/\D/g, '');
      if (digits) setManualEan(digits);
    };
    rec.onend = () => { eanRecRef.current = null; setEanListening(false); };
    rec.onerror = () => { eanRecRef.current = null; setEanListening(false); };
    eanRecRef.current = rec;
    setEanListening(true);
    try { rec.start(); } catch (e) { setEanListening(false); }
  }, [eanListening, scanState]);

  const selectedDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [dayOffset]);
  const selectedDateStr = fmtYMD(selectedDate);

  const trendData = trendRange === 'year' ? year : trendRange === 'month' ? month : week;

  // Tap su un bucket del grafico trend → ci si sposta nel Diario a quella data
  // (giorno / inizio settimana / primo del mese).
  const goToDate = useCallback((dateStr) => {
    if (!dateStr) return;
    const [y, m, d] = dateStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    targetDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((targetDate - today) / 86400000);
    dayPendingCommitRef.current = null;
    setDayDragging(true);
    setDayDragX(0);
    dayDragXRef.current = 0;
    setDayOffset(diffDays);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setDayDragging(false));
    });
  }, []);

  const setDayDrag = useCallback((x) => {
    dayDragXRef.current = x;
    setDayDragX(x);
  }, []);

  // Carosello giorno: dx → giorno prima, sx → giorno dopo (max oggi).
  // Gesto solo dalla card calorie (data-no-tab-swipe); le tab non si muovono.
  const DAY_SWIPE_MIN = 56;
  const DAY_SWIPE_RATIO = 0.22;

  const finishDayCommit = useCallback(() => {
    const pending = dayPendingCommitRef.current;
    if (pending == null) return;
    dayPendingCommitRef.current = null;
    // 1) transition:none in DOM prima dello snap ±w→0 (altrimenti WebKit anima un secondo swipe).
    flushSync(() => {
      setDayDragging(true);
    });
    // Forza il browser ad applicare transition:none prima del cambio transform.
    void dayTrackRef.current?.offsetWidth;
    flushSync(() => {
      setDayOffset(pending);
      if (dayDragXRef.current !== 0) setDayDrag(0);
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setDayDragging(false));
    });
  }, [setDayDrag]);

  const shiftDay = useCallback((delta) => {
    if (!config.apiUrl) return;
    if (dayPendingCommitRef.current != null) return;
    const next = dayOffset + delta;
    if (next === dayOffset) return;
    const w = dayPagerRef.current?.offsetWidth || 1;
    const targetX = delta < 0 ? w : -w;
    dayPendingCommitRef.current = next;
    // Se il drag e' gia' sul target, transitionend potrebbe non sparare.
    if (Math.abs(dayDragXRef.current - targetX) < 2) {
      finishDayCommit();
      return;
    }
    setDayDragging(false);
    setDayDrag(targetX);
  }, [config.apiUrl, dayOffset, setDayDrag, finishDayCommit]);

  const onDayTrackTransitionEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== 'transform') return;
    if (dayPendingCommitRef.current == null) return;
    finishDayCommit();
  }, [finishDayCommit]);

  const onDaySwipeStart = useCallback((e) => {
    if (targetsOpen || targetsAnimOpen || dayPendingCommitRef.current != null) {
      daySwipeRef.current = null;
      return;
    }
    if (e.target.closest?.('button, input, textarea, select, a')) {
      daySwipeRef.current = null;
      return;
    }
    daySwipeRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      axis: null,
      width: dayPagerRef.current?.offsetWidth || 1,
    };
  }, [targetsOpen, targetsAnimOpen]);

  const onDaySwipeMove = useCallback((e) => {
    const s = daySwipeRef.current;
    if (!s) return;
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      s.axis = Math.abs(dx) > Math.abs(dy) * 1.1 ? 'x' : 'y';
      if (s.axis === 'y') {
        daySwipeRef.current = null;
        return;
      }
      setDayDragging(true);
    }
    if (s.axis !== 'x') return;
    let x = dx;
    // Rubber-band solo senza API (demo): niente navigazione giorno.
    if (!config.apiUrl) x *= 0.35;
    setDayDrag(x);
  }, [config.apiUrl, setDayDrag]);

  const onDaySwipeEnd = useCallback(() => {
    const s = daySwipeRef.current;
    daySwipeRef.current = null;
    if (!s || s.axis !== 'x') {
      // Non interrompere un settle in corso (touchcancel / secondo end dopo shiftDay).
      if (dayPendingCommitRef.current != null) return;
      setDayDragging(false);
      setDayDrag(0);
      return;
    }
    const w = s.width || 1;
    const dx = dayDragXRef.current;
    const enough = Math.abs(dx) >= Math.max(DAY_SWIPE_MIN, w * DAY_SWIPE_RATIO);
    if (enough && dx > 0 && config.apiUrl) {
      shiftDay(-1);
    } else if (enough && dx < 0 && config.apiUrl) {
      shiftDay(1);
    } else {
      setDayDragging(false);
      setDayDrag(0);
    }
  }, [config.apiUrl, shiftDay, setDayDrag]);

  // Carica giorno corrente + prefetch adiacenti in dayCache (SWR + batch).
  const dayCacheRef = useRef(dayCache);
  dayCacheRef.current = dayCache;
  const historyTickRef = useRef(historyTick);

  useEffect(() => {
    if (!config.apiUrl) return;
    let cancelled = false;
    const tickBumped = historyTick !== historyTickRef.current;
    historyTickRef.current = historyTick;
    const offsets = [...new Set([dayOffset, dayOffset - 1, dayOffset + 1])].filter((o) => o !== 0);

    const needed = [];
    for (const o of offsets) {
      const str = fmtYMD(dateForOffset(o));
      const selected = o === dayOffset;
      const cached = dayCacheRef.current[str];
      const hasMeals = !!cached && Array.isArray(cached.meals);
      const isStale = !cached?.at || (Date.now() - cached.at) > DAY_CACHE_STALE_MS;

      if (!selected && hasMeals && !cached.error && !isStale) continue;
      if (selected && hasMeals && !cached.error && !isStale && !tickBumped) continue;
      needed.push(str);
    }

    if (needed.length === 0) return;

    for (const str of needed) {
      const cached = dayCacheRef.current[str];
      const hasMeals = !!cached && Array.isArray(cached.meals);
      if (!hasMeals) {
        setDayCache((prev) => ({
          ...prev,
          [str]: { meals: prev[str]?.meals ?? [], loading: true, error: '', at: prev[str]?.at },
        }));
      }
    }

    (async () => {
      try {
        const base = config.apiUrl.replace(/\/$/, '');
        const res = await fetch(`${base}/day_meals?dates=${needed.join(',')}`, {
          headers: config.apiKey ? { 'X-API-Key': config.apiKey } : {},
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || json.status !== 'ok' || !json.days) {
          throw new Error(`Risposta ${res.status} dal server`);
        }
        if (cancelled) return;
        const at = Date.now();
        const updates = {};
        for (const str of needed) {
          const block = json.days[str] || { dettaglio: [] };
          const loaded = (block.dettaglio || []).map((m, i) => ({ ...m, id: m.id || `legacy-${i}` }));
          updates[str] = { meals: loaded, loading: false, error: '', at };
          persistDayCacheEntry(str, loaded);
        }
        setDayCache((prev) => ({ ...prev, ...updates }));
      } catch (e) {
        if (cancelled) return;
        setDayCache((prev) => {
          const next = { ...prev };
          for (const str of needed) {
            const cached = prev[str];
            const hasMeals = !!cached && Array.isArray(cached.meals);
            next[str] = {
              meals: cached?.meals ?? [],
              loading: false,
              error: hasMeals ? '' : (e.message || 'Impossibile caricare questo giorno'),
              at: cached?.at,
            };
          }
          return next;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [dayOffset, config.apiUrl, config.apiKey, historyTick]);

  const mealsForOffset = useCallback((o) => {
    if (o === 0) return meals;
    return dayCache[fmtYMD(dateForOffset(o))]?.meals ?? [];
  }, [meals, dayCache]);

  const metaForOffset = useCallback((o) => {
    if (o === 0) return { loading: false, error: '' };
    const entry = dayCache[fmtYMD(dateForOffset(o))];
    return { loading: !!entry?.loading, error: entry?.error || '' };
  }, [dayCache]);

  const displayedMeals = dayOffset === 0 ? meals : (dayCache[selectedDateStr]?.meals ?? []);
  const historyLoading = dayOffset !== 0 && !!dayCache[selectedDateStr]?.loading;
  const historyError = dayOffset !== 0 ? (dayCache[selectedDateStr]?.error || '') : '';

  // =========================================================================
  // Edit / delete di un pasto (Deploy 5 §7.2)
  // Endpoint /update_meal e /delete_meal, stessa API key + header degli altri.
  // Editabile solo in modalita' live e su righe con id reale (le "legacy-*"
  // sono righe storiche senza UUID: il backend risponde 404, quindi niente
  // affordance). §5.3 del piano.
  // =========================================================================
  const isEditable = useCallback(
    (m) => !!config.apiUrl && !!m && !String(m.id).startsWith('legacy-'),
    [config.apiUrl]
  );

  // Ricarica il giorno mostrato dopo una mutazione: oggi via fetchLive (che
  // riscrive anche vt-cache), i giorni passati bumpando historyTick.
  const refreshDay = useCallback(() => {
    if (dayOffset === 0) {
      fetchLive(config, true);
    } else {
      setHistoryTick((t) => t + 1);
    }
  }, [dayOffset, config, fetchLive]);

  const openEdit = useCallback((m) => {
    setSwipeId(null);
    setSwipeX(0);
    setConfirmDeleteId(null);
    setConfirmEditId(null);
    setEditError('');
    setEditingId(m.id);
    setEditDraft({
      alimento: m.alimento ?? '',
      grammi: m.grammi ?? 0,
      kcal: m.kcal ?? 0,
      proteine: m.proteine ?? 0,
      carboidrati: m.carboidrati ?? 0,
      grassi: m.grassi ?? 0,
    });
  }, []);

  const closeEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft(null);
    setEditError('');
  }, []);

  const num = (v) => {
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  // --- Obiettivi: split macro in % (Deploy 5 §7.2) -------------------------
  // Grammi in targetDraft = quantità precisa (digitazione / ±1 g).
  // macroPct + slider aggiornano i grammi di quel solo macro; gli altri restano.
  // Totale può ≠100 → va portato a 100 per salvare.
  // Digitando le calorie: le barre si riscalano in proporzione fino a 100%
  // (le proporzioni attuali restano, la somma torna 100) e i grammi si derivano.
  const onTargetKcalChange = (v) => {
    const s = macroPct.p + macroPct.c + macroPct.g;
    const next = s > 0
      ? normalize100({ p: (macroPct.p / s) * 100, c: (macroPct.c / s) * 100, g: (macroPct.g / s) * 100 })
      : macroPct;
    setMacroPct(next);
    setTargetDraft((d) => ({
      ...d,
      kcal: v,
      proteine: gramsFromPctOne(next.p, 4, v),
      carboidrati: gramsFromPctOne(next.c, 4, v),
      grassi: gramsFromPctOne(next.g, 9, v),
    }));
  };
  const setMacroSlider = (which, v) => {
    const pct = Math.max(0, Math.min(100, Math.round(toNum(v))));
    const key = MACRO_KEYS[which];
    const factor = MACRO_FACTOR[which];
    setMacroPct((prev) => ({ ...prev, [which]: pct }));
    setTargetDraft((d) => ({ ...d, [key]: gramsFromPctOne(pct, factor, d.kcal) }));
  };
  const setMacroGrams = (which, v) => {
    const key = MACRO_KEYS[which];
    const factor = MACRO_FACTOR[which];
    const nextVal = typeof v === 'number' ? Math.max(0, Math.round(v)) : v;
    setTargetDraft((d) => ({ ...d, [key]: nextVal }));
    setMacroPct((prev) => ({
      ...prev,
      [which]: pctFromGramsVsKcal(toNum(nextVal), factor, targetDraft.kcal),
    }));
  };

  const saveEdit = useCallback(async (meal) => {
    if (!editDraft || editBusy) return;
    setEditBusy(true);
    setEditError('');
    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/update_meal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
        },
        body: JSON.stringify({
          id: meal.id,
          alimento: String(editDraft.alimento || '').trim(),
          grammi: num(editDraft.grammi),
          kcal: num(editDraft.kcal),
          proteine: num(editDraft.proteine),
          carboidrati: num(editDraft.carboidrati),
          grassi: num(editDraft.grassi),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.status !== 'ok') {
        throw new Error((json && (json.message || json.status)) || `Risposta ${res.status} dal server`);
      }
      closeEdit();
      refreshDay();
    } catch (e) {
      setEditError(e.message || 'Impossibile salvare la modifica');
    } finally {
      setEditBusy(false);
    }
  }, [editDraft, editBusy, config, closeEdit, refreshDay]);

  const deleteMeal = useCallback(async (meal) => {
    setEditError('');

    // Rimozione ottimistica: la riga sparisce subito, senza aspettare la
    // risposta del backend (prima il pulsante restava a girare fino al round
    // trip completo, dando l'impressione di un freeze).
    setConfirmDeleteId(null);
    setSwipeId(null);
    setSwipeX(0);
    if (editingId === meal.id) closeEdit();
    const rollback = dayOffset === 0
      ? (() => {
          const prev = meals;
          setMeals((cur) => cur.filter((m) => m.id !== meal.id));
          return () => setMeals(prev);
        })()
      : (() => {
          const prev = dayCache[selectedDateStr];
          setDayCache((cur) => {
            const entry = cur[selectedDateStr];
            if (!entry) return cur;
            return { ...cur, [selectedDateStr]: { ...entry, meals: (entry.meals || []).filter((m) => m.id !== meal.id) } };
          });
          return () => setDayCache((cur) => ({ ...cur, [selectedDateStr]: prev }));
        })();

    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/delete_meal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
        },
        body: JSON.stringify({ id: meal.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.status !== 'ok') {
        throw new Error((json && (json.message || json.status)) || `Risposta ${res.status} dal server`);
      }
      refreshDay();
    } catch (e) {
      rollback();
      setEditError(e.message || 'Impossibile eliminare il pasto');
    }
  }, [config, editingId, closeEdit, refreshDay, dayOffset, meals, dayCache, selectedDateStr]);

  // --- Swipe sulla riga: dx→sx elimina, sx→dx modifica (§5.5 del piano) ---
  const SWIPE_MAX = 80;      // apertura massima (px)
  const SWIPE_TRIGGER = 48;  // soglia oltre cui scatta l'azione
  const TAP_MAX_MOVE = 10;   // sotto questa soglia un tocco è un tap, non uno swipe
  const swipeStartXRef = useRef(0);

  const onRowTouchStart = useCallback((m, e) => {
    if (!isEditable(m)) return;
    suppressRowClickRef.current = false;
    swipeStartXRef.current = e.touches[0].clientX;
    // Stesso pasto in edit/conferma: niente swipe (tap chiude in touchEnd)
    if (editingId === m.id || confirmDeleteId === m.id || confirmEditId === m.id) return;
    // Altro pasto aperto: chiudi e avvia lo swipe su questo
    if (editingId) closeEdit();
    if (confirmDeleteId) setConfirmDeleteId(null);
    if (confirmEditId) setConfirmEditId(null);
    setSwipeId(m.id);
  }, [isEditable, confirmDeleteId, confirmEditId, editingId, closeEdit]);

  const onRowTouchMove = useCallback((m, e) => {
    if (swipeId !== m.id) return;
    const dx = e.touches[0].clientX - swipeStartXRef.current;
    setSwipeX(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx)));
  }, [swipeId]);

  const onRowTouchEnd = useCallback((m, e) => {
    // Pannello di modifica o conferma già aperti: un tap (senza
    // trascinamento) sulla riga li richiude subito, senza aspettare il click
    // sintetico del browser (che su alcuni mobile richiederebbe un secondo tocco).
    if (editingId === m.id || confirmDeleteId === m.id || confirmEditId === m.id) {
      const endX = e?.changedTouches?.[0]?.clientX ?? swipeStartXRef.current;
      // Non chiudere se il tocco è su un bottone dell'overlay (matita/cestino/X):
      // altrimenti l'overlay si smonta prima del click e il tap finisce sulla stellina sotto.
      if (e?.target?.closest?.('button')) return;
      if (Math.abs(endX - swipeStartXRef.current) < TAP_MAX_MOVE) {
        suppressRowClickRef.current = true;
        if (editingId === m.id) closeEdit();
        else if (confirmDeleteId === m.id) setConfirmDeleteId(null);
        else setConfirmEditId(null);
      }
      return;
    }
    if (swipeId !== m.id) return;
    if (swipeX >= SWIPE_TRIGGER) {
      setConfirmDeleteId(null);
      setConfirmEditId(m.id);
    } else if (swipeX <= -SWIPE_TRIGGER) {
      setConfirmEditId(null);
      setConfirmDeleteId(m.id);
    }
    setSwipeX(0);
    setSwipeId(null);
  }, [swipeId, swipeX, editingId, confirmDeleteId, confirmEditId, closeEdit]);

  // --- Carosello schede Diario | Traccia | Scan (drag + animazione) ---
  const TAB_SWIPE_MIN = 56;
  const TAB_SWIPE_RATIO = 0.22;
  const pagerRef = useRef(null);
  const tabSwipeRef = useRef(null); // { x, y, axis, width }
  const tabDragXRef = useRef(0);
  const [tabDragX, setTabDragX] = useState(0);
  const [tabDragging, setTabDragging] = useState(false);
  const tabIdx = TAB_ORDER.indexOf(view);

  const setTabDrag = useCallback((x) => {
    tabDragXRef.current = x;
    setTabDragX(x);
  }, []);

  const tabSwipeBlocked = useCallback(
    () => configOpen || targetsOpen || searchOpen || saveCatalogOpen || !!editingId || !!confirmDeleteId || !!confirmEditId || scanState === 'scanning' || dayDragging || dayPendingCommitRef.current != null,
    [configOpen, targetsOpen, searchOpen, saveCatalogOpen, editingId, confirmDeleteId, confirmEditId, scanState, dayDragging]
  );

  const isTabSwipeBlockedTarget = (el) =>
    !!el?.closest?.('input, textarea, button, select, a, [data-no-tab-swipe]');

  const goToTab = useCallback((nextId, fromDrag = false) => {
    const from = TAB_ORDER.indexOf(view);
    const to = TAB_ORDER.indexOf(nextId);
    if (to < 0 || from === to) {
      setTabDragging(false);
      setTabDrag(0);
      return;
    }
    if (fromDrag) {
      const w = tabSwipeRef.current?.width || pagerRef.current?.offsetWidth || 1;
      const visual = -from * w + tabDragXRef.current;
      const targetBase = -to * w;
      setTabDragging(true);
      setView(nextId);
      setTabDrag(visual - targetBase);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTabDragging(false);
          setTabDrag(0);
          tabSwipeRef.current = null;
        });
      });
    } else {
      setTabDragging(false);
      setTabDrag(0);
      setView(nextId);
    }
  }, [view, setTabDrag]);

  const onTabSwipeStart = useCallback((e) => {
    if (tabSwipeBlocked() || isTabSwipeBlockedTarget(e.target) || swipeId) {
      tabSwipeRef.current = null;
      return;
    }
    tabSwipeRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      axis: null,
      width: pagerRef.current?.offsetWidth || 1,
    };
  }, [tabSwipeBlocked, swipeId]);

  const onTabSwipeMove = useCallback((e) => {
    const s = tabSwipeRef.current;
    if (!s || swipeId) return;
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      s.axis = Math.abs(dx) > Math.abs(dy) * 1.1 ? 'x' : 'y';
      if (s.axis === 'y') return;
      setTabDragging(true);
    }
    if (s.axis !== 'x') return;
    const idx = TAB_ORDER.indexOf(view);
    let x = dx;
    if ((idx === 0 && x > 0) || (idx === TAB_ORDER.length - 1 && x < 0)) {
      x *= 0.35;
    }
    setTabDrag(x);
  }, [view, swipeId, setTabDrag]);

  const onTabSwipeEnd = useCallback(() => {
    const s = tabSwipeRef.current;
    if (!s || s.axis !== 'x' || swipeId) {
      tabSwipeRef.current = null;
      setTabDragging(false);
      setTabDrag(0);
      return;
    }
    const w = s.width || 1;
    const dx = tabDragXRef.current;
    const idx = TAB_ORDER.indexOf(view);
    const enough = Math.abs(dx) >= Math.max(TAB_SWIPE_MIN, w * TAB_SWIPE_RATIO);
    let next = view;
    if (enough && dx < 0 && idx < TAB_ORDER.length - 1) next = TAB_ORDER[idx + 1];
    else if (enough && dx > 0 && idx > 0) next = TAB_ORDER[idx - 1];
    if (next !== view) goToTab(next, true);
    else {
      setTabDragging(false);
      setTabDrag(0);
      tabSwipeRef.current = null;
    }
  }, [view, swipeId, goToTab, setTabDrag]);

  const totals = useMemo(() => sumTotals(displayedMeals), [displayedMeals]);
  const grouped = useMemo(() => groupByPasto(displayedMeals), [displayedMeals]);
  const remaining = target.kcal - totals.kcal;
  const overTarget = remaining < 0;
  const pct = Math.min(totals.kcal / Math.max(target.kcal, 1), 1.25);

  const macroCalData = [
    { name: 'Proteine', grams: totals.proteine, cal: totals.proteine * 4, color: C.protein },
    { name: 'Carboidrati', grams: totals.carboidrati, cal: totals.carboidrati * 4, color: C.carbs },
    { name: 'Grassi', grams: totals.grassi, cal: totals.grassi * 9, color: C.fat },
  ];

  // Grammi in bozza (fonte precisa per digitazione / ±1); % derivate a parte.
  // Somma delle % (indipendenti): deve essere 100 per salvare.
  const macroSum = macroPct.p + macroPct.c + macroPct.g;

  const statusDot = status === 'live' ? C.good : status === 'error' ? C.alert : C.amber;
  const statusText = status === 'live' ? 'Connesso' : status === 'error' ? 'Dati demo · errore connessione' : status === 'loading' ? 'Caricamento…' : 'Dati demo';

  return (
    <div
      style={{
        background: C.bg,
        color: C.ink,
        fontFamily: "'IBM Plex Sans', sans-serif",
        minHeight: '600px',
        paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
        paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
        boxSizing: 'border-box',
      }}
      className="w-full flex justify-center"
    >
      <style>{FONT_IMPORT + EXTRA_CSS}</style>
      <div className="w-full flex flex-col gap-4" style={{ maxWidth: '420px' }}>

        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div style={{ width: 8, height: 8, borderRadius: 999, background: statusDot }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.14em', fontSize: '13px', fontWeight: 600 }}>
              VOICETRACK
            </span>
          </div>
          <button
            onClick={() => { setConfigDraft(config); setConfigOpen((v) => !v); }}
            style={{ color: C.inkMuted, background: 'transparent', border: 'none', cursor: 'pointer' }}
            className="p-1"
            aria-label="Impostazioni"
          >
            {configOpen ? <X size={18} /> : <Settings size={18} />}
          </button>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: C.inkFaint, marginTop: '-12px' }}>
          {statusText}
        </div>

        {/* Tab bar: Diario (dashboard) | Traccia (voce) */}
        <div className="flex" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '10px', padding: '6px', gap: '28px' }}>
          {[
            { id: 'diario', label: 'Diario', icon: <LayoutGrid size={14} /> },
            { id: 'traccia', label: 'Traccia', icon: <Mic size={14} /> },
            { id: 'scan', label: 'Scan', icon: <ScanLine size={14} /> },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => goToTab(t.id)}
              className="flex items-center justify-center gap-1.5"
              style={{
                flex: 1,
                background: view === t.id ? C.surfaceRaised : 'transparent',
                color: view === t.id ? C.ink : C.inkMuted,
                border: view === t.id ? `1px solid ${C.line}` : '1px solid transparent',
                borderRadius: '7px',
                padding: '8px 0',
                fontSize: '13px',
                fontWeight: view === t.id ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Config panel */}
        {configOpen && (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '10px', padding: '14px' }} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label style={{ fontSize: '11px', color: C.inkMuted, fontFamily: "'IBM Plex Mono', monospace" }}>URL CLOUD FUNCTION</label>
              <input
                value={configDraft.apiUrl}
                onChange={(e) => setConfigDraft((d) => ({ ...d, apiUrl: e.target.value }))}
                placeholder="https://voicetrack-xxxx.run.app"
                style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label style={{ fontSize: '11px', color: C.inkMuted, fontFamily: "'IBM Plex Mono', monospace" }}>API KEY</label>
              <input
                value={configDraft.apiKey}
                onChange={(e) => setConfigDraft((d) => ({ ...d, apiKey: e.target.value }))}
                placeholder="X-API-Key"
                type="password"
                style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}
              />
            </div>
            {status === 'error' && (
              <div className="flex items-start gap-2" style={{ color: C.alert, fontSize: '12px' }}>
                <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>{errorMsg}. Serve un endpoint GET /dashboard sulla Cloud Function — non esiste ancora.</span>
              </div>
            )}
            <div className="flex gap-2 mt-1">
              <button onClick={saveConfig} style={{ background: C.good, color: C.bg, border: 'none', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }} className="flex items-center gap-1">
                <Check size={14} /> Connetti
              </button>
              <button onClick={useDemo} style={{ background: 'transparent', color: C.inkMuted, border: `1px solid ${C.line}`, borderRadius: '6px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer' }}>
                Usa dati demo
              </button>
            </div>
          </div>
        )}

        {/* Carosello schede: swipe a tutta altezza, le altre spuntano dal lato */}
        <div
          ref={pagerRef}
            style={{
            overflow: 'hidden',
            overflowX: 'clip',
            minHeight: 'calc(var(--app-height, 100dvh) - 150px)',
            touchAction: 'pan-y',
            marginLeft: '-16px',
            marginRight: '-16px',
            width: 'calc(100% + 32px)',
            alignSelf: 'stretch',
          }}
          onTouchStart={onTabSwipeStart}
          onTouchMove={onTabSwipeMove}
          onTouchEnd={onTabSwipeEnd}
          onTouchCancel={onTabSwipeEnd}
        >
          <div
            style={{
              display: 'flex',
              width: '100%',
              transform: `translateX(calc(${-Math.max(tabIdx, 0) * 100}% + ${tabDragX}px))`,
              transition: tabDragging ? 'none' : 'transform 0.32s cubic-bezier(0.25, 0.8, 0.25, 1)',
              willChange: 'transform',
            }}
          >
            {/* ================= TAB DIARIO ================= */}
            <div
              className="flex flex-col gap-4"
              style={{
                flex: '0 0 100%',
                minWidth: 0,
                maxWidth: '100%',
                minHeight: 'calc(var(--app-height, 100dvh) - 150px)',
                padding: '0 16px',
                boxSizing: 'border-box',
                pointerEvents: view === 'diario' || tabDragging ? 'auto' : 'none',
              }}
              aria-hidden={view !== 'diario'}
            >
        {/* Carosello giorno: 3 slot (ieri | oggi | domani). Gesto solo sulla card calorie.
            Trend resta fuori così non scorre con il giorno. */}
        <div
          ref={dayPagerRef}
          style={{
            overflow: 'hidden',
            overflowX: 'clip',
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            alignSelf: 'stretch',
          }}
        >
          <div
            ref={dayTrackRef}
            style={{
              display: 'flex',
              width: '100%',
              transform: `translateX(calc(-100% + ${dayDragX}px))`,
              transition: dayDragging ? 'none' : 'transform 0.32s cubic-bezier(0.25, 0.8, 0.25, 1)',
              willChange: 'transform',
            }}
            onTransitionEnd={onDayTrackTransitionEnd}
          >
            <div style={{ flex: '0 0 100%', minWidth: 0, boxSizing: 'border-box' }}>
              <DayPeek
                offset={dayOffset - 1}
                meals={mealsForOffset(dayOffset - 1)}
                loading={metaForOffset(dayOffset - 1).loading}
                error={metaForOffset(dayOffset - 1).error}
                target={target}
              />
            </div>
            <div className="flex flex-col gap-4" style={{ flex: '0 0 100%', minWidth: 0, boxSizing: 'border-box' }}>
        {/* Above the fold: calorie + azioni + macro. Height fissa + grid 1fr/2fr
            evita che la calorie nasca a tutta altezza e poi si restringa. */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: targetsAnimOpen
              ? 'minmax(0, 1fr) minmax(0, 0fr)'
              : 'minmax(0, 1fr) minmax(0, 2fr)',
            gap: targetsAnimOpen ? 0 : '22px',
            height: 'calc(var(--app-height, 100dvh) - 150px)',
            paddingBottom: 'max(40px, env(safe-area-inset-bottom, 0px))',
            boxSizing: 'border-box',
            flexShrink: 0,
            transition: targetsMounted
              ? 'grid-template-rows 0.28s cubic-bezier(0.25, 0.8, 0.25, 1), gap 0.28s cubic-bezier(0.25, 0.8, 0.25, 1)'
              : 'none',
          }}
        >
        {/* Hero: tre slot fissi — data | medio (readout / Obiettivi) | gauge.
            Swipe orizzontale qui cambia giorno (non le tab: data-no-tab-swipe). */}
        <div
          data-no-tab-swipe
          onTouchStart={onDaySwipeStart}
          onTouchMove={onDaySwipeMove}
          onTouchEnd={onDaySwipeEnd}
          onTouchCancel={onDaySwipeEnd}
          style={{
            background: daySurface(dayOffset),
            border: `1px solid ${dayLine(dayOffset)}`,
            borderRadius: '14px',
            padding: '22px 22px 34px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            minHeight: 0,
            overflow: 'hidden',
            overflowY: targetsMounted ? 'hidden' : undefined,
            boxSizing: 'border-box',
            touchAction: 'pan-y',
          }}
        >
          {/* Slot data: nascosto con Obiettivi aperto; torna insieme ad azioni (gate targetsAnimOpen). */}
          <div
            style={{
              flexShrink: 0,
              maxHeight: (targetsOpen || targetsAnimOpen) ? 0 : 40,
              opacity: (targetsOpen || targetsAnimOpen) ? 0 : 1,
              overflow: 'hidden',
              pointerEvents: (targetsOpen || targetsAnimOpen) ? 'none' : 'auto',
              // Niente transition al cold mount (evita maxHeight/opacity che animano e fanno saltare il fold).
              transition: targetsMounted
                ? ((targetsOpen || targetsAnimOpen)
                  ? 'max-height 0.22s ease, opacity 0.15s ease'
                  : 'max-height 0.28s ease, opacity 0.28s ease-out')
                : 'none',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 32px', alignItems: 'center' }}>
              <button
                onClick={() => shiftDay(-1)}
                disabled={!config.apiUrl}
                aria-label="Giorno precedente"
                style={{ background: 'transparent', border: 'none', color: config.apiUrl ? C.inkMuted : C.inkFaint, cursor: config.apiUrl ? 'pointer' : 'default', padding: '4px', display: 'flex', justifyContent: 'center', width: '32px', flexShrink: 0, opacity: config.apiUrl ? 1 : 0.4 }}
              >
                <ChevronLeft size={22} />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', color: dayOffset === 0 ? C.inkMuted : C.ink }}>
                  {diaryDayTitle(dayOffset, selectedDate)}
                </span>
                {dayOffset !== 0 && (
                  <button onClick={() => goToDate(fmtYMD(new Date()))} style={{ color: C.good, background: 'transparent', border: `1px solid ${dayLine(dayOffset)}`, borderRadius: '6px', padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}>
                    {historyLoading ? <Loader2 size={12} className="animate-spin" /> : 'Oggi'}
                  </button>
                )}
              </div>
              <button
                onClick={() => shiftDay(1)}
                disabled={!config.apiUrl}
                aria-label="Giorno successivo"
                style={{ background: 'transparent', border: 'none', color: config.apiUrl ? C.inkMuted : C.inkFaint, cursor: config.apiUrl ? 'pointer' : 'default', padding: '4px', display: 'flex', justifyContent: 'center', width: '32px', flexShrink: 0, opacity: config.apiUrl ? 1 : 0.4 }}
              >
                <ChevronRight size={22} />
              </button>
            </div>
          </div>

          {/* Slot medio: readout centrato; editor absolute a tutta altezza dello slot */}
          <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                minHeight: 0,
                // Nascondi subito in apertura (targetsOpen); al ritorno stesso istante delle azioni.
                opacity: (targetsOpen || targetsAnimOpen) ? 0 : 1,
                pointerEvents: (targetsOpen || targetsAnimOpen) ? 'none' : 'auto',
                transition: targetsMounted
                  ? ((targetsOpen || targetsAnimOpen)
                    ? 'opacity 0.15s ease'
                    : 'opacity 0.28s ease-out')
                  : 'none',
              }}
            >
              <div className="flex items-end justify-between gap-2">
                <div className="flex items-end gap-2 min-w-0">
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '44px', fontWeight: 600, lineHeight: 1 }}>
                    {Math.round(totals.kcal)}
                  </span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '16px', color: C.inkMuted, marginBottom: '6px' }}>
                    / {target.kcal} kcal
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => { setTargetDraft(target); setMacroPct(pctFromGrams(target)); setTargetMsg(''); setTargetsOpen((v) => !v); }}
                  style={{
                    color: C.inkMuted,
                    background: C.surfaceRaised,
                    border: `1px solid ${C.line}`,
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    flexShrink: 0,
                    marginBottom: '4px',
                  }}
                >
                  <SlidersHorizontal size={12} /> Obiettivi
                </button>
              </div>
              <div style={{ marginTop: '4px' }}>
                <span style={{ fontSize: '13px', color: overTarget ? C.alert : C.good }}>
                  {overTarget ? `Superato di ${Math.round(-remaining)} kcal` : `Restano ${Math.round(remaining)} kcal`}
                </span>
              </div>
              {targetMsg && !targetsOpen && (
                <div style={{ fontSize: '11px', color: targetMsg.startsWith('Errore') ? C.alert : C.good, marginTop: '8px' }}>
                  {targetMsg}
                </div>
              )}
            </div>

            {targetsMounted && (
              <div
                className={`vt-edit-collapse${targetsAnimOpen ? ' is-open' : ''}`}
                style={{ position: 'absolute', inset: 0, minHeight: 0, display: 'grid' }}
                onTransitionEnd={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.propertyName !== 'grid-template-rows') return;
                  if (!targetsAnimOpen) {
                    if (targetsCloseTimerRef.current) {
                      clearTimeout(targetsCloseTimerRef.current);
                      targetsCloseTimerRef.current = null;
                    }
                    setTargetsMounted(false);
                  }
                }}
              >
                <div
                  className="vt-edit-collapse-inner"
                  style={{
                    pointerEvents: targetsOpen && targetsAnimOpen ? 'auto' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    height: targetsAnimOpen ? '100%' : undefined,
                  }}
                >
                  <div
                    style={{
                      background: C.surfaceRaised,
                      border: `1px solid ${C.line}`,
                      borderRadius: '10px',
                      padding: '16px',
                      marginTop: '16px',
                      flex: 1,
                      minHeight: 0,
                      justifyContent: 'space-between',
                      boxSizing: 'border-box',
                    }}
                    className="flex flex-col gap-3"
                  >
                    <div className="vt-targets-scroll flex flex-col gap-3" style={{ flex: 1, minHeight: 0 }}>
                      <span style={{ fontSize: '11px', color: C.inkMuted, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.06em' }}>
                        OBIETTIVI GIORNALIERI
                      </span>
                      <KcalSlider value={targetDraft.kcal} onChange={onTargetKcalChange} color={C.ink} />
                      <div className="flex flex-col gap-6" style={{ marginTop: '10px' }}>
                        <MacroSlider label="Proteine" pct={macroPct.p} grams={targetDraft.proteine} onPctChange={(v) => setMacroSlider('p', v)} onGramsChange={(v) => setMacroGrams('p', v)} color={C.protein} />
                        <MacroSlider label="Carboidrati" pct={macroPct.c} grams={targetDraft.carboidrati} onPctChange={(v) => setMacroSlider('c', v)} onGramsChange={(v) => setMacroGrams('c', v)} color={C.carbs} />
                        <MacroSlider label="Grassi" pct={macroPct.g} grams={targetDraft.grassi} onPctChange={(v) => setMacroSlider('g', v)} onGramsChange={(v) => setMacroGrams('g', v)} color={C.fat} />
                      </div>
                      <div style={{ fontSize: '11px', color: macroSum === 100 ? C.inkFaint : C.alert, fontFamily: "'IBM Plex Mono', monospace", marginTop: '2px' }}>
                        Ripartizione: {macroPct.p}% P · {macroPct.c}% C · {macroPct.g}% G = {macroSum}%
                      </div>
                      {targetMsg && (
                        <div style={{ fontSize: '11px', color: /^(Serve|Errore)/.test(targetMsg) ? C.alert : C.good }}>
                          {targetMsg}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2" style={{ flexShrink: 0 }}>
                      <button onClick={saveTargets} disabled={savingTargets} style={{ background: C.good, color: C.bg, border: 'none', borderRadius: '6px', padding: '9px 14px', fontSize: '13px', fontWeight: 600, cursor: savingTargets ? 'default' : 'pointer', opacity: savingTargets ? 0.6 : 1 }} className="flex items-center gap-1">
                        <Check size={14} /> {savingTargets ? 'Salvo…' : (config.apiUrl ? 'Salva sul foglio' : 'Salva')}
                      </button>
                      <button onClick={() => setTargetsOpen(false)} style={{ background: 'transparent', color: C.inkMuted, border: `1px solid ${C.line}`, borderRadius: '6px', padding: '9px 14px', fontSize: '13px', cursor: 'pointer' }}>
                        Annulla
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Slot gauge: nascosto con Obiettivi aperto; torna insieme ad azioni (gate targetsAnimOpen). */}
          <div
            style={{
              flexShrink: 0,
              height: (targetsOpen || targetsAnimOpen) ? 0 : 8,
              marginTop: (targetsOpen || targetsAnimOpen) ? 0 : 14,
              opacity: (targetsOpen || targetsAnimOpen) ? 0 : 1,
              overflow: 'hidden',
              transition: targetsMounted
                ? ((targetsOpen || targetsAnimOpen)
                  ? 'height 0.22s ease, margin-top 0.22s ease, opacity 0.15s ease'
                  : 'height 0.28s ease, margin-top 0.28s ease, opacity 0.28s ease-out')
                : 'none',
            }}
          >
            <div style={{ height: '8px', borderRadius: '999px', background: C.line, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(pct, 1) * 100}%`, height: '100%',
                background: overTarget ? C.alert : C.good, borderRadius: '999px',
              }} />
              {overTarget && (
                <div style={{ position: 'absolute', left: '100%', top: 0, height: '100%', width: `${Math.min(pct - 1, 0.25) * 100}%`, background: C.alert, opacity: 0.5 }} />
              )}
            </div>
          </div>
        </div>

        {/* Azioni + macro: seconda riga della grid; collassa con Obiettivi (0fr). */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '22px',
            minHeight: 0,
            overflow: 'hidden',
            opacity: targetsAnimOpen ? 0 : 1,
            pointerEvents: targetsAnimOpen ? 'none' : 'auto',
            transition: targetsMounted ? 'opacity 0.22s ease' : 'none',
          }}
          aria-hidden={targetsAnimOpen}
        >
        {/* Azioni rapide: testo / barcode / voce → tab Traccia o Scan */}
          <div
            style={{
              background: daySurface(dayOffset),
              border: `1px solid ${dayLine(dayOffset)}`,
              borderRadius: '14px',
              padding: '18px 22px',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minHeight: 0,
            }}
          >
            <div className="flex items-center" style={{ justifyContent: 'space-around' }}>
              {[
                { id: 'text', label: 'TESTO', aria: 'Scrivi un pasto', icon: <Keyboard size={22} />, action: 'text' },
                { id: 'cerca', label: 'CERCA', aria: 'Cerca nel catalogo', icon: <Search size={22} />, action: 'cerca' },
                { id: 'scan', label: 'SCAN', aria: 'Scansiona un barcode', icon: <ScanLine size={22} />, action: 'scan' },
                { id: 'voice', label: 'VOCE', aria: 'Registra a voce', icon: <Mic size={22} />, action: 'voice' },
              ].map((btn) => (
                <div key={btn.id} className="flex flex-col items-center" style={{ gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => launchQuickAction(btn.action)}
                    aria-label={btn.aria}
                    style={{
                      width: '56px', height: '56px', borderRadius: '999px',
                      border: `1px solid ${C.line}`,
                      background: C.surfaceRaised,
                      color: C.ink,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {btn.icon}
                  </button>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', color: C.inkMuted, letterSpacing: '0.06em' }}>
                    {btn.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

        {/* Plate / macro breakdown */}
        <div
          style={{
            background: daySurface(dayOffset),
            border: `1px solid ${dayLine(dayOffset)}`,
            borderRadius: '14px',
            padding: '22px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minHeight: 0,
          }}
        >
          <span style={{ fontSize: '12px', color: C.inkMuted }}>Macronutrienti</span>
          <div className="flex items-center gap-4 mt-3">
            <div style={{ width: '110px', height: '110px', position: 'relative', flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={macroCalData} dataKey="cal" innerRadius={34} outerRadius={52} startAngle={90} endAngle={-270} stroke="none">
                    {macroCalData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UtensilsCrossed size={18} color={C.inkFaint} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
              <MacroRow icon={<Beef size={14} color={C.protein} />} label="Proteine" grams={totals.proteine} target={target.proteine} color={C.protein} />
              <MacroRow icon={<Wheat size={14} color={C.carbs} />} label="Carboidrati" grams={totals.carboidrati} target={target.carboidrati} color={C.carbs} />
              <MacroRow icon={<Droplet size={14} color={C.fat} />} label="Grassi" grams={totals.grassi} target={target.grassi} color={C.fat} />
            </div>
          </div>
        </div>
        </div>
        </div>

        {/* Meal log */}
        <div style={{ background: daySurface(dayOffset), border: `1px solid ${dayLine(dayOffset)}`, borderRadius: '14px', padding: '20px' }}>
          <span style={{ fontSize: '12px', color: C.inkMuted }}>
            {diaryMealsHeading(dayOffset, selectedDate)} · {displayedMeals.length}
          </span>
          {historyError && dayOffset !== 0 && (
            <div className="flex items-center gap-2 mt-2" style={{ color: C.alert, fontSize: '12px' }}>
              <AlertCircle size={13} /><span>{historyError}</span>
            </div>
          )}
          {grouped.length === 0 ? (
            <div className="flex items-center gap-2 mt-3" style={{ color: C.inkFaint, fontSize: '13px' }}>
              <Mic size={14} />
              <span>
                {dayOffset === 0
                  ? 'Nessun pasto registrato. Di\' "traccia pasto" per iniziare.'
                  : historyLoading ? 'Carico il giorno\u2026' : 'Nessun pasto registrato in questo giorno.'}
              </span>
            </div>
          ) : (
            <div className="flex flex-col mt-2">
              {grouped.map((g) => (
                <div key={g.pasto} className="mt-3">
                  <div style={{ fontSize: '11px', fontWeight: 600, color: C.inkMuted, letterSpacing: '0.06em', marginBottom: '6px' }}>
                    {PASTO_LABEL[g.pasto] || g.pasto}
                  </div>
                  {g.items.map((m) => {
                    const catEntry = findCatalogForAlimento(m.alimento);
                    return (
                      <MealRow
                        key={m.id}
                        meal={m}
                        editable={isEditable(m)}
                        isEditing={editingId === m.id}
                        confirming={confirmDeleteId === m.id}
                        confirmingEdit={confirmEditId === m.id}
                        active={swipeId === m.id}
                        swipeX={swipeId === m.id ? swipeX : 0}
                        editDraft={editDraft}
                        setEditDraft={setEditDraft}
                        editBusy={editBusy}
                        editError={editError}
                        onOpenEdit={openEdit}
                        onCloseEdit={closeEdit}
                        onSave={saveEdit}
                        onAskDelete={(id) => { setConfirmEditId(null); setConfirmDeleteId(id); }}
                        onCancelDelete={() => { setConfirmDeleteId(null); setSwipeId(null); setSwipeX(0); }}
                        onCancelEditConfirm={() => { setConfirmEditId(null); setSwipeId(null); setSwipeX(0); }}
                        onDelete={deleteMeal}
                        onTouchStart={onRowTouchStart}
                        onTouchMove={onRowTouchMove}
                        onTouchEnd={onRowTouchEnd}
                        suppressClickRef={suppressRowClickRef}
                        onCatalogStar={config.apiUrl ? onMealCatalogStarClick : undefined}
                        catalogStarFilled={!!catEntry?.preferito}
                        catalogStarBusy={!!catEntry?.id && catalogStarBusyId === catEntry.id}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
            </div>
            <div style={{ flex: '0 0 100%', minWidth: 0, boxSizing: 'border-box' }}>
              {dayOffset < 0 ? (
                <DayPeek
                  offset={dayOffset + 1}
                  meals={mealsForOffset(dayOffset + 1)}
                  loading={metaForOffset(dayOffset + 1).loading}
                  error={metaForOffset(dayOffset + 1).error}
                  target={target}
                />
              ) : null}
            </div>
          </div>
        </div>

        {/* Trend: settimana / mese / anno */}
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '20px' }}>
          <div className="flex items-center justify-between" style={{ gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: C.inkMuted, flex: 1, minWidth: 0 }}>
              {TREND_TITLE[trendRange]}
            </span>
          </div>
          <div
            className="flex"
            style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '3px', gap: '2px', marginBottom: '10px' }}
          >
            {TREND_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setTrendRange(r.id)}
                style={{
                  flex: 1,
                  background: trendRange === r.id ? C.surfaceRaised : 'transparent',
                  color: trendRange === r.id ? C.ink : C.inkMuted,
                  border: trendRange === r.id ? `1px solid ${C.line}` : '1px solid transparent',
                  borderRadius: '6px',
                  padding: '6px 4px',
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: trendRange === r.id ? 600 : 400,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div style={{ height: '110px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={<WeekAxisTick week={trendData} selectedDate={selectedDateStr} onSelect={goToDate} />}
                  axisLine={{ stroke: C.line }}
                  tickLine={false}
                />
                <ReferenceLine y={target.kcal} stroke={C.inkFaint} strokeDasharray="3 3" />
                <Bar dataKey="kcal" radius={[4, 4, 0, 0]} onClick={(d) => goToDate(d?.date)}>
                  {trendData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.kcal > target.kcal ? C.alert : C.good}
                      opacity={d.date === selectedDateStr ? 1 : 0.85}
                      stroke={d.date === selectedDateStr ? C.ink : 'none'}
                      strokeWidth={d.date === selectedDateStr ? 1 : 0}
                      cursor={d.date ? 'pointer' : 'default'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: C.inkFaint, textAlign: 'center', paddingBottom: '4px' }}>
          {dayOffset !== 0
            ? `Stai sfogliando il diario · tocca "Oggi" per tornare`
            : status === 'demo' || status === 'error'
              ? 'Dati di esempio — collega il tuo endpoint dalle impostazioni'
              : lastSync
                ? `Aggiornato alle ${lastSync.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · si aggiorna da solo`
                : 'Aggiornato ora'}
        </div>
            </div>

        {/* ================= TAB TRACCIA ================= */}
            <div
              className="flex flex-col gap-4"
              style={{
                flex: '0 0 100%',
                minWidth: 0,
                maxWidth: '100%',
                minHeight: 'calc(var(--app-height, 100dvh) - 150px)',
                padding: '0 16px',
                boxSizing: 'border-box',
                pointerEvents: view === 'traccia' || tabDragging ? 'auto' : 'none',
              }}
              aria-hidden={view !== 'traccia'}
            >

            {/* Scheda microfono */}
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '28px 20px' }} className="flex flex-col items-center gap-3">
              {!config.apiUrl ? (
                <div className="flex items-start gap-2" style={{ color: C.inkMuted, fontSize: '13px' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px', color: C.amber }} />
                  <span>Per tracciare collega il tuo endpoint dalle impostazioni (icona ingranaggio in alto).</span>
                </div>
              ) : (
                <>
                  {speechSupported ? (
                    <>
                      <button
                        onClick={onMicTap}
                        aria-label={micState === 'listening' ? 'Ferma e invia' : 'Parla'}
                        style={{
                          width: '96px', height: '96px', borderRadius: '999px',
                          border: `1px solid ${micState === 'listening' ? C.good : C.line}`,
                          background: micState === 'listening' ? C.good : C.surfaceRaised,
                          color: micState === 'listening' ? C.bg : C.ink,
                          cursor: (micState === 'idle' || micState === 'listening') ? 'pointer' : 'default',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          animation: micState === 'listening' ? 'vt-pulse 1.6s ease-out infinite' : 'none',
                          opacity: (micState === 'processing' || micState === 'speaking') ? 0.7 : 1,
                        }}
                      >
                        {micState === 'processing'
                          ? <Loader2 size={34} className="animate-spin" />
                          : micState === 'speaking'
                            ? <Volume2 size={34} />
                            : <Mic size={34} />}
                      </button>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: C.inkMuted, letterSpacing: '0.06em' }}>
                        {micState === 'idle' && (pendingTextRef.current ? 'TOCCA E RISPONDI' : 'TOCCA E PARLA')}
                        {micState === 'listening' && 'TI ASCOLTO\u2026 (tocca per inviare)'}
                        {micState === 'processing' && 'ELABORO\u2026'}
                        {micState === 'speaking' && 'RISPONDO\u2026'}
                      </span>
                    </>
                  ) : (
                    <div className="flex items-start gap-2" style={{ color: C.inkMuted, fontSize: '13px' }}>
                      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px', color: C.amber }} />
                      <span>Questo browser non supporta il riconoscimento vocale (usa Chrome). Puoi comunque scrivere il pasto qui sotto.</span>
                    </div>
                  )}

                  {/* Trascrizione live: il feedback che in Tasker non hai */}
                  {transcript && (
                    <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: '10px', padding: '10px 12px', fontSize: '14px', color: C.ink, width: '100%', textAlign: 'center' }}>
                      "{transcript}"
                    </div>
                  )}

                  {/* Input digitato: stessa pipeline, fonte = pwa-testo */}
                  <div className="flex items-center w-full" style={{ gap: '8px', marginTop: '4px' }}>
                    <input
                      ref={typedInputRef}
                      value={typedText}
                      onChange={(e) => setTypedText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitTyped(); }}
                      disabled={micState !== 'idle'}
                      placeholder={pendingTextRef.current ? 'Scrivi la risposta\u2026' : 'Oppure scrivi il pasto\u2026'}
                      style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '8px', padding: '10px 12px', fontSize: '14px', opacity: micState !== 'idle' ? 0.5 : 1 }}
                    />
                    <button
                      onClick={submitTyped}
                      disabled={micState !== 'idle' || !typedText.trim()}
                      aria-label="Invia"
                      style={{
                        background: typedText.trim() && micState === 'idle' ? C.good : C.surfaceRaised,
                        color: typedText.trim() && micState === 'idle' ? C.bg : C.inkFaint,
                        border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px 12px',
                        cursor: typedText.trim() && micState === 'idle' ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Chiarimento in corso */}
            {clarifyQuestion && !trackResult && (
              <div style={{ background: C.surface, border: `1px solid ${C.amber}`, borderRadius: '14px', padding: '16px 20px' }} className="flex flex-col gap-2">
                <div className="flex items-center gap-2" style={{ color: C.amber, fontSize: '12px', fontWeight: 600 }}>
                  <MessageCircleQuestion size={15} /> Serve un chiarimento
                </div>
                <span style={{ fontSize: '14px' }}>{clarifyQuestion}</span>
                {pendingTextRef.current && (
                  <span style={{ fontSize: '11px', color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>
                    In sospeso: "{pendingTextRef.current}"
                  </span>
                )}
              </div>
            )}

            {/* Risultato del log */}
            {trackResult?.items && (
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '20px' }}>
                <div className="flex items-center gap-2" style={{ color: C.good, fontSize: '12px', fontWeight: 600 }}>
                  <Check size={15} /> Registrato
                </div>
                <div className="flex flex-col mt-2">
                  {trackResult.items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between" style={{ padding: '6px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.line}` }}>
                      <div className="flex flex-col">
                        <span style={{ fontSize: '13px' }}>{it.alimento}</span>
                        <span style={{ fontSize: '11px', color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>{it.grammi}g</span>
                      </div>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: C.inkMuted, flexShrink: 0, paddingLeft: '10px' }}>
                        {Math.round(it.kcal)}
                      </span>
                    </div>
                  ))}
                </div>
                {trackResult.totale && (
                  <div className="flex items-center justify-between" style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: '12px', color: C.inkMuted }}>Totale</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 600 }}>
                      {Math.round(trackResult.totale.kcal)} kcal ·{' '}
                      <span style={{ color: C.protein }}>{Math.round(trackResult.totale.proteine)}P</span>{' '}
                      <span style={{ color: C.carbs }}>{Math.round(trackResult.totale.carboidrati)}C</span>{' '}
                      <span style={{ color: C.fat }}>{Math.round(trackResult.totale.grassi)}G</span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Errore */}
            {trackError && (
              <div className="flex items-start gap-2" style={{ background: C.surface, border: `1px solid ${C.alert}`, borderRadius: '14px', padding: '14px 20px', color: C.alert, fontSize: '13px' }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{trackError}</span>
              </div>
            )}

            {/* Riepilogo giornata vocale */}
            {speechSupported && config.apiUrl && (
              <button
                onClick={speakSummary}
                disabled={summaryBusy || micState !== 'idle'}
                className="flex items-center justify-center gap-2"
                style={{
                  background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px',
                  padding: '14px', color: C.ink, fontSize: '14px',
                  cursor: (summaryBusy || micState !== 'idle') ? 'default' : 'pointer',
                  opacity: (summaryBusy || micState !== 'idle') ? 0.5 : 1,
                }}
              >
                {summaryBusy ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
                Riepilogo giornata
              </button>
            )}

            <div style={{ fontSize: '11px', color: C.inkFaint, textAlign: 'center', paddingBottom: '4px' }}>
              Riconoscimento in italiano (it-IT) · fonte sul foglio: "pwa-voce" o "pwa-testo"
            </div>
            </div>

        {/* ================= TAB SCAN (Deploy 4) ================= */}
            <div
              className="flex flex-col gap-4"
              style={{
                flex: '0 0 100%',
                minWidth: 0,
                maxWidth: '100%',
                minHeight: 'calc(var(--app-height, 100dvh) - 150px)',
                padding: '0 16px',
                boxSizing: 'border-box',
                pointerEvents: view === 'scan' || tabDragging ? 'auto' : 'none',
              }}
              aria-hidden={view !== 'scan'}
            >

            {/* Scheda scanner */}
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '24px 20px' }} className="flex flex-col items-center gap-3">
              {!config.apiUrl ? (
                <div className="flex items-start gap-2" style={{ color: C.inkMuted, fontSize: '13px' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px', color: C.amber }} />
                  <span>Per scansionare collega il tuo endpoint dalle impostazioni (icona ingranaggio in alto).</span>
                </div>
              ) : !barcodeSupported ? (
                <div className="flex items-start gap-2" style={{ color: C.inkMuted, fontSize: '13px' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px', color: C.amber }} />
                  <span>Questo browser non supporta la lettura dei codici a barre (BarcodeDetector). Usa Chrome su Android, oppure registra il prodotto a voce dal tab Traccia.</span>
                </div>
              ) : scanState === 'scanning' ? (
                <>
                  <div data-no-tab-swipe style={{ width: '100%', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${C.good}`, position: 'relative' }}>
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      style={{ width: '100%', display: 'block', maxHeight: '260px', objectFit: 'cover', background: C.bg, transform: `scale(${SCAN_DIGITAL_ZOOM})`, transformOrigin: 'center center' }}
                    />
                    {/* Linea di mira */}
                    <div style={{ position: 'absolute', left: '10%', right: '10%', top: '50%', height: '2px', background: C.good, opacity: 0.7 }} />
                  </div>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: C.inkMuted, letterSpacing: '0.06em' }}>
                    INQUADRA IL CODICE A BARRE
                  </span>
                  <button
                    onClick={resetScan}
                    style={{ background: 'transparent', color: C.inkMuted, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '8px 16px', fontSize: '13px', cursor: 'pointer' }}
                  >
                    Annulla
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={startScan}
                    disabled={scanState !== 'idle'}
                    aria-label="Scansiona un prodotto"
                    style={{
                      width: '96px', height: '96px', borderRadius: '999px',
                      border: `1px solid ${C.line}`,
                      background: C.surfaceRaised,
                      color: C.ink,
                      cursor: scanState === 'idle' ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: scanState === 'idle' ? 1 : 0.7,
                    }}
                  >
                    {scanState === 'processing'
                      ? <Loader2 size={34} className="animate-spin" />
                      : scanState === 'speaking'
                        ? <Volume2 size={34} />
                        : <Camera size={34} />}
                  </button>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: C.inkMuted, letterSpacing: '0.06em' }}>
                    {scanState === 'idle' && 'TOCCA E INQUADRA'}
                    {scanState === 'processing' && 'CERCO IL PRODOTTO\u2026'}
                    {scanState === 'speaking' && 'RISPONDO\u2026'}
                    {scanState === 'asking_qty' && 'INDICA LA QUANTIT\u00c0'}
                  </span>
                </>
              )}
            </div>

            {/* Inserimento manuale EAN: alternativa alla fotocamera e correzione
                per quando lo scan legge un codice sbagliato (§ segnalazione utente). */}
            {config.apiUrl && scanState !== 'scanning' && (
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '14px 20px' }} className="flex flex-col gap-2">
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: C.inkMuted, letterSpacing: '0.06em', textAlign: 'center', width: '100%' }}>
                  INSERIMENTO MANUALE
                </span>
                <div className="flex items-center w-full" style={{ gap: '8px' }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={manualEan}
                    onChange={(e) => setManualEan(e.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitManualEan(); }}
                    disabled={scanState !== 'idle'}
                    placeholder="es. 8001364110680"
                    style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '8px', padding: '10px 12px', fontSize: '14px', fontFamily: "'IBM Plex Mono', monospace", opacity: scanState !== 'idle' ? 0.5 : 1 }}
                  />
                  <button
                    onClick={submitManualEan}
                    disabled={scanState !== 'idle' || manualEan.length < 8}
                    aria-label="Cerca il codice inserito"
                    style={{
                      background: scanState === 'idle' && manualEan.length >= 8 ? C.good : C.surfaceRaised,
                      color: scanState === 'idle' && manualEan.length >= 8 ? C.bg : C.inkFaint,
                      border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px 12px',
                      cursor: scanState === 'idle' && manualEan.length >= 8 ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center',
                    }}
                  >
                    <Check size={16} />
                  </button>
                </div>
                {speechSupported && (
                  <div className="flex flex-col items-center gap-3 w-full" style={{ marginTop: '24px', marginBottom: '18px' }}>
                    <button
                      type="button"
                      onClick={listenManualEan}
                      disabled={scanState !== 'idle' || eanListening}
                      aria-label="Detta l'EAN"
                      style={{
                        width: '96px', height: '96px', borderRadius: '999px',
                        background: eanListening ? C.good : C.surfaceRaised,
                        color: eanListening ? C.bg : C.ink,
                        border: `1px solid ${C.line}`,
                        cursor: scanState === 'idle' && !eanListening ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: scanState !== 'idle' ? 0.5 : 1,
                        animation: eanListening ? 'vt-pulse 1.6s ease-out infinite' : 'none',
                      }}
                    >
                      <Mic size={34} />
                    </button>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: C.inkMuted, letterSpacing: '0.06em' }}>
                      OPPURE DETTA IL CODICE EAN
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Prodotto trovato: chiede la quantita' (touch default + mic opzionale, §9.3) */}
            {scanProduct && (scanState === 'asking_qty' || scanState === 'processing' || scanState === 'speaking') && (
              <div style={{ background: C.surface, border: `1px solid ${C.amber}`, borderRadius: '14px', padding: '16px 20px' }} className="flex flex-col gap-3">
                <div className="flex items-center gap-2" style={{ color: C.amber, fontSize: '12px', fontWeight: 600 }}>
                  <MessageCircleQuestion size={15} /> Quanti grammi?
                </div>
                <div className="flex flex-col">
                  <span style={{ fontSize: '14px' }}>{scanProduct.nome}</span>
                  {scanProduct.per_100g && (
                    <span style={{ fontSize: '11px', color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace", marginTop: '2px' }}>
                      per 100g: {Math.round(scanProduct.per_100g.kcal)} kcal ·{' '}
                      <span style={{ color: C.protein }}>{Math.round(scanProduct.per_100g.proteine)}P</span>{' '}
                      <span style={{ color: C.carbs }}>{Math.round(scanProduct.per_100g.carboidrati)}C</span>{' '}
                      <span style={{ color: C.fat }}>{Math.round(scanProduct.per_100g.grassi)}G</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center w-full" style={{ gap: '8px' }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    value={scanQty}
                    onChange={(e) => setScanQty(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmQty(); }}
                    disabled={scanState !== 'asking_qty'}
                    placeholder="grammi"
                    style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '8px', padding: '10px 12px', fontSize: '14px', fontFamily: "'IBM Plex Mono', monospace", opacity: scanState !== 'asking_qty' ? 0.5 : 1 }}
                  />
                  {speechSupported && (
                    <button
                      onClick={listenQty}
                      disabled={scanState !== 'asking_qty' || qtyListening}
                      aria-label="Detta la quantit\u00e0"
                      style={{
                        background: qtyListening ? C.good : C.surfaceRaised,
                        color: qtyListening ? C.bg : C.ink,
                        border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px 12px',
                        cursor: scanState === 'asking_qty' && !qtyListening ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center',
                        animation: qtyListening ? 'vt-pulse 1.6s ease-out infinite' : 'none',
                      }}
                    >
                      <Mic size={16} />
                    </button>
                  )}
                  <button
                    onClick={confirmQty}
                    disabled={scanState !== 'asking_qty' || !parseFloat(String(scanQty).replace(',', '.'))}
                    aria-label="Conferma quantit\u00e0"
                    style={{
                      background: scanState === 'asking_qty' && parseFloat(String(scanQty).replace(',', '.')) > 0 ? C.good : C.surfaceRaised,
                      color: scanState === 'asking_qty' && parseFloat(String(scanQty).replace(',', '.')) > 0 ? C.bg : C.inkFaint,
                      border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px 12px',
                      cursor: scanState === 'asking_qty' ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center',
                    }}
                  >
                    <Check size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Prodotto non trovato (§3.9): messaggio chiaro, nessuna riga scritta */}
            {scanNotFound && (
              <div className="flex flex-col gap-2" style={{ background: C.surface, border: `1px solid ${C.amber}`, borderRadius: '14px', padding: '14px 20px', fontSize: '13px' }}>
                <div className="flex items-start gap-2" style={{ color: C.amber }}>
                  <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>{scanNotFound}</span>
                </div>
                {!catalogFormOpen ? (
                  <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setCatalogFormOpen(true)}
                      style={{ alignSelf: 'flex-start', background: C.good, color: C.bg, border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Aggiungi al catalogo
                    </button>
                    <button
                      onClick={() => { goToTab('traccia'); }}
                      style={{ alignSelf: 'flex-start', background: 'transparent', color: C.good, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                    >
                      Registralo a voce →
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2" style={{ marginTop: '4px' }}>
                    <span style={{ fontSize: '11px', color: C.inkMuted, fontFamily: "'IBM Plex Mono', monospace" }}>
                      Valori per 100 g{scanBarcodeForCatalog ? ` · EAN ${scanBarcodeForCatalog}` : ''}
                    </span>
                    <input
                      value={catalogForm.nome}
                      onChange={(e) => setCatalogForm((f) => ({ ...f, nome: e.target.value }))}
                      placeholder="Nome prodotto"
                      style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '8px', padding: '8px 10px', fontSize: '13px' }}
                    />
                    <div className="flex" style={{ gap: '6px' }}>
                      {[
                        { k: 'kcal', ph: 'kcal' },
                        { k: 'proteine', ph: 'P' },
                        { k: 'carboidrati', ph: 'C' },
                        { k: 'grassi', ph: 'G' },
                      ].map((f) => (
                        <input
                          key={f.k}
                          value={catalogForm[f.k]}
                          onChange={(e) => setCatalogForm((prev) => ({ ...prev, [f.k]: e.target.value }))}
                          inputMode="decimal"
                          placeholder={f.ph}
                          style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '8px', padding: '8px 6px', fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace", minWidth: 0 }}
                        />
                      ))}
                    </div>
                    {catalogFormMsg && (
                      <span style={{ fontSize: '12px', color: catalogFormMsg.includes('Salvato') ? C.good : C.alert }}>{catalogFormMsg}</span>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={submitScanCatalogForm}
                        disabled={catalogFormBusy}
                        style={{ background: C.good, color: C.bg, border: 'none', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', fontWeight: 600, cursor: catalogFormBusy ? 'default' : 'pointer', opacity: catalogFormBusy ? 0.6 : 1 }}
                      >
                        {catalogFormBusy ? 'Salvo…' : 'Salva'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setCatalogFormOpen(false); setCatalogFormMsg(''); }}
                        style={{ background: 'transparent', color: C.inkMuted, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer' }}
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Risultato del log (stessa scheda del tab Traccia) */}
            {scanResult?.items && (
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '20px' }}>
                <div className="flex items-center gap-2" style={{ color: C.good, fontSize: '12px', fontWeight: 600 }}>
                  <Check size={15} /> Registrato
                </div>
                <div className="flex flex-col mt-2">
                  {scanResult.items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between" style={{ padding: '6px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.line}` }}>
                      <div className="flex flex-col">
                        <span style={{ fontSize: '13px' }}>{it.alimento}</span>
                        <span style={{ fontSize: '11px', color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>{it.grammi}g</span>
                      </div>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: C.inkMuted, flexShrink: 0, paddingLeft: '10px' }}>
                        {Math.round(it.kcal)}
                      </span>
                    </div>
                  ))}
                </div>
                {scanResult.totale && (
                  <div className="flex items-center justify-between" style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: '12px', color: C.inkMuted }}>Totale</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 600 }}>
                      {Math.round(scanResult.totale.kcal)} kcal ·{' '}
                      <span style={{ color: C.protein }}>{Math.round(scanResult.totale.proteine)}P</span>{' '}
                      <span style={{ color: C.carbs }}>{Math.round(scanResult.totale.carboidrati)}C</span>{' '}
                      <span style={{ color: C.fat }}>{Math.round(scanResult.totale.grassi)}G</span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Errore */}
            {scanError && (
              <div className="flex items-start gap-2" style={{ background: C.surface, border: `1px solid ${C.alert}`, borderRadius: '14px', padding: '14px 20px', color: C.alert, fontSize: '13px' }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{scanError}</span>
              </div>
            )}

            <div style={{ fontSize: '11px', color: C.inkFaint, textAlign: 'center', paddingBottom: '4px' }}>
              Open Food Facts · EAN-13 / EAN-8 · fonte sul foglio: "pwa-barcode"
            </div>
            </div>
          </div>
        </div>
      </div>
      {searchOpen && (
        <div
          data-no-tab-swipe
          role="dialog"
          aria-modal="true"
          aria-label="Cerca prodotto"
          onClick={(e) => { if (e.target === e.currentTarget) closeSearch(); }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: `rgba(18, 22, 19, ${0.78 * (1 - Math.min(searchDragY / 280, 0.55))})`,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'stretch',
            paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
            paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
            paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
            boxSizing: 'border-box',
          }}
        >
          <div
            className="flex flex-col"
            style={{
              width: '100%',
              maxWidth: '420px',
              background: C.bg,
              borderRadius: '16px',
              border: `1px solid ${C.line}`,
              overflow: 'hidden',
              maxHeight: '100%',
              transform: searchDragY ? `translateY(${searchDragY}px)` : 'none',
              transition: searchDragging ? 'none' : 'transform 0.22s ease-out',
              willChange: searchDragging ? 'transform' : 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between"
              style={{
                padding: '14px 16px',
                borderBottom: `1px solid ${C.line}`,
                flexShrink: 0,
                touchAction: 'none',
                cursor: 'grab',
              }}
              onTouchStart={onSearchDismissStart}
              onTouchMove={onSearchDismissMove}
              onTouchEnd={onSearchDismissEnd}
              onTouchCancel={onSearchDismissEnd}
            >
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', letterSpacing: '0.08em', fontWeight: 600 }}>CERCA</span>
              <button type="button" onClick={closeSearch} aria-label="Chiudi" style={{ background: 'transparent', border: 'none', color: C.inkMuted, cursor: 'pointer', padding: '4px', display: 'flex' }}>
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col gap-3" style={{ padding: '14px 16px', flexShrink: 0 }}>
              {!config.apiUrl ? (
                <div className="flex items-start gap-2" style={{ color: C.inkMuted, fontSize: '13px' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px', color: C.amber }} />
                  <span>Collega l'endpoint dalle impostazioni per cercare nel catalogo.</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center" style={{ gap: '8px' }}>
                    <input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => { const v = e.target.value; setSearchQuery(v); scheduleSearch(v); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); runSearch(searchQuery); } }}
                      placeholder="Cerca prodotto o frequenti…"
                      style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '8px', padding: '10px 12px', fontSize: '14px' }}
                    />
                    {speechSupported && (
                      <button type="button" onClick={listenSearchQuery} disabled={micState !== 'idle'} aria-label="Cerca a voce" style={{ background: micState === 'listening' ? C.good : C.surfaceRaised, color: micState === 'listening' ? C.bg : C.ink, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px 12px', cursor: micState === 'idle' ? 'pointer' : 'default', display: 'flex', alignItems: 'center', animation: micState === 'listening' ? 'vt-pulse 1.6s ease-out infinite' : 'none' }}>
                        <Mic size={16} />
                      </button>
                    )}
                    <button type="button" onClick={() => runSearch(searchQuery)} aria-label="Cerca" style={{ background: C.good, color: C.bg, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      {searchBusy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                    </button>
                  </div>
                  <span style={{ fontSize: '11px', color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>
                    {searchQuery.trim() ? 'Risultati catalogo + Open Food Facts' : 'I tuoi frequenti e preferiti'}
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-col gap-3" style={{ padding: '0 16px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {searchProduct && (
                <div style={{ background: C.surface, border: `1px solid ${C.good}`, borderRadius: '14px', padding: '16px' }} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col" style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: '14px', fontWeight: 600 }}>{searchProduct.nome}</span>
                      <span style={{ fontSize: '11px', color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>
                        {Math.round(searchProduct.per_100g?.kcal || 0)} kcal/100g
                        {searchProduct.origine === 'off' ? ' · OFF' : ''}
                      </span>
                    </div>
                    {searchProduct.origine !== 'off' && searchProduct.id && (
                      <button
                        type="button"
                        aria-label={searchProduct.preferito ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                        disabled={catalogStarBusyId === searchProduct.id}
                        onClick={() => toggleCatalogPreferito(searchProduct)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '36px', height: '36px', padding: 0, flexShrink: 0,
                          background: C.surfaceRaised, border: `1px solid ${C.line}`, borderRadius: '8px',
                          color: C.amber, cursor: catalogStarBusyId === searchProduct.id ? 'default' : 'pointer',
                          opacity: catalogStarBusyId === searchProduct.id ? 0.55 : 1,
                        }}
                      >
                        <Star size={16} fill={searchProduct.preferito ? 'currentColor' : 'none'} />
                      </button>
                    )}
                    <button type="button" onClick={() => setSearchProduct(null)} style={{ background: 'transparent', border: 'none', color: C.inkMuted, cursor: 'pointer', padding: '4px' }} aria-label="Annulla">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="flex items-center" style={{ gap: '8px' }}>
                    <input value={searchQty} onChange={(e) => setSearchQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmSearchQty(); }} inputMode="decimal" placeholder="Grammi…" style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '8px', padding: '10px 12px', fontSize: '14px' }} />
                    {speechSupported && (
                      <button type="button" onClick={listenSearchQty} disabled={searchQtyListening || searchLogBusy} aria-label="Grammi a voce" style={{ background: searchQtyListening ? C.good : C.surfaceRaised, color: searchQtyListening ? C.bg : C.ink, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px 12px', cursor: !searchQtyListening ? 'pointer' : 'default', display: 'flex', alignItems: 'center', animation: searchQtyListening ? 'vt-pulse 1.6s ease-out infinite' : 'none' }}>
                        <Mic size={16} />
                      </button>
                    )}
                    <button type="button" onClick={confirmSearchQty} disabled={searchLogBusy || !(parseFloat(String(searchQty).replace(',', '.')) > 0)} aria-label="Conferma" style={{ background: parseFloat(String(searchQty).replace(',', '.')) > 0 ? C.good : C.surfaceRaised, color: parseFloat(String(searchQty).replace(',', '.')) > 0 ? C.bg : C.inkFaint, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      {searchLogBusy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    </button>
                  </div>
                </div>
              )}
              {searchError && (
                <div className="flex items-start gap-2" style={{ background: C.surface, border: `1px solid ${C.alert}`, borderRadius: '14px', padding: '14px', color: C.alert, fontSize: '13px' }}>
                  <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>{searchError}</span>
                </div>
              )}
              {searchResult?.items && (
                <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '16px' }}>
                  <div className="flex items-center gap-2" style={{ color: C.good, fontSize: '12px', fontWeight: 600 }}>
                    <Check size={15} /> Registrato
                  </div>
                  <div className="flex flex-col mt-2">
                    {searchResult.items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between" style={{ padding: '6px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.line}` }}>
                        <div className="flex flex-col">
                          <span style={{ fontSize: '13px' }}>{it.alimento}</span>
                          <span style={{ fontSize: '11px', color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>{it.grammi}g</span>
                        </div>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: C.inkMuted }}>{Math.round(it.kcal)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!searchProduct && (
                <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '8px 12px' }}>
                  {searchBusy && searchResults.length === 0 ? (
                    <div className="flex items-center gap-2" style={{ color: C.inkMuted, fontSize: '13px', padding: '8px 0' }}>
                      <Loader2 size={14} className="animate-spin" /> Cerco…
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div style={{ color: C.inkFaint, fontSize: '13px', padding: '8px 0' }}>
                      Nessun risultato. Scansiona un prodotto o aggiungilo al catalogo.
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {searchResults.map((item, idx) => {
                        const isCatalog = item.origine !== 'off' && !!item.id;
                        const starBusy = catalogStarBusyId === item.id;
                        return (
                          <div
                            key={item.id || item.barcode || `${item.nome}-${idx}`}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '6px',
                              padding: '6px 0',
                              borderTop: idx === 0 ? 'none' : `1px solid ${C.line}`,
                            }}
                          >
                            {isCatalog && (
                              <button
                                type="button"
                                aria-label={item.preferito ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                                disabled={starBusy}
                                onClick={() => toggleCatalogPreferito(item)}
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  width: '32px', height: '32px', padding: 0, flexShrink: 0,
                                  background: 'transparent', border: 'none',
                                  color: C.amber, cursor: starBusy ? 'default' : 'pointer',
                                  opacity: starBusy ? 0.55 : 1,
                                }}
                              >
                                <Star size={15} fill={item.preferito ? 'currentColor' : 'none'} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => selectSearchProduct(item)}
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                                flex: 1, minWidth: 0, padding: '4px 0',
                                background: 'transparent', border: 'none', color: C.ink,
                                cursor: 'pointer', textAlign: 'left',
                              }}
                            >
                              <div className="flex flex-col" style={{ minWidth: 0 }}>
                                <span style={{ fontSize: '13px' }}>{item.nome}</span>
                                <span style={{ fontSize: '11px', color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>
                                  {Math.round(item.per_100g?.kcal || 0)} kcal/100g · {item.origine === 'off' ? 'OFF' : 'catalogo'}{item.volte > 0 ? ` · ${item.volte}×` : ''}
                                </span>
                              </div>
                              <ChevronRight size={16} style={{ color: C.inkFaint, flexShrink: 0 }} />
                            </button>
                            {isCatalog && (
                              <button
                                type="button"
                                aria-label="Elimina dal catalogo"
                                disabled={starBusy}
                                onClick={() => deleteCatalogItem(item)}
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  width: '32px', height: '32px', padding: 0, flexShrink: 0,
                                  background: 'transparent', border: 'none',
                                  color: C.inkFaint, cursor: starBusy ? 'default' : 'pointer',
                                  opacity: starBusy ? 0.55 : 1,
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {saveCatalogOpen && (
        <div
          data-no-tab-swipe
          role="dialog"
          aria-modal="true"
          aria-label="Salva in catalogo"
          onClick={(e) => { if (e.target === e.currentTarget) closeSaveCatalog(); }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(18, 22, 19, 0.78)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
            paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
            paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
            boxSizing: 'border-box',
          }}
        >
          <div
            className="flex flex-col gap-3"
            style={{
              width: '100%',
              maxWidth: '420px',
              background: C.surface,
              borderRadius: '16px',
              border: `1px solid ${C.good}`,
              padding: '16px 18px',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span style={{ fontSize: '12px', fontWeight: 600, color: C.good }}>Salva in catalogo (valori /100 g)</span>
              <button
                type="button"
                onClick={closeSaveCatalog}
                style={{ background: 'transparent', border: 'none', color: C.inkMuted, cursor: 'pointer', padding: '4px' }}
                aria-label="Chiudi"
              >
                <X size={16} />
              </button>
            </div>
            <input
              ref={saveCatalogNomeRef}
              value={saveCatalogForm.nome}
              onChange={(e) => setSaveCatalogForm((f) => ({ ...f, nome: e.target.value }))}
              placeholder="Nome"
              style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '8px', padding: '8px 10px', fontSize: '13px' }}
            />
            <div className="flex" style={{ gap: '6px' }}>
              {[
                { k: 'kcal', ph: 'kcal' },
                { k: 'proteine', ph: 'P' },
                { k: 'carboidrati', ph: 'C' },
                { k: 'grassi', ph: 'G' },
              ].map((f) => (
                <input
                  key={f.k}
                  value={saveCatalogForm[f.k]}
                  onChange={(e) => setSaveCatalogForm((prev) => ({ ...prev, [f.k]: e.target.value }))}
                  inputMode="decimal"
                  placeholder={f.ph}
                  style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '8px', padding: '8px 6px', fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace", minWidth: 0 }}
                />
              ))}
            </div>
            <label className="flex items-center gap-2" style={{ fontSize: '12px', color: C.inkMuted, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!saveCatalogForm.preferito}
                onChange={(e) => setSaveCatalogForm((f) => ({ ...f, preferito: e.target.checked }))}
              />
              Preferito
            </label>
            {saveCatalogMsg && (
              <span style={{ fontSize: '12px', color: saveCatalogMsg.includes('Salvato') ? C.good : C.alert }}>{saveCatalogMsg}</span>
            )}
            <button
              type="button"
              onClick={submitSaveCatalogFromMeal}
              disabled={saveCatalogBusy}
              style={{
                alignSelf: 'flex-start',
                background: C.good, color: C.bg, border: 'none', borderRadius: '8px',
                padding: '8px 14px', fontSize: '13px', fontWeight: 600,
                cursor: saveCatalogBusy ? 'default' : 'pointer', opacity: saveCatalogBusy ? 0.6 : 1,
              }}
            >
              {saveCatalogBusy ? 'Salvo…' : 'Salva'}
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 'max(28px, calc(12px + env(safe-area-inset-bottom)))',
            transform: 'translateX(-50%)',
            zIndex: 90,
            maxWidth: 'min(360px, calc(100vw - 32px))',
            background: C.surfaceRaised,
            border: `1px solid ${C.line}`,
            color: C.ink,
            borderRadius: '10px',
            padding: '10px 16px',
            fontSize: '13px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Riga pasto con edit/delete (Deploy 5 §7.2).
// - tap sulla riga con pannello aperto → chiude modifica o conferma eliminazione
// - swipe sx→dx → modifica
// - swipe dx→sx → box di conferma eliminazione
// - pulsante Elimina nel pannello → stesso box di conferma
// MealRow — riga pasto con swipe e pannello modifica inline.
// - tap sulla riga con pannello aperto → chiude modifica o conferma
// - swipe sx→dx → barra conferma modifica (verde) → matita apre pannello
// - swipe dx→sx → barra conferma eliminazione (rossa)
// - pulsante Elimina nel pannello → stesso box di conferma elimina
// Le righe non editabili (demo o storiche "legacy-*") restano di sola lettura.
// ---------------------------------------------------------------------------
function MealRow({
  meal, editable, isEditing, confirming, confirmingEdit, active, swipeX,
  editDraft, setEditDraft, editBusy, editError,
  onOpenEdit, onCloseEdit, onSave, onAskDelete, onCancelDelete, onCancelEditConfirm, onDelete,
  onTouchStart, onTouchMove, onTouchEnd, onCatalogStar, catalogStarFilled, catalogStarBusy,
  suppressClickRef,
}) {
  const fonteLabel = String(meal.fonte || '').includes('barcode')
    ? 'barcode'
    : meal.fonte === 'pwa-catalogo'
      ? 'catalogo'
      : meal.fonte === 'pwa-testo'
        ? 'testo'
        : 'voce';
  const setField = (k, v) => setEditDraft((d) => ({ ...(d || {}), [k]: v }));
  const OVERLAY_MS = 320;
  const [deleteMounted, setDeleteMounted] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editMounted, setEditMounted] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const deleteMountedRef = useRef(false);
  const editMountedRef = useRef(false);
  const deleteExitTimerRef = useRef(null);
  const editExitTimerRef = useRef(null);
  deleteMountedRef.current = deleteMounted;
  editMountedRef.current = editMounted;

  useEffect(() => {
    if (deleteExitTimerRef.current) {
      clearTimeout(deleteExitTimerRef.current);
      deleteExitTimerRef.current = null;
    }
    if (confirming) {
      // Chiudi subito l'overlay opposto se ancora montato, per evitare che
      // le due animazioni (uscita edit + entrata delete) si sovrappongano.
      if (editExitTimerRef.current) {
        clearTimeout(editExitTimerRef.current);
        editExitTimerRef.current = null;
      }
      setEditOpen(false);
      setEditMounted(false);
      setDeleteMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setDeleteOpen(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    if (deleteMountedRef.current) {
      setDeleteOpen(false);
      deleteExitTimerRef.current = setTimeout(() => {
        setDeleteMounted(false);
        deleteExitTimerRef.current = null;
      }, OVERLAY_MS);
    }
    return () => {
      if (deleteExitTimerRef.current) {
        clearTimeout(deleteExitTimerRef.current);
        deleteExitTimerRef.current = null;
      }
    };
  }, [confirming]);

  useEffect(() => {
    if (editExitTimerRef.current) {
      clearTimeout(editExitTimerRef.current);
      editExitTimerRef.current = null;
    }
    if (confirmingEdit) {
      // Chiudi subito l'overlay opposto se ancora montato, per evitare che
      // le due animazioni (uscita delete + entrata edit) si sovrappongano.
      if (deleteExitTimerRef.current) {
        clearTimeout(deleteExitTimerRef.current);
        deleteExitTimerRef.current = null;
      }
      setDeleteOpen(false);
      setDeleteMounted(false);
      setEditMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setEditOpen(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    if (editMountedRef.current) {
      setEditOpen(false);
      editExitTimerRef.current = setTimeout(() => {
        setEditMounted(false);
        editExitTimerRef.current = null;
      }, OVERLAY_MS);
    }
    return () => {
      if (editExitTimerRef.current) {
        clearTimeout(editExitTimerRef.current);
        editExitTimerRef.current = null;
      }
    };
  }, [confirmingEdit]);

  const overlayBusy = deleteMounted || editMounted;
  const handleRowClick = () => {
    if (suppressClickRef?.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!editable || swipeX !== 0) return;
    if (isEditing) {
      onCloseEdit();
      return;
    }
    if (confirming) {
      onCancelDelete();
      return;
    }
    if (confirmingEdit) {
      onCancelEditConfirm();
      return;
    }
    // Tap semplice: non apre il pannello (solo matita / swipe modifica)
  };

  // Pannello edit: montato durante exit così altezza/opacità possono chiudersi.
  const wantPanel = Boolean(isEditing && editDraft && !confirming);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draftSnap, setDraftSnap] = useState(null);
  const closeTimerRef = useRef(null);
  const panelMountedRef = useRef(false);
  panelMountedRef.current = panelMounted;

  useEffect(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (wantPanel) {
      setDraftSnap(editDraft);
      setPanelMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setPanelOpen(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    if (panelMountedRef.current) {
      setPanelOpen(false);
      closeTimerRef.current = setTimeout(() => {
        setPanelMounted(false);
        setDraftSnap(null);
        closeTimerRef.current = null;
      }, 300);
    }
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [wantPanel]); // eslint-disable-line react-hooks/exhaustive-deps -- solo toggle open/close

  // Tenere lo snapshot allineato mentre si digita (solo a pannello aperto).
  useEffect(() => {
    if (wantPanel && editDraft) setDraftSnap(editDraft);
  }, [wantPanel, editDraft]);

  const shownDraft = (wantPanel ? editDraft : draftSnap) || draftSnap;

  const forwardTouch = editable && !(overlayBusy && !confirming && !confirmingEdit);

  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      {/* Riga con swipe */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        {/* Pulsante modifica rivelato sotto durante swipe sx→dx */}
        {editable && !overlayBusy && (
          <button
            onClick={() => onOpenEdit(meal)}
            aria-label="Modifica"
            style={{
              position: 'absolute', top: 0, left: 0, bottom: 0, width: '80px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: C.good, color: C.bg, border: 'none', cursor: 'pointer',
            }}
          >
            <Pencil size={18} />
          </button>
        )}
        {/* Pulsante elimina rivelato sotto durante swipe dx→sx */}
        {editable && !overlayBusy && (
          <button
            onClick={() => onAskDelete(meal.id)}
            aria-label="Elimina"
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: '80px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: C.alert, color: C.bg, border: 'none', cursor: 'pointer',
            }}
          >
            <Trash2 size={18} />
          </button>
        )}
        {/* Contenuto riga (sopra) — in conferma overlay a stessa altezza */}
        <div
          data-no-tab-swipe
          onTouchStart={forwardTouch ? (e) => { e.stopPropagation(); onTouchStart(meal, e); } : undefined}
          onTouchMove={forwardTouch ? (e) => { e.stopPropagation(); onTouchMove(meal, e); } : undefined}
          onTouchEnd={forwardTouch ? (e) => { e.stopPropagation(); onTouchEnd(meal, e); } : undefined}
          onClick={handleRowClick}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            padding: '8px 0',
            background: C.surface,
            position: 'relative',
            paddingRight: editable && !isEditing && !overlayBusy ? (onCatalogStar ? '78px' : '42px') : 0,
            transform: (overlayBusy || confirming || confirmingEdit) ? 'translateX(0)' : `translateX(${swipeX}px)`,
            transition: (active || confirming || confirmingEdit || overlayBusy) ? 'none' : 'transform 0.18s ease',
            cursor: editable ? 'pointer' : 'default',
          }}
        >
          {/* Contenuto pasto sempre montato: preserva l'altezza; il wipe lo copre */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
              pointerEvents: overlayBusy ? 'none' : 'auto',
            }}
            aria-hidden={overlayBusy || undefined}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
              <span style={{ fontSize: '13px', textAlign: 'left' }}>{meal.alimento}</span>
            </div>
            <span style={{ fontSize: '11px', color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>
              {meal.time} · {meal.grammi}g · {fonteLabel}
            </span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: C.inkMuted }}>
              {Math.round(meal.kcal)} kcal ·{' '}
              <span style={{ color: C.protein }}>{Math.round(meal.proteine)}P</span>{' '}
              <span style={{ color: C.carbs }}>{Math.round(meal.carboidrati)}C</span>{' '}
              <span style={{ color: C.fat }}>{Math.round(meal.grassi)}G</span>
            </span>
          </div>
          {editable && !isEditing && !overlayBusy && (
            <div
              style={{
                position: 'absolute',
                right: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {onCatalogStar && (
                <button
                  type="button"
                  aria-label={catalogStarFilled ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                  disabled={catalogStarBusy}
                  onClick={(e) => { e.stopPropagation(); onCatalogStar(meal); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    padding: 0,
                    background: C.surfaceRaised,
                    border: `1px solid ${C.line}`,
                    borderRadius: '8px',
                    color: C.amber,
                    cursor: catalogStarBusy ? 'default' : 'pointer',
                    opacity: catalogStarBusy ? 0.55 : 1,
                    flexShrink: 0,
                  }}
                >
                  <Star size={15} fill={catalogStarFilled ? 'currentColor' : 'none'} />
                </button>
              )}
              <button
                type="button"
                aria-label="Modifica"
                onClick={(e) => { e.stopPropagation(); onOpenEdit(meal); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  padding: 0,
                  background: C.surfaceRaised,
                  border: `1px solid ${C.line}`,
                  borderRadius: '8px',
                  color: C.inkMuted,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Pencil size={15} />
              </button>
            </div>
          )}
          {editMounted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                pointerEvents: editOpen && confirmingEdit ? 'auto' : 'none',
              }}
            >
              <div
                className={`vt-edit-confirm-fill${editOpen ? ' is-open' : ''}`}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: C.good,
                }}
              />
              <div
                className={`vt-edit-confirm-content${editOpen ? ' is-open' : ''}`}
                style={{
                  position: 'relative',
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '0 10px',
                  height: '100%',
                }}
              >
                <span style={{
                  fontSize: '13px', color: C.bg, fontWeight: 500, lineHeight: 1.3,
                  minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {meal.alimento}
                </span>
                <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-label="Modifica"
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onOpenEdit(meal); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      padding: 0,
                      background: C.bg,
                      color: C.good,
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label="Annulla"
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onCancelEditConfirm(); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      padding: 0,
                      background: 'transparent',
                      color: C.bg,
                      border: `1px solid ${C.bg}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      flexShrink: 0,
                      opacity: 0.9,
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            </div>
          )}
          {deleteMounted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                pointerEvents: deleteOpen && confirming ? 'auto' : 'none',
              }}
            >
              <div
                className={`vt-delete-confirm-fill${deleteOpen ? ' is-open' : ''}`}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: C.alert,
                }}
              />
              <div
                className={`vt-delete-confirm-content${deleteOpen ? ' is-open' : ''}`}
                style={{
                  position: 'relative',
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '0 10px',
                  height: '100%',
                }}
              >
                <span style={{
                  fontSize: '13px', color: C.bg, fontWeight: 500, lineHeight: 1.3,
                  minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {meal.alimento}
                </span>
                <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-label="Elimina"
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onDelete(meal); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      padding: 0,
                      background: C.bg,
                      color: C.alert,
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label="Annulla"
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onCancelDelete(); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      padding: 0,
                      background: 'transparent',
                      color: C.bg,
                      border: `1px solid ${C.bg}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      flexShrink: 0,
                      opacity: 0.9,
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pannello di modifica inline — apertura/chiusura animata (grid 0fr→1fr) */}
      {panelMounted && shownDraft && (
        <div
          className={`vt-edit-collapse${panelOpen ? ' is-open' : ''}`}
          onTransitionEnd={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.propertyName !== 'grid-template-rows') return;
            if (!panelOpen) {
              if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
              }
              setPanelMounted(false);
              setDraftSnap(null);
            }
          }}
        >
          <div className="vt-edit-collapse-inner" style={{ pointerEvents: wantPanel && panelOpen ? 'auto' : 'none' }}>
            <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}`, borderRadius: '10px', padding: '12px', margin: '8px 0' }} className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label style={{ fontSize: '11px', color: C.inkMuted, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.06em' }}>ALIMENTO</label>
                <input
                  value={shownDraft.alimento}
                  onChange={(e) => setField('alimento', e.target.value)}
                  style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.ink, borderRadius: '6px', padding: '8px 10px', fontSize: '13px' }}
                />
              </div>
              <TargetInput label="Grammi" unit="g" value={shownDraft.grammi} onChange={(v) => setField('grammi', v)} color={C.ink} />
              <TargetInput label="Calorie" unit="kcal" value={shownDraft.kcal} onChange={(v) => setField('kcal', v)} color={C.ink} />
              <TargetInput label="Proteine" unit="g" value={shownDraft.proteine} onChange={(v) => setField('proteine', v)} color={C.protein} />
              <TargetInput label="Carboidrati" unit="g" value={shownDraft.carboidrati} onChange={(v) => setField('carboidrati', v)} color={C.carbs} />
              <TargetInput label="Grassi" unit="g" value={shownDraft.grassi} onChange={(v) => setField('grassi', v)} color={C.fat} />
              {editError && wantPanel && (
                <div className="flex items-start gap-2" style={{ color: C.alert, fontSize: '12px' }}>
                  <AlertCircle size={13} style={{ marginTop: '2px', flexShrink: 0 }} /><span>{editError}</span>
                </div>
              )}
              <div className="flex items-center gap-2 mt-1">
                <button onClick={() => onSave(meal)} disabled={editBusy} style={{ background: C.good, color: C.bg, border: 'none', borderRadius: '6px', padding: '7px 12px', fontSize: '13px', fontWeight: 600, cursor: editBusy ? 'default' : 'pointer', opacity: editBusy ? 0.6 : 1 }} className="flex items-center gap-1">
                  {editBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {editBusy ? 'Salvo…' : 'Salva'}
                </button>
                <button onClick={() => onAskDelete(meal.id)} disabled={editBusy} style={{ background: 'transparent', color: C.alert, border: `1px solid ${C.alert}`, borderRadius: '6px', padding: '7px 12px', fontSize: '13px', cursor: editBusy ? 'default' : 'pointer' }} className="flex items-center gap-1">
                  <Trash2 size={14} /> Elimina
                </button>
                <button onClick={onCloseEdit} disabled={editBusy} style={{ background: 'transparent', color: C.inkMuted, border: `1px solid ${C.line}`, borderRadius: '6px', padding: '7px 12px', fontSize: '13px', cursor: 'pointer', marginLeft: 'auto' }}>
                  Annulla
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TargetInput({ label, unit, value, onChange, color }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <div style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
        <span style={{ fontSize: '13px' }}>{label}</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: '72px', textAlign: 'right', background: '#121613', border: '1px solid #2B352F', color: '#EFEDE4', borderRadius: '6px', padding: '6px 8px', fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}
        />
        <span style={{ fontSize: '11px', color: '#5B655E', width: '28px' }}>{unit}</span>
      </div>
    </div>
  );
}

const KCAL_MIN = 1000;
const KCAL_MAX = 4000;
const KCAL_STEP = 10;

// ---------------------------------------------------------------------------
// Slider calorie Obiettivi: stesso layout dei macro (− | range | +),
// input digitabile in alto. Valori fuori 1000–4000 restano digitabili;
// slider e ± restano clampati al range.
// ---------------------------------------------------------------------------
function KcalSlider({ value, onChange, color }) {
  const n = Math.round(toNum(value));
  const clamped = Math.max(KCAL_MIN, Math.min(KCAL_MAX, n));
  const inputStyle = {
    textAlign: 'right',
    background: '#121613',
    border: '1px solid #2B352F',
    color: '#EFEDE4',
    borderRadius: '6px',
    padding: '6px 8px',
    fontSize: '13px',
    fontFamily: "'IBM Plex Mono', monospace",
  };
  const stepBtn = {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: C.surfaceRaised,
    border: `1px solid ${C.line}`,
    borderRadius: '6px',
    color: C.inkMuted,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  };
  const bump = (delta) => {
    const base = Number.isFinite(n) ? n : KCAL_MIN;
    onChange(Math.max(KCAL_MIN, Math.min(KCAL_MAX, base + delta)));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div style={{ width: 6, height: 6, borderRadius: 999, background: color, flexShrink: 0 }} />
          <span style={{ fontSize: '13px' }}>Calorie</span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Calorie giornaliere"
            style={{ ...inputStyle, width: '72px', color }}
          />
          <span style={{ fontSize: '11px', color: '#5B655E', width: '28px' }}>kcal</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => bump(-KCAL_STEP)} aria-label="Calorie meno dieci" style={stepBtn}>
          <Minus size={14} />
        </button>
        <input
          type="range"
          min={KCAL_MIN}
          max={KCAL_MAX}
          step={KCAL_STEP}
          value={clamped}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Slider calorie"
          style={{ flex: 1, minWidth: 0, accentColor: color, cursor: 'pointer' }}
        />
        <button type="button" onClick={() => bump(KCAL_STEP)} aria-label="Calorie più dieci" style={stepBtn}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slider di ripartizione per un macro (Deploy 5 §7.2): etichetta, % e grammi
// digitabili, ±1 g, poi la barra. `accentColor` colora traccia e pallino
// (touch su Chrome/Android, target di test del progetto).
// ---------------------------------------------------------------------------
function MacroSlider({ label, pct, grams, onPctChange, onGramsChange, color }) {
  const inputStyle = {
    textAlign: 'right',
    background: '#121613',
    border: '1px solid #2B352F',
    color: '#EFEDE4',
    borderRadius: '6px',
    padding: '6px 8px',
    fontSize: '13px',
    fontFamily: "'IBM Plex Mono', monospace",
  };
  const stepBtn = {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: C.surfaceRaised,
    border: `1px solid ${C.line}`,
    borderRadius: '6px',
    color: C.inkMuted,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div style={{ width: 6, height: 6, borderRadius: 999, background: color, flexShrink: 0 }} />
          <span style={{ fontSize: '13px' }}>{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="100"
            value={pct}
            onChange={(e) => onPctChange(e.target.value)}
            aria-label={`Percentuale ${label}`}
            style={{ ...inputStyle, width: '48px', color }}
          />
          <span style={{ fontSize: '11px', color: '#5B655E', width: '14px' }}>%</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={grams}
            onChange={(e) => onGramsChange(e.target.value)}
            aria-label={`Grammi ${label}`}
            style={{ ...inputStyle, width: '56px' }}
          />
          <span style={{ fontSize: '11px', color: '#5B655E', width: '14px' }}>g</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onGramsChange(Math.max(0, Math.round(toNum(grams)) - 1))} aria-label={`${label} meno un grammo`} style={stepBtn}>
          <Minus size={14} />
        </button>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={pct}
          onChange={(e) => onPctChange(Number(e.target.value))}
          aria-label={`Slider ${label}`}
          style={{ flex: 1, minWidth: 0, accentColor: color, cursor: 'pointer' }}
        />
        <button type="button" onClick={() => onGramsChange(Math.round(toNum(grams)) + 1)} aria-label={`${label} più un grammo`} style={stepBtn}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etichetta cliccabile sull'asse X del grafico trend: tocca il nome
// (giorno / settimana / mese) o la colonna e ti porta nel Diario su quella
// data. Recharts clona questo elemento passandogli x/y/payload/index;
// `week`/`selectedDate`/`onSelect` arrivano dalle prop passate a mano
// (`week` = serie attiva del trend, non solo la vista settimanale).
// ---------------------------------------------------------------------------
function WeekAxisTick({ x, y, payload, index, week, selectedDate, onSelect }) {
  const item = (typeof index === 'number' && week[index]) || week.find((w) => w.label === payload.value);
  const clickable = !!item?.date;
  const isSelected = clickable && item.date === selectedDate;
  return (
    <g
      transform={`translate(${x},${y})`}
      onClick={clickable ? () => onSelect(item.date) : undefined}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
    >
      {/* Area di tap allargata (invisibile), il testo da solo e' troppo piccolo su mobile */}
      <rect x={-16} y={-2} width={32} height={22} fill="transparent" />
      <text x={0} y={0} dy={13} textAnchor="middle" fontSize={11} fontWeight={isSelected ? 600 : 400} fill={isSelected ? C.ink : C.inkFaint}>
        {payload.value}
      </text>
    </g>
  );
}

function MacroRow({ icon, label, grams, target, color }) {
  const barPct = Math.min((grams / Math.max(target, 1)) * 100, 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {icon}
          <span style={{ fontSize: '12px', color: '#EFEDE4' }}>{label}</span>
        </div>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: '#8C978F' }}>
          {Math.round(grams)}g / {target}g
        </span>
      </div>
      <div style={{ height: '4px', borderRadius: '999px', background: '#2B352F' }}>
        <div style={{ width: `${barPct}%`, height: '100%', borderRadius: '999px', background: color }} />
      </div>
    </div>
  );
}
