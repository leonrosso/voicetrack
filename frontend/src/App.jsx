import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Settings, X, RefreshCw, SlidersHorizontal,
  Beef, Wheat, Droplet, Mic, AlertCircle, Check, UtensilsCrossed,
  LayoutGrid, Volume2, Loader2, MessageCircleQuestion,
  ChevronLeft, ChevronRight, Send, ScanLine, Camera,
  Pencil, Trash2, Keyboard
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
  line: '#2B352F',
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

// Grammi derivati da split % + kcal target: i grammi riempiono esattamente le
// calorie (perché le % sommano a 100).
function gramsFromPct(kcal, pct) {
  const k = toNum(kcal);
  return {
    proteine: Math.round(((pct.p / 100) * k) / 4),
    carboidrati: Math.round(((pct.c / 100) * k) / 4),
    grassi: Math.round(((pct.g / 100) * k) / 9),
  };
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
  // Ripartizione macro (%) mentre l'editor Obiettivi è aperto: somma sempre 100.
  // Inizializzata dai grammi salvati all'apertura del pannello; i grammi da
  // salvare sono derivati da questo split + kcal (§7.2).
  const [macroPct, setMacroPct] = useState(() => pctFromGrams(DEMO_TARGET));

  // --- Tab attivo: 'diario' (dashboard) | 'traccia' (voce) ---
  const [view, setView] = useState('diario');

  // --- Sfoglia diario: 0 = oggi, -1 = ieri, ecc. ---
  const [dayOffset, setDayOffset] = useState(0);
  const [historyMeals, setHistoryMeals] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  // Bump per rieseguire il loader dei giorni passati dopo edit/delete (§5.2 del piano).
  const [historyTick, setHistoryTick] = useState(0);

  // --- Edit / delete pasti (Deploy 5 §7.2) ---
  const [editingId, setEditingId] = useState(null);        // id del pasto col pannello aperto
  const [editDraft, setEditDraft] = useState(null);        // { alimento, grammi, kcal, proteine, carboidrati, grassi }
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null); // id in attesa di conferma
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [swipeId, setSwipeId] = useState(null);            // riga trascinata
  const [swipeX, setSwipeX] = useState(0);                 // offset corrente (px, ±SWIPE_MAX)

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
    // Gli slider sono indipendenti: si salva solo con una ripartizione al 100%,
    // così i grammi derivati da split % + kcal riempiono esattamente le calorie.
    if (macroPct.p + macroPct.c + macroPct.g !== 100) {
      setTargetMsg('Serve una ripartizione al 100% per salvare');
      return;
    }
    const kcal = Number(targetDraft.kcal) || DEMO_TARGET.kcal;
    const clean = { kcal, ...gramsFromPct(kcal, macroPct) };
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
  const voiceRef = useRef(null);       // voce italiana per SpeechSynthesis
  const pendingActionRef = useRef(null); // 'text' | 'voice' | 'scan' | null — azioni dalla card Diario
  const typedInputRef = useRef(null);

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

  // Warm-up anti cold start (§3.2 del Piano): all'apertura del tab Traccia
  // pinga /health cosi' l'istanza e' gia' calda quando inizi a parlare.
  useEffect(() => {
    if ((view !== 'traccia' && view !== 'scan') || !config.apiUrl) return;
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

  const submitMeal = useCallback(async (spokenText, isClarification, viaVoice = true) => {
    setMicState('processing');
    setTrackError('');

    // Convenzione §3.4: backend stateless → al chiarimento rimandiamo
    // testo originale + risposta concatenati ("un piatto di pasta, 300 grammi").
    const fullText = isClarification && pendingTextRef.current
      ? `${pendingTextRef.current}${CLARIFY_JOIN}${spokenText}`
      : spokenText;

    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/log_meal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
        },
        body: JSON.stringify({ text: fullText, fonte: viaVoice ? 'pwa-voce' : 'pwa-testo' }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error(`Risposta ${res.status} dal server`);

      if (json.status === 'needs_clarification') {
        clarifyRoundsRef.current += 1;
        if (clarifyRoundsRef.current > MAX_CLARIFY_ROUNDS) {
          pendingTextRef.current = '';
          clarifyRoundsRef.current = 0;
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
        setClarifyQuestion('');
        setTrackResult(json);
        if (viaVoice) {
          const summary = json.riepilogo_vocale || 'Pasto registrato.';
          setMicState('speaking');
          speak(summary, () => setMicState('idle'));
        } else {
          setMicState('idle');
        }
        // Aggiorna la dashboard in silenzio: al passaggio sul Diario e' gia' fresca.
        fetchLive(config, true);
        return;
      }

      // status === 'error' (o inatteso) dal backend
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
      setClarifyQuestion('');
      setTrackError(e.message || 'Impossibile raggiungere il backend');
      setMicState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, speak, fetchLive]);

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
  }, [submitMeal]);

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

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectTimerRef = useRef(null);
  const qtyRecRef = useRef(null);

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
    stopCamera();
    try { qtyRecRef.current?.abort?.(); } catch (e) {}
    setScanState('idle');
    setScanProduct(null);
    setScanQty('');
    setScanResult(null);
    setScanError('');
    setScanNotFound('');
    setQtyListening(false);
  }, [stopCamera]);

  // Uscendo dal tab Scan (o smontando): camera spenta, stato pulito.
  useEffect(() => {
    if (view === 'scan') return;
    resetScan();
  }, [view, resetScan]);

  const sendBarcode = useCallback(async (barcode, grammi) => {
    setScanState('processing');
    setScanError('');
    setScanNotFound('');
    try {
      const base = config.apiUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/scan_barcode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
        },
        body: JSON.stringify({ barcode, ...(grammi != null ? { grammi } : {}), fonte: 'pwa-barcode' }),
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
        setScanState('speaking');
        speak(json.riepilogo_vocale || 'Prodotto non trovato.', () => setScanState('idle'));
        return;
      }

      if (json.status === 'ok') {
        setScanProduct(null);
        setScanQty('');
        setScanResult(json);
        setScanState('speaking');
        speak(json.riepilogo_vocale || 'Prodotto registrato.', () => setScanState('idle'));
        fetchLive(config, true); // Diario gia' fresco al prossimo passaggio
        return;
      }

      const msg = json.message || json.riepilogo_vocale || 'Errore dal server.';
      setScanError(msg);
      setScanState('speaking');
      speak(json.riepilogo_vocale || msg, () => setScanState('idle'));
    } catch (e) {
      setScanError(e.message || 'Impossibile raggiungere il backend');
      setScanState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, speak, fetchLive]);

  const startScan = useCallback(async () => {
    if (!barcodeSupported || scanState !== 'idle') return;
    setScanResult(null);
    setScanError('');
    setScanNotFound('');
    setScanProduct(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setScanState('scanning');
      // Il <video> viene montato dal render di 'scanning': aggancio al frame dopo.
      requestAnimationFrame(async () => {
        if (!videoRef.current || !streamRef.current) return;
        videoRef.current.srcObject = streamRef.current;
        try { await videoRef.current.play(); } catch (e) {}

        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8'] });
        detectTimerRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
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
  const launchQuickAction = useCallback((action) => {
    pendingActionRef.current = action;
    setView(action === 'scan' ? 'scan' : 'traccia');
  }, []);

  useEffect(() => {
    const action = pendingActionRef.current;
    if (!action) return;
    if (action === 'text' && view === 'traccia') {
      pendingActionRef.current = null;
      requestAnimationFrame(() => typedInputRef.current?.focus());
    } else if (action === 'voice' && view === 'traccia') {
      pendingActionRef.current = null;
      if (micState === 'idle') startListening(false);
    } else if (action === 'scan' && view === 'scan') {
      pendingActionRef.current = null;
      startScan();
    }
  }, [view, micState, startListening, startScan]);

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

  const selectedDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [dayOffset]);
  const selectedDateStr = fmtYMD(selectedDate);

  const trendData = trendRange === 'year' ? year : trendRange === 'month' ? month : week;

  // Tap su un bucket del grafico trend → ci si sposta nel Diario a quella data
  // (giorno / inizio settimana / primo del mese). dayOffset e' sempre <= 0.
  const goToDate = useCallback((dateStr) => {
    if (!dateStr) return;
    const [y, m, d] = dateStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    targetDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((targetDate - today) / 86400000);
    setDayOffset(Math.min(diffDays, 0));
  }, []);

  // Giorni passati: /daily_summary?date=... ritorna gia' il dettaglio righe.
  // Il flusso live di oggi (fetchLive + polling) resta intoccato.
  useEffect(() => {
    if (dayOffset === 0 || !config.apiUrl) return;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      setHistoryError('');
      try {
        const base = config.apiUrl.replace(/\/$/, '');
        const res = await fetch(`${base}/daily_summary?date=${selectedDateStr}`, {
          headers: config.apiKey ? { 'X-API-Key': config.apiKey } : {},
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) throw new Error(`Risposta ${res.status} dal server`);
        if (!cancelled) {
          // Preserva l'id reale (UUID) della riga per edit/delete; le righe
          // storiche senza id ricevono un fallback "legacy-N" (non editabile,
          // ma key React univoca). §5.4 del piano.
          setHistoryMeals((json.dettaglio || []).map((m, i) => ({ ...m, id: m.id || `legacy-${i}` })));
        }
      } catch (e) {
        if (!cancelled) {
          setHistoryMeals([]);
          setHistoryError(e.message || 'Impossibile caricare questo giorno');
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dayOffset, selectedDateStr, config.apiUrl, config.apiKey, historyTick]);

  const displayedMeals = dayOffset === 0 ? meals : historyMeals;

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
  // Le percentuali (macroPct) sono la fonte di verità mentre l'editor è aperto.
  // Gli slider sono indipendenti: muoverne uno non tocca gli altri due; il
  // totale può quindi differire da 100 e va portato a 100 per salvare.
  const onTargetKcalChange = (v) => setTargetDraft((d) => ({ ...d, kcal: v }));
  const setMacroSlider = (which, v) =>
    setMacroPct((prev) => ({ ...prev, [which]: Math.max(0, Math.min(100, Math.round(v))) }));

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
    if (deleteBusy) return;
    setDeleteBusy(true);
    setEditError('');
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
      setConfirmDeleteId(null);
      setSwipeId(null);
      setSwipeX(0);
      if (editingId === meal.id) closeEdit();
      refreshDay();
    } catch (e) {
      setEditError(e.message || 'Impossibile eliminare il pasto');
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, config, editingId, closeEdit, refreshDay]);

  // --- Swipe sulla riga: dx→sx elimina, sx→dx modifica (§5.5 del piano) ---
  const SWIPE_MAX = 80;      // apertura massima (px)
  const SWIPE_TRIGGER = 48;  // soglia oltre cui scatta l'azione
  const swipeStartXRef = useRef(0);

  const onRowTouchStart = useCallback((m, e) => {
    if (!isEditable(m) || confirmDeleteId || editingId) return;
    swipeStartXRef.current = e.touches[0].clientX;
    setSwipeId(m.id);
  }, [isEditable, confirmDeleteId, editingId]);

  const onRowTouchMove = useCallback((m, e) => {
    if (swipeId !== m.id) return;
    const dx = e.touches[0].clientX - swipeStartXRef.current;
    setSwipeX(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx)));
  }, [swipeId]);

  const onRowTouchEnd = useCallback((m) => {
    if (swipeId !== m.id) return;
    if (swipeX >= SWIPE_TRIGGER) {
      openEdit(m);
    } else if (swipeX <= -SWIPE_TRIGGER) {
      setConfirmDeleteId(m.id);
    }
    setSwipeX(0);
    setSwipeId(null);
  }, [swipeId, swipeX, openEdit]);

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
    () => configOpen || targetsOpen || !!editingId || !!confirmDeleteId || scanState === 'scanning',
    [configOpen, targetsOpen, editingId, confirmDeleteId, scanState]
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

  // Grammi dell'obiettivo derivati dallo split % + kcal (per l'anteprima
  // accanto a ogni slider). Le % sommano sempre a 100 → i grammi riempiono
  // esattamente le calorie target.
  const draftGrams = gramsFromPct(targetDraft.kcal, macroPct);
  // Somma delle % degli slider (indipendenti): deve essere 100 per salvare.
  const macroSum = macroPct.p + macroPct.c + macroPct.g;

  const statusDot = status === 'live' ? C.good : status === 'error' ? C.alert : C.amber;
  const statusText = status === 'live' ? 'Connesso' : status === 'error' ? 'Dati demo · errore connessione' : status === 'loading' ? 'Caricamento…' : 'Dati demo';

  return (
    <div style={{ background: C.bg, color: C.ink, fontFamily: "'IBM Plex Sans', sans-serif", minHeight: '600px' }} className="w-full flex justify-center p-4">
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
            minHeight: 'calc(100dvh - 150px)',
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
                minHeight: 'calc(100dvh - 150px)',
                padding: '0 16px',
                boxSizing: 'border-box',
                pointerEvents: view === 'diario' || tabDragging ? 'auto' : 'none',
              }}
              aria-hidden={view !== 'diario'}
            >
        {/* Hero readout */}
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 28px', alignItems: 'center' }}>
            <button
              onClick={() => setDayOffset((o) => o - 1)}
              disabled={!config.apiUrl}
              aria-label="Giorno precedente"
              style={{ background: 'transparent', border: 'none', color: config.apiUrl ? C.inkMuted : C.inkFaint, cursor: config.apiUrl ? 'pointer' : 'default', padding: '4px', display: 'flex', justifyContent: 'center', width: '28px', flexShrink: 0, opacity: config.apiUrl ? 1 : 0.4 }}
            >
              <ChevronLeft size={18} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: dayOffset === 0 ? C.inkMuted : C.ink }}>
                {dayOffset === 0 ? dayLabel() : dayLabel(selectedDate)}
              </span>
              {dayOffset === 0 ? (
                <button onClick={() => fetchLive(config)} style={{ color: C.inkMuted, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }} aria-label="Aggiorna">
                  <RefreshCw size={13} className={status === 'loading' ? 'animate-spin' : ''} />
                </button>
              ) : (
                <button onClick={() => setDayOffset(0)} style={{ color: C.good, background: 'transparent', border: `1px solid ${C.line}`, borderRadius: '6px', padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}>
                  {historyLoading ? <Loader2 size={12} className="animate-spin" /> : 'Oggi'}
                </button>
              )}
            </div>
            <button
              onClick={() => setDayOffset((o) => Math.min(o + 1, 0))}
              disabled={dayOffset === 0}
              aria-label="Giorno successivo"
              style={{ background: 'transparent', border: 'none', color: C.inkMuted, cursor: dayOffset === 0 ? 'default' : 'pointer', padding: '4px', display: 'flex', justifyContent: 'center', width: '28px', flexShrink: 0, opacity: dayOffset === 0 ? 0.3 : 1 }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="flex items-end justify-between gap-2 mt-2">
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
          <div style={{ marginTop: '2px' }}>
            <span style={{ fontSize: '13px', color: overTarget ? C.alert : C.good }}>
              {overTarget ? `Superato di ${Math.round(-remaining)} kcal` : `Restano ${Math.round(remaining)} kcal`}
            </span>
          </div>

          {/* Targets editor — apertura/chiusura animata (grid 0fr→1fr) */}
          {targetsMounted && (
            <div
              className={`vt-edit-collapse${targetsAnimOpen ? ' is-open' : ''}`}
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
              <div className="vt-edit-collapse-inner" style={{ pointerEvents: targetsOpen && targetsAnimOpen ? 'auto' : 'none' }}>
                <div style={{ background: C.surfaceRaised, border: `1px solid ${C.line}`, borderRadius: '10px', padding: '12px', marginTop: '12px' }} className="flex flex-col gap-2">
                  <span style={{ fontSize: '11px', color: C.inkMuted, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.06em' }}>
                    OBIETTIVI GIORNALIERI
                  </span>
                  <span style={{ fontSize: '10px', color: C.inkFaint }}>
                    Trascina gli slider in modo indipendente: per salvare la ripartizione deve totalizzare 100%. I grammi si ricavano dalle calorie.
                  </span>
                  <TargetInput label="Calorie" unit="kcal" value={targetDraft.kcal} onChange={onTargetKcalChange} color={C.ink} />
                  <MacroSlider label="Proteine" pct={macroPct.p} grams={draftGrams.proteine} onChange={(v) => setMacroSlider('p', v)} color={C.protein} />
                  <MacroSlider label="Carboidrati" pct={macroPct.c} grams={draftGrams.carboidrati} onChange={(v) => setMacroSlider('c', v)} color={C.carbs} />
                  <MacroSlider label="Grassi" pct={macroPct.g} grams={draftGrams.grassi} onChange={(v) => setMacroSlider('g', v)} color={C.fat} />
                  <div style={{ fontSize: '11px', color: macroSum === 100 ? C.inkFaint : C.alert, fontFamily: "'IBM Plex Mono', monospace", marginTop: '2px' }}>
                    Ripartizione: {macroPct.p}% P · {macroPct.c}% C · {macroPct.g}% G = {macroSum}%
                  </div>
                  {targetMsg && (
                    <div style={{ fontSize: '11px', color: /^(Serve|Errore)/.test(targetMsg) ? C.alert : C.good }}>
                      {targetMsg}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <button onClick={saveTargets} disabled={savingTargets} style={{ background: C.good, color: C.bg, border: 'none', borderRadius: '6px', padding: '7px 12px', fontSize: '13px', fontWeight: 600, cursor: savingTargets ? 'default' : 'pointer', opacity: savingTargets ? 0.6 : 1 }} className="flex items-center gap-1">
                      <Check size={14} /> {savingTargets ? 'Salvo…' : (config.apiUrl ? 'Salva sul foglio' : 'Salva')}
                    </button>
                    <button onClick={() => setTargetsOpen(false)} style={{ background: 'transparent', color: C.inkMuted, border: `1px solid ${C.line}`, borderRadius: '6px', padding: '7px 12px', fontSize: '13px', cursor: 'pointer' }}>
                      Annulla
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {targetMsg && !targetsOpen && (
            <div style={{ fontSize: '11px', color: targetMsg.startsWith('Errore') ? C.alert : C.good, marginTop: '8px' }}>
              {targetMsg}
            </div>
          )}

          {/* Gauge */}
          <div style={{ marginTop: '14px', height: '8px', borderRadius: '999px', background: C.line, position: 'relative', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(pct, 1) * 100}%`, height: '100%',
              background: overTarget ? C.alert : C.good, borderRadius: '999px',
            }} />
            {overTarget && (
              <div style={{ position: 'absolute', left: '100%', top: 0, height: '100%', width: `${Math.min(pct - 1, 0.25) * 100}%`, background: C.alert, opacity: 0.5 }} />
            )}
          </div>
        </div>

        {/* Plate / macro breakdown */}
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '20px' }}>
          <span style={{ fontSize: '12px', color: C.inkMuted }}>Macronutrienti</span>
          <div className="flex items-center gap-4 mt-2">
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
              <MacroRow icon={<Beef size={14} color={C.protein} />} label="Proteine" grams={totals.proteine} target={target.proteine} color={C.protein} />
              <MacroRow icon={<Wheat size={14} color={C.carbs} />} label="Carboidrati" grams={totals.carboidrati} target={target.carboidrati} color={C.carbs} />
              <MacroRow icon={<Droplet size={14} color={C.fat} />} label="Grassi" grams={totals.grassi} target={target.grassi} color={C.fat} />
            </div>
          </div>
        </div>

        {/* Azioni rapide: testo / barcode / voce → tab Traccia o Scan */}
        {dayOffset === 0 && (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '16px 20px' }}>
            <div className="flex items-center" style={{ justifyContent: 'space-around' }}>
              {[
                { id: 'text', label: 'TESTO', aria: 'Scrivi un pasto', icon: <Keyboard size={22} />, action: 'text' },
                { id: 'scan', label: 'SCAN', aria: 'Scansiona un barcode', icon: <ScanLine size={22} />, action: 'scan' },
                { id: 'voice', label: 'VOCE', aria: 'Registra a voce', icon: <Mic size={22} />, action: 'voice' },
              ].map((btn) => (
                <div key={btn.id} className="flex flex-col items-center" style={{ gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => launchQuickAction(btn.action)}
                    aria-label={btn.aria}
                    style={{
                      width: '60px', height: '60px', borderRadius: '999px',
                      border: `1px solid ${C.line}`,
                      background: C.surfaceRaised,
                      color: C.ink,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {btn.icon}
                  </button>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: C.inkMuted, letterSpacing: '0.06em' }}>
                    {btn.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Meal log */}
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: '14px', padding: '20px' }}>
          <span style={{ fontSize: '12px', color: C.inkMuted }}>
            {dayOffset === 0 ? 'Pasti di oggi' : `Pasti del ${selectedDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}`} · {displayedMeals.length}
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
                  {g.items.map((m) => (
                    <MealRow
                      key={m.id}
                      meal={m}
                      editable={isEditable(m)}
                      isEditing={editingId === m.id}
                      confirming={confirmDeleteId === m.id}
                      active={swipeId === m.id}
                      swipeX={swipeId === m.id ? swipeX : 0}
                      editDraft={editDraft}
                      setEditDraft={setEditDraft}
                      editBusy={editBusy}
                      editError={editError}
                      deleteBusy={deleteBusy}
                      onOpenEdit={openEdit}
                      onCloseEdit={closeEdit}
                      onSave={saveEdit}
                      onAskDelete={setConfirmDeleteId}
                      onCancelDelete={() => { setConfirmDeleteId(null); setSwipeId(null); setSwipeX(0); }}
                      onDelete={deleteMeal}
                      onTouchStart={onRowTouchStart}
                      onTouchMove={onRowTouchMove}
                      onTouchEnd={onRowTouchEnd}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
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
                minHeight: 'calc(100dvh - 150px)',
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
                minHeight: 'calc(100dvh - 150px)',
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
                      style={{ width: '100%', display: 'block', maxHeight: '260px', objectFit: 'cover', background: C.bg }}
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
                <button
                  onClick={() => goToTab('traccia')}
                  style={{ alignSelf: 'flex-start', background: 'transparent', color: C.good, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                >
                  Registralo a voce →
                </button>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Riga pasto con edit/delete (Deploy 5 §7.2).
// - tap sulla riga con pannello aperto → chiude modifica o conferma eliminazione
// - swipe sx→dx → modifica
// - swipe dx→sx → box di conferma eliminazione
// - pulsante Elimina nel pannello → stesso box di conferma
// Le righe non editabili (demo o storiche "legacy-*") restano di sola lettura.
// ---------------------------------------------------------------------------
function MealRow({
  meal, editable, isEditing, confirming, active, swipeX,
  editDraft, setEditDraft, editBusy, editError, deleteBusy,
  onOpenEdit, onCloseEdit, onSave, onAskDelete, onCancelDelete, onDelete,
  onTouchStart, onTouchMove, onTouchEnd,
}) {
  const fonteLabel = String(meal.fonte || '').includes('barcode')
    ? 'barcode' : meal.fonte === 'pwa-testo' ? 'testo' : 'voce';
  const setField = (k, v) => setEditDraft((d) => ({ ...(d || {}), [k]: v }));
  const handleRowClick = () => {
    if (!editable || swipeX !== 0) return;
    if (isEditing) {
      onCloseEdit();
      return;
    }
    if (confirming) {
      onCancelDelete();
      return;
    }
    onOpenEdit(meal);
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

  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      {/* Riga con swipe */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        {/* Pulsante modifica rivelato sotto durante swipe sx→dx */}
        {editable && (
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
        {editable && (
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
        {/* Contenuto riga (sopra) */}
        <div
          data-no-tab-swipe
          onTouchStart={editable ? (e) => { e.stopPropagation(); onTouchStart(meal, e); } : undefined}
          onTouchMove={editable ? (e) => { e.stopPropagation(); onTouchMove(meal, e); } : undefined}
          onTouchEnd={editable ? (e) => { e.stopPropagation(); onTouchEnd(meal); } : undefined}
          onClick={handleRowClick}
          style={{
            display: 'flex', flexDirection: 'column', gap: '3px',
            padding: '8px 0', background: C.surface,
            position: 'relative',
            paddingRight: editable && !isEditing && !confirming ? '42px' : 0,
            transform: `translateX(${swipeX}px)`,
            transition: active ? 'none' : 'transform 0.18s ease',
            cursor: editable ? 'pointer' : 'default',
          }}
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
          {editable && !isEditing && !confirming && (
            <button
              type="button"
              aria-label="Modifica"
              onClick={(e) => { e.stopPropagation(); onOpenEdit(meal); }}
              style={{
                position: 'absolute',
                right: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
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
          )}
        </div>
      </div>

      {/* Conferma eliminazione inline (da swipe o da pulsante nel pannello) */}
      {confirming && (
        <div style={{ background: C.surfaceRaised, border: `1px solid ${C.alert}`, borderRadius: '10px', padding: '10px 12px', margin: '8px 0' }} className="flex items-center justify-between gap-2">
          <span style={{ fontSize: '13px' }}>Eliminare «{meal.alimento}»?</span>
          <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
            <button onClick={() => onDelete(meal)} disabled={deleteBusy} style={{ background: C.alert, color: C.bg, border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', fontWeight: 600, cursor: deleteBusy ? 'default' : 'pointer', opacity: deleteBusy ? 0.6 : 1 }} className="flex items-center gap-1">
              {deleteBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Elimina
            </button>
            <button onClick={onCancelDelete} disabled={deleteBusy} style={{ background: 'transparent', color: C.inkMuted, border: `1px solid ${C.line}`, borderRadius: '6px', padding: '6px 12px', fontSize: '13px', cursor: deleteBusy ? 'default' : 'pointer' }}>
              Annulla
            </button>
          </div>
        </div>
      )}

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

// ---------------------------------------------------------------------------
// Slider di ripartizione per un macro (Deploy 5 §7.2): riga con etichetta,
// % corrente e grammi derivati (da split + kcal), poi la barra regolabile.
// `accentColor` colora traccia e pallino nel colore del macro (funziona con il
// touch su Chrome/Android, il target di test del progetto).
// ---------------------------------------------------------------------------
function MacroSlider({ label, pct, grams, onChange, color }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
          <span style={{ fontSize: '13px' }}>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color, minWidth: '38px', textAlign: 'right' }}>{pct}%</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: C.inkFaint, width: '52px', textAlign: 'right' }}>{Math.round(grams)} g</span>
        </div>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={pct}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`Percentuale ${label}`}
        style={{ width: '100%', accentColor: color, cursor: 'pointer' }}
      />
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
