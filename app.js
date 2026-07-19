import {
  VERSION,
  DEFAULT_SERIES,
  DEFAULT_MUSIC,
  DEFAULT_TASKS,
  DEFAULT_REWARDS,
  STICKERS
} from "./data.js";
import { listMedia, putMedia, deleteMedia, clearMedia } from "./media-store.js";

const KEY = "baerenhaus.v1";
const LEGACY_KEYS = [
  "baerflix.v91",
  "baerflix.v9",
  "baerflix.complete.v8",
  "baerflix.complete.v7",
  "baerflix.complete.v6"
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const deepCopy = (value) => structuredClone(value);
const todayKey = () => new Date().toLocaleDateString("sv-SE");
const uid = (prefix = "id") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const array = (value) => Array.isArray(value) ? value : [];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const slug = (value) => String(value || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
const extractYouTubeId = (value) => {
  const raw = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const match = raw.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
  return match?.[1] || "";
};
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function defaults() {
  return {
    version: VERSION,
    pin: "1234",
    kids: [
      { id: "ludwig", name: "Ludwig", avatar: "🧒", accent: "blue" },
      { id: "fabian", name: "Fabian", avatar: "👦", accent: "pink" }
    ],
    series: deepCopy(DEFAULT_SERIES),
    music: deepCopy(DEFAULT_MUSIC),
    tasks: {
      ludwig: deepCopy(DEFAULT_TASKS),
      fabian: deepCopy(DEFAULT_TASKS)
    },
    rewards: deepCopy(DEFAULT_REWARDS),
    stars: { ludwig: 0, fabian: 0 },
    favorites: { ludwig: [], fabian: [] },
    history: [],
    requests: [],
    daily: { date: todayKey(), kids: {} },
    settings: {
      sounds: true,
      volume: 0.65,
      smartSort: true,
      childLabels: true,
      voiceLabels: false
    }
  };
}

function cleanEpisodeList(items, globallyUsed) {
  const result = [];
  for (const item of array(items)) {
    const youtubeId = extractYouTubeId(item?.youtubeId || item?.url || item?.link);
    if (!youtubeId || globallyUsed.has(youtubeId)) continue;
    globallyUsed.add(youtubeId);
    result.push({
      id: String(item?.id || uid("episode")),
      title: String(item?.title || "Folge"),
      youtubeId
    });
  }
  return result;
}

function mergeSeries(customSeries, seedDefaults = false) {
  const used = new Set();
  const merged = [];
  const byTitle = new Map();

  const startingSeries = seedDefaults ? deepCopy(DEFAULT_SERIES) : [];
  for (const base of startingSeries) {
    const series = {
      id: base.id,
      title: base.title,
      emoji: base.emoji || "🎬",
      source: base.source || "Offizieller Kanal",
      episodes: cleanEpisodeList(base.episodes, used)
    };
    if (!series.episodes.length) continue;
    merged.push(series);
    byTitle.set(slug(series.title), series);
  }

  for (const incoming of array(customSeries)) {
    const title = String(incoming?.title || "").trim();
    if (!title) continue;

    const ownUsed = new Set();
    const cleaned = cleanEpisodeList(incoming.episodes, ownUsed);
    if (!cleaned.length) continue;

    const key = slug(title);
    const existing = byTitle.get(key);
    if (existing) {
      for (const episode of cleaned) {
        if (!used.has(episode.youtubeId)) {
          used.add(episode.youtubeId);
          existing.episodes.push(episode);
        }
      }
      continue;
    }

    const episodes = [];
    for (const episode of cleaned) {
      if (!used.has(episode.youtubeId)) {
        used.add(episode.youtubeId);
        episodes.push(episode);
      }
    }
    if (!episodes.length) continue;

    const series = {
      id: String(incoming.id || uid("series")),
      title,
      emoji: String(incoming.emoji || "🎬"),
      source: String(incoming.source || "Eigener Eintrag"),
      episodes
    };
    merged.push(series);
    byTitle.set(key, series);
  }
  return merged;
}

function mergeMusic(customMusic, seedDefaults = false) {
  const used = new Set();
  const result = [];
  const startingMusic = seedDefaults ? deepCopy(DEFAULT_MUSIC) : [];
  for (const item of [...startingMusic, ...array(customMusic)]) {
    const youtubeId = extractYouTubeId(item?.youtubeId || item?.url || item?.link);
    if (!youtubeId || used.has(youtubeId)) continue;
    used.add(youtubeId);
    result.push({
      id: String(item?.id || uid("music")),
      title: String(item?.title || "Lied"),
      artist: String(item?.artist || ""),
      emoji: String(item?.emoji || "🎵"),
      youtubeId
    });
  }
  return result;
}

function normalize(raw, options = {}) {
  const base = defaults();
  const input = raw && typeof raw === "object" ? raw : {};
  const seedDefaults = options.seedDefaults === true ||
    (!Array.isArray(input.series) && !Array.isArray(input.collections));
  const seedMusic = options.seedDefaults === true || !Array.isArray(input.music);
  const kids = array(input.kids).length ? input.kids.map((kid, index) => ({
    id: String(kid?.id || `kind-${index + 1}`),
    name: String(kid?.name || `Kind ${index + 1}`),
    avatar: String(kid?.avatar || "🧒"),
    accent: String(kid?.accent || (index % 2 ? "pink" : "blue"))
  })).slice(0, 6) : base.kids;

  const series = mergeSeries(input.series || input.collections, seedDefaults);
  const music = mergeMusic(input.music, seedMusic);

  const validEpisodeIds = new Set(series.flatMap(item => item.episodes.map(episode => episode.id)));
  const favorites = {};
  const tasks = {};
  const stars = {};
  for (const kid of kids) {
    favorites[kid.id] = [...new Set(array(input.favorites?.[kid.id]).filter(id => validEpisodeIds.has(id)))];
    tasks[kid.id] = array(input.tasks?.[kid.id]).length
      ? input.tasks[kid.id].map(task => ({
          id: String(task?.id || uid("task")),
          title: String(task?.title || "Aufgabe"),
          emoji: String(task?.emoji || "⭐")
        }))
      : deepCopy(DEFAULT_TASKS);
    stars[kid.id] = Math.max(0, Number(input.stars?.[kid.id]) || 0);
  }

  const state = {
    version: VERSION,
    pin: /^\d{4,8}$/.test(String(input.pin || "")) ? String(input.pin) : "1234",
    kids,
    series,
    music,
    tasks,
    rewards: array(input.rewards).length ? input.rewards.map(reward => ({
      id: String(reward?.id || uid("reward")),
      title: String(reward?.title || "Belohnung"),
      emoji: String(reward?.emoji || "🎁"),
      cost: Math.max(1, Number(reward?.cost) || 1)
    })) : base.rewards,
    stars,
    favorites,
    history: array(input.history).filter(entry => validEpisodeIds.has(entry?.episodeId)).slice(-1000),
    requests: array(input.requests).map(request => ({
      id: String(request?.id || uid("request")),
      kidId: String(request?.kidId || ""),
      rewardId: String(request?.rewardId || ""),
      status: ["pending", "ready", "collected", "rejected"].includes(request?.status) ? request.status : "pending",
      createdAt: request?.createdAt || new Date().toISOString()
    })),
    daily: input.daily && typeof input.daily === "object" ? input.daily : base.daily,
    settings: {
      ...base.settings,
      ...(input.settings || {}),
      volume: Math.min(1, Math.max(0, Number(input.settings?.volume ?? base.settings.volume)))
    }
  };
  return ensureDaily(state);
}

function migrateLegacy(raw) {
  const base = defaults();
  if (!raw || typeof raw !== "object") return base;
  return normalize({
    ...base,
    ...raw,
    series: raw.series || raw.collections || [],
    music: raw.music || [],
    tasks: raw.tasks || base.tasks,
    stars: raw.stars || base.stars
  }, { seedDefaults: true });
}

function loadState() {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return normalize(JSON.parse(current));
    for (const legacyKey of LEGACY_KEYS) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy) return migrateLegacy(JSON.parse(legacy));
    }
  } catch (error) {
    console.error("Speicher konnte nicht geladen werden", error);
  }
  return defaults();
}

function saveState() {
  state.version = VERSION;
  localStorage.setItem(KEY, JSON.stringify(state));
}

function makeDailyKid() {
  return {
    tickets: {
      single1: { kind: "single", total: 1, used: 0 },
      single2: { kind: "single", total: 1, used: 0 },
      double: { kind: "double", total: 2, used: 0 },
      bonus: { kind: "bonus", total: 0, used: 0 }
    },
    activeTicketId: null,
    tasksDone: [],
    taskStarsAwarded: []
  };
}

function ensureDaily(target = state) {
  const currentDate = todayKey();
  if (!target.daily || target.daily.date !== currentDate || typeof target.daily.kids !== "object") {
    target.daily = { date: currentDate, kids: {} };
  }
  for (const kid of target.kids) {
    if (!target.daily.kids[kid.id]) target.daily.kids[kid.id] = makeDailyKid();
    const dailyKid = target.daily.kids[kid.id];
    dailyKid.tickets ||= makeDailyKid().tickets;
    for (const [id, template] of Object.entries(makeDailyKid().tickets)) {
      dailyKid.tickets[id] = {
        ...template,
        ...(dailyKid.tickets[id] || {}),
        total: Math.max(0, Number(dailyKid.tickets[id]?.total ?? template.total)),
        used: Math.max(0, Number(dailyKid.tickets[id]?.used ?? 0))
      };
      dailyKid.tickets[id].used = Math.min(dailyKid.tickets[id].used, dailyKid.tickets[id].total);
    }
    dailyKid.tasksDone = [...new Set(array(dailyKid.tasksDone))];
    dailyKid.taskStarsAwarded = [...new Set(array(dailyKid.taskStarsAwarded))];
    if (!dailyKid.tickets[dailyKid.activeTicketId] ||
        ticketRemaining(dailyKid.tickets[dailyKid.activeTicketId]) <= 0) {
      dailyKid.activeTicketId = null;
    }
  }
  return target;
}

function dailyKid(kidId = selectedKid?.id) {
  ensureDaily();
  return kidId ? state.daily.kids[kidId] : null;
}

function ticketRemaining(ticket) {
  return Math.max(0, Number(ticket?.total || 0) - Number(ticket?.used || 0));
}

function totalAvailableTickets(kidId) {
  const data = dailyKid(kidId);
  return Object.values(data?.tickets || {}).reduce((sum, ticket) => sum + (ticketRemaining(ticket) > 0 ? 1 : 0), 0);
}

class SoundManager {
  constructor() {
    this.files = ["tap", "open", "ticket", "star", "done", "error"];
    this.audio = Object.fromEntries(this.files.map(name => {
      const audio = new Audio(`./assets/sounds/${name}.wav`);
      audio.preload = "auto";
      return [name, audio];
    }));
  }

  play(name) {
    if (!state.settings.sounds) return;
    const source = this.audio[name] || this.audio.tap;
    try {
      const sound = source.cloneNode();
      sound.volume = state.settings.volume;
      void sound.play().catch(() => {});
    } catch {}
  }
}
const sounds = new SoundManager();

let state = loadState();
let view = "profiles";
let selectedKid = null;
let activeSeriesId = null;
let modal = null;
let parentTab = "dashboard";
let albumIndex = 0;
let playerContext = null;
let mediaCache = [];
let objectUrls = [];
let renderSerial = 0;

const root = $("#root");
const toastElement = $("#toast");

function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastElement.classList.remove("show"), 1800);
}

function speak(label) {
  if (!state.settings.voiceLabels || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(label);
    utterance.lang = "de-DE";
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
  } catch {}
}

function releaseObjectUrls() {
  objectUrls.forEach(url => URL.revokeObjectURL(url));
  objectUrls = [];
}

function mediaUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

function bearLogo() {
  return `<svg class="bear-logo" viewBox="0 0 128 128" aria-hidden="true">
    <path d="M18 55V31L64 7l46 24v24" fill="#f8d16c" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>
    <rect x="20" y="43" width="88" height="76" rx="25" fill="#fff8ec"/>
    <circle cx="39" cy="59" r="17" fill="#9a5b35"/><circle cx="89" cy="59" r="17" fill="#9a5b35"/>
    <circle cx="64" cy="78" r="39" fill="#bf7e49"/>
    <ellipse cx="64" cy="88" rx="24" ry="20" fill="#f2cca0"/>
    <circle cx="51" cy="73" r="4.5" fill="#263f4c"/><circle cx="77" cy="73" r="4.5" fill="#263f4c"/>
    <ellipse cx="64" cy="86" rx="7" ry="5.5" fill="#3b2a24"/>
    <path d="M64 92c-6 8-14 6-17 3m17-3c6 8 14 6 17 3" fill="none" stroke="#3b2a24" stroke-width="3.5" stroke-linecap="round"/>
  </svg>`;
}

function roomArt(kind) {
  const arts = {
    flix: `<svg viewBox="0 0 220 150" aria-hidden="true">
      <path d="M15 24h190v112H15z" rx="24" fill="#fff5ea"/>
      <path d="M15 24h42v112H15zM163 24h42v112h-42z" fill="#ef6f78"/>
      <path d="M15 24c20 22 28 45 21 112M205 24c-20 22-28 45-21 112" fill="none" stroke="#c84d5a" stroke-width="9"/>
      <rect x="61" y="38" width="98" height="70" rx="15" fill="#85d3f3"/>
      <path d="M100 57l35 16-35 19z" fill="#fff"/>
      <rect x="83" y="116" width="54" height="9" rx="4.5" fill="#d6a659"/>
    </svg>`,
    day: `<svg viewBox="0 0 220 150" aria-hidden="true">
      <circle cx="174" cy="38" r="25" fill="#ffd85f"/>
      <path d="M35 112h150" stroke="#75c878" stroke-width="14" stroke-linecap="round"/>
      <path d="M58 109V67l28-20 28 20v42" fill="#fff8e9" stroke="#e8ad62" stroke-width="6" stroke-linejoin="round"/>
      <rect x="75" y="82" width="21" height="27" rx="4" fill="#8fd0ee"/>
      <path d="M132 62c12-18 28-18 40 0-6 7-9 14-8 23h-24c1-9-2-16-8-23z" fill="#ff9fba"/>
      <path d="M151 85v25" stroke="#6964a9" stroke-width="6" stroke-linecap="round"/>
    </svg>`,
    music: `<svg viewBox="0 0 220 150" aria-hidden="true">
      <rect x="31" y="76" width="158" height="54" rx="16" fill="#fff"/>
      <path d="M47 78v50M73 78v50M99 78v50M125 78v50M151 78v50M177 78v50" stroke="#d6dfea" stroke-width="4"/>
      <rect x="61" y="76" width="17" height="30" rx="4" fill="#354b5a"/>
      <rect x="113" y="76" width="17" height="30" rx="4" fill="#354b5a"/>
      <rect x="165" y="76" width="17" height="30" rx="4" fill="#354b5a"/>
      <path d="M89 52V21l41-8v31" fill="none" stroke="#8c69d5" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="79" cy="57" r="13" fill="#a98ded"/><circle cx="121" cy="48" r="13" fill="#a98ded"/>
    </svg>`,
    treasure: `<svg viewBox="0 0 220 150" aria-hidden="true">
      <path d="M45 68c0-28 22-46 65-46s65 18 65 46" fill="#d98b45" stroke="#8f552d" stroke-width="7"/>
      <rect x="40" y="66" width="140" height="68" rx="14" fill="#c8793c" stroke="#8f552d" stroke-width="7"/>
      <path d="M40 88h140" stroke="#8f552d" stroke-width="7"/>
      <rect x="95" y="78" width="30" height="29" rx="6" fill="#ffd85f" stroke="#a77825" stroke-width="5"/>
      <path d="M23 40l7 15 16 2-12 11 3 16-14-8-14 8 3-16L0 57l16-2zM191 18l5 10 11 2-8 7 2 11-10-5-9 5 2-11-8-7 11-2z" fill="#ffe36f"/>
    </svg>`,
    album: `<svg viewBox="0 0 220 150" aria-hidden="true">
      <g transform="rotate(-7 82 76)"><rect x="35" y="25" width="100" height="105" rx="12" fill="#fff"/><rect x="46" y="37" width="78" height="65" rx="8" fill="#80d0ec"/><circle cx="102" cy="52" r="11" fill="#ffd85f"/><path d="M46 95l25-25 18 17 15-12 20 20z" fill="#79bd73"/></g>
      <g transform="rotate(8 144 84)"><rect x="98" y="34" width="88" height="96" rx="12" fill="#fff8ee"/><circle cx="142" cy="73" r="24" fill="#bf7e49"/><circle cx="132" cy="69" r="3" fill="#263f4c"/><circle cx="152" cy="69" r="3" fill="#263f4c"/><path d="M135 83q7 7 14 0" fill="none" stroke="#3b2a24" stroke-width="4" stroke-linecap="round"/></g>
    </svg>`
  };
  return arts[kind] || arts.flix;
}

function appShell(content, options = {}) {
  const showParent = options.parent !== false;
  const showHome = options.home === true;
  return `<div class="app-shell">
    <header class="topbar">
      <div class="brand">${bearLogo()}<span>Bärenhaus</span></div>
      <div class="top-actions">
        ${showHome ? `<button class="round-button home-button" data-action="home" aria-label="Zum Bärenhaus">⌂</button>` : ""}
        ${showParent ? `<button class="round-button parent-button" data-action="parent" aria-label="Elternbereich">🔒</button>` : ""}
      </div>
    </header>
    <main class="main-content">${content}</main>
  </div>`;
}

function childHeader(icon, extra = "") {
  return `<div class="child-header">
    <button class="round-button back-button" data-action="home" aria-label="Zurück">←</button>
    <div class="child-avatar">${selectedKid ? esc(selectedKid.avatar) : icon}</div>
    ${extra}
    <div class="header-bear">🐻</div>
  </div>`;
}

function childLabel(label) {
  return state.settings.childLabels ? `<span>${esc(label)}</span>` : "";
}

function profilesView() {
  return appShell(`<section class="profiles-page">
    <div class="welcome-bear">🐻</div>
    <div class="profile-grid">
      ${state.kids.map(kid => `<button class="profile-card ${esc(kid.accent)}" data-kid="${esc(kid.id)}" aria-label="${esc(kid.name)}">
        <div class="profile-avatar">${esc(kid.avatar)}</div>
        <strong>${esc(kid.name)}</strong>
      </button>`).join("")}
    </div>
  </section>`, { parent: true });
}

function homeView() {
  const routine = dailyKid();
  const taskTotal = state.tasks[selectedKid.id]?.length || 0;
  const taskDone = routine?.tasksDone?.length || 0;
  const readyRewards = state.requests.filter(request => request.kidId === selectedKid.id && request.status === "ready").length;
  return appShell(`<section class="house-page">
    <div class="kid-welcome">
      <button class="profile-bubble" data-action="profiles" aria-label="Profil wechseln">${esc(selectedKid.avatar)}</button>
      <div class="house-roof"><span>🐻</span></div>
    </div>
    <div class="room-grid">
      <button class="room-card flix-room" data-room="flix" aria-label="Bärflix">
        ${roomArt("flix")}
        ${childLabel("Bärflix")}
        <b class="room-badge">${totalAvailableTickets(selectedKid.id)}</b>
      </button>
      <button class="room-card day-room" data-room="day" aria-label="Unser Tag">
        ${roomArt("day")}
        ${childLabel("Unser Tag")}
        <b class="room-progress">${taskDone}/${taskTotal}</b>
      </button>
      <button class="room-card music-room" data-room="music" aria-label="Musikzimmer">
        ${roomArt("music")}
        ${childLabel("Musik")}
      </button>
      <button class="room-card treasure-room" data-room="treasure" aria-label="Schatzkammer">
        ${roomArt("treasure")}
        ${childLabel("Schatz")}
        <b class="star-badge">⭐ ${state.stars[selectedKid.id] || 0}</b>
        ${readyRewards ? `<i class="ready-badge">${readyRewards}</i>` : ""}
      </button>
      <button class="room-card album-room wide" data-room="album" aria-label="Familienalbum">
        ${roomArt("album")}
        ${childLabel("Fotos")}
        <b class="room-badge" id="albumCount">${mediaCache.filter(item => item.audience === "all" || item.audience === selectedKid.id).length}</b>
      </button>
    </div>
  </section>`);
}

function ticketGraphic(ticket, id) {
  const remaining = ticketRemaining(ticket);
  const triangles = Array.from({ length: ticket.total }, (_, index) =>
    `<i class="${index < remaining ? "on" : "off"}">▶</i>`).join("");
  const label = ticket.kind === "bonus" ? "Bonus-Ticket" :
    ticket.kind === "double" ? "Ticket für zwei Folgen" : "Ticket für eine Folge";
  return `<button class="ticket-card ${ticket.kind}" data-ticket="${id}" aria-label="${label}">
    <span class="ticket-holes"></span>
    <div class="ticket-symbols">${ticket.kind === "bonus" ? `<em>⭐</em>` : triangles}</div>
    ${ticket.kind === "bonus" ? `<div class="bonus-plays">${triangles}</div>` : ""}
  </button>`;
}

function ticketsView() {
  const data = dailyKid();
  const available = Object.entries(data.tickets).filter(([, ticket]) => ticketRemaining(ticket) > 0);
  return appShell(`${childHeader("🎟️")}
    <section class="ticket-page">
      <div class="ticket-bear">🐻🎟️</div>
      ${available.length ? `<div class="ticket-grid ${available.length === 3 ? "three" : ""}">
        ${available.map(([id, ticket]) => ticketGraphic(ticket, id)).join("")}
      </div>` : `<div class="sleeping-card"><div>🐻💤</div><button class="round-button" data-action="home" aria-label="Zum Bärenhaus">⌂</button></div>`}
    </section>`, { home: false });
}

function visibleSeries() {
  let list = [...state.series];
  if (state.settings.smartSort) {
    list.sort((a, b) => seriesScore(b) - seriesScore(a) || a.title.localeCompare(b.title, "de"));
  }
  return list;
}

function seriesScore(series) {
  const ids = new Set(series.episodes.map(episode => episode.id));
  let score = 0;
  for (const item of state.history) if (item.kidId === selectedKid?.id && ids.has(item.episodeId)) score += 3;
  for (const id of array(state.favorites[selectedKid?.id])) if (ids.has(id)) score += 5;
  return score;
}

function activeTicketDots() {
  const data = dailyKid();
  const ticket = data?.tickets?.[data.activeTicketId];
  if (!ticket) return "";
  return `<div class="ticket-dots">${Array.from({ length: ticket.total }, (_, index) =>
    `<i class="${index < ticketRemaining(ticket) ? "on" : ""}">▶</i>`).join("")}</div>`;
}

function flixLibraryView() {
  return appShell(`${childHeader("🎬", activeTicketDots())}
    <section class="series-grid">
      ${visibleSeries().map(series => `<button class="series-card" data-series="${esc(series.id)}" aria-label="${esc(series.title)}">
        <img src="${thumb(series.episodes[0].youtubeId)}" alt="" loading="lazy">
        <strong>${esc(series.title)}</strong>
        <i>▶</i>
      </button>`).join("")}
    </section>`, { home: false });
}

function seriesEpisodesView() {
  const series = state.series.find(item => item.id === activeSeriesId);
  if (!series) {
    view = "flix";
    return flixLibraryView();
  }
  const favorites = new Set(array(state.favorites[selectedKid.id]));
  const episodes = [...series.episodes].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
  return appShell(`${childHeader(series.emoji || "🎬", activeTicketDots())}
    <section class="episode-grid">
      ${episodes.map(episode => `<article class="episode-card">
        <button class="episode-play" data-play="${esc(episode.id)}" data-content="series" aria-label="${esc(episode.title)}">
          <img src="${thumb(episode.youtubeId)}" alt="" loading="lazy">
          <i>▶</i>
        </button>
        <button class="favorite-button" data-favorite="${esc(episode.id)}" aria-label="Lieblingsfolge">${favorites.has(episode.id) ? "❤️" : "🤍"}</button>
      </article>`).join("")}
    </section>`, { home: false });
}

function musicView() {
  return appShell(`${childHeader("🎵")}
    <section class="music-grid">
      ${state.music.map(item => `<button class="music-card" data-play="${esc(item.id)}" data-content="music" aria-label="${esc(item.title)}">
        <img src="${thumb(item.youtubeId)}" alt="" loading="lazy">
        <i>▶</i>
        <b>${esc(item.emoji || "🎵")}</b>
      </button>`).join("")}
    </section>`, { home: false });
}

function dayView() {
  const tasks = state.tasks[selectedKid.id] || [];
  const data = dailyKid();
  const done = new Set(data.tasksDone);
  return appShell(`${childHeader("☀️")}
    <section class="day-progress">
      ${tasks.map(task => `<i class="${done.has(task.id) ? "on" : ""}"></i>`).join("")}
    </section>
    <section class="task-grid">
      ${tasks.map(task => `<button class="task-card ${done.has(task.id) ? "done" : ""}" data-task="${esc(task.id)}" aria-label="${esc(task.title)}">
        <em>${esc(task.emoji)}</em>
        ${childLabel(task.title)}
        <b>✓</b>
      </button>`).join("")}
    </section>`, { home: false });
}

function stickerCount() {
  const stars = state.stars[selectedKid.id] || 0;
  return STICKERS.filter(sticker => stars >= sticker.need).length;
}

function treasureView() {
  const stars = state.stars[selectedKid.id] || 0;
  const requestsByReward = new Map(
    state.requests.filter(request => request.kidId === selectedKid.id && request.status !== "rejected")
      .map(request => [request.rewardId, request])
  );
  return appShell(`${childHeader("⭐")}
    <section class="star-jar">
      <div class="jar-stars">⭐</div><strong>${stars}</strong>
    </section>
    <section class="sticker-grid">
      ${STICKERS.map(sticker => `<div class="sticker ${stars >= sticker.need ? "unlocked" : ""}">
        ${stars >= sticker.need ? sticker.emoji : "🔒"}
      </div>`).join("")}
    </section>
    <section class="reward-grid">
      ${state.rewards.map(reward => {
        const request = requestsByReward.get(reward.id);
        const affordable = stars >= reward.cost;
        return `<button class="reward-card ${affordable ? "affordable" : ""} ${request?.status || ""}" data-reward="${esc(reward.id)}" aria-label="${esc(reward.title)}">
          <em>${esc(reward.emoji)}</em>
          ${childLabel(reward.title)}
          <b>⭐ ${reward.cost}</b>
          ${request?.status === "ready" ? `<i>✓</i>` : request?.status === "pending" ? `<i>…</i>` : ""}
        </button>`;
      }).join("")}
    </section>`, { home: false });
}

async function albumView() {
  const items = mediaCache.filter(item => item.audience === "all" || item.audience === selectedKid.id);
  if (!items.length) {
    return appShell(`${childHeader("📷")}
      <section class="empty-album"><div>🐻📷</div></section>`, { home: false });
  }
  albumIndex = Math.min(albumIndex, items.length - 1);
  const item = items[albumIndex];
  const url = mediaUrl(item.blob);
  const content = item.type.startsWith("video/")
    ? `<video src="${url}" controls playsinline></video>`
    : `<img src="${url}" alt="">`;
  return appShell(`${childHeader("📷")}
    <section class="album-viewer">
      <button class="album-arrow left" data-action="albumPrev" aria-label="Vorheriges Foto">‹</button>
      <div class="album-stage">${content}</div>
      <button class="album-arrow right" data-action="albumNext" aria-label="Nächstes Foto">›</button>
      <div class="album-dots">${items.map((_, index) => `<i class="${index === albumIndex ? "on" : ""}"></i>`).join("")}</div>
    </section>`, { home: false });
}

function pinModal() {
  return `<div class="modal-backdrop"><section class="modal-card pin-card">
    <div class="modal-head"><h2>Elternbereich</h2><button class="close-button" data-action="closeModal">×</button></div>
    <label class="field"><span>PIN</span><input id="pinInput" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label>
    <button class="primary-button full" data-action="unlock">Öffnen</button>
    <small>Der Notfall-PIN 1234 funktioniert immer.</small>
  </section></div>`;
}

function confirmRewardModal(rewardId) {
  const reward = state.rewards.find(item => item.id === rewardId);
  if (!reward) return "";
  return `<div class="modal-backdrop"><section class="modal-card reward-confirm">
    <div class="reward-big">${esc(reward.emoji)}</div>
    <div class="confirm-actions">
      <button class="confirm-no" data-action="closeModal">←</button>
      <button class="confirm-yes" data-confirm-reward="${esc(reward.id)}">✓</button>
    </div>
  </section></div>`;
}

function contentEditorModal(kind, id = "") {
  const isSeries = kind === "series";
  const list = isSeries ? state.series : state.music;
  const existing = list.find(item => item.id === id);
  const item = existing || (isSeries
    ? { id: "", title: "", emoji: "🎬", source: "Eigener Eintrag", episodes: [] }
    : { id: "", title: "", artist: "", emoji: "🎵", youtubeId: "" });

  if (!isSeries) {
    return `<div class="modal-backdrop"><section class="modal-card">
      <div class="modal-head"><h2>${existing ? "Lied bearbeiten" : "Lied hinzufügen"}</h2><button class="close-button" data-action="closeModal">×</button></div>
      <input type="hidden" id="editKind" value="music"><input type="hidden" id="contentId" value="${esc(item.id)}">
      <div class="form-grid">
        <label class="field"><span>Titel</span><input id="contentTitle" value="${esc(item.title)}"></label>
        <label class="field"><span>Künstler/Kanal</span><input id="contentSource" value="${esc(item.artist || "")}"></label>
        <label class="field"><span>Symbol</span><input id="contentEmoji" value="${esc(item.emoji || "🎵")}"></label>
        <label class="field wide"><span>YouTube-Link</span><input id="contentUrl" value="${item.youtubeId ? `https://youtu.be/${esc(item.youtubeId)}` : ""}"></label>
      </div>
      <button class="primary-button full" data-action="saveContent">Speichern</button>
      ${existing ? `<button class="danger-button full" data-delete-content="music:${esc(item.id)}">Lied löschen</button>` : ""}
    </section></div>`;
  }

  return `<div class="modal-backdrop"><section class="modal-card large">
    <div class="modal-head"><h2>${existing ? "Serie bearbeiten" : "Serie hinzufügen"}</h2><button class="close-button" data-action="closeModal">×</button></div>
    <input type="hidden" id="editKind" value="series"><input type="hidden" id="contentId" value="${esc(item.id)}">
    <div class="form-grid">
      <label class="field"><span>Titel</span><input id="contentTitle" value="${esc(item.title)}"></label>
      <label class="field"><span>Symbol</span><input id="contentEmoji" value="${esc(item.emoji || "🎬")}"></label>
      <label class="field wide"><span>Quelle</span><input id="contentSource" value="${esc(item.source || "")}"></label>
      <label class="field wide"><span>Neue Folge – YouTube-Link</span><input id="contentUrl"></label>
      <label class="field wide"><span>Titel der neuen Folge</span><input id="episodeTitle"></label>
    </div>
    <button class="primary-button full" data-action="saveContent">Speichern</button>
    ${existing ? `<div class="admin-list episode-admin-list">
      ${item.episodes.map(episode => `<div class="admin-row">
        <img src="${thumb(episode.youtubeId)}" alt="">
        <div><strong>${esc(episode.title)}</strong><small>${esc(episode.youtubeId)}</small></div>
        <button class="small-danger" data-delete-episode="${esc(item.id)}:${esc(episode.id)}">Löschen</button>
      </div>`).join("")}
    </div>
    <button class="danger-button full" data-delete-content="series:${esc(item.id)}">Serie löschen</button>` : ""}
  </section></div>`;
}

function taskEditorModal(kidId, taskId = "") {
  const task = (state.tasks[kidId] || []).find(item => item.id === taskId) || { id: "", title: "", emoji: "⭐" };
  return `<div class="modal-backdrop"><section class="modal-card">
    <div class="modal-head"><h2>${task.id ? "Aufgabe bearbeiten" : "Aufgabe hinzufügen"}</h2><button class="close-button" data-action="closeModal">×</button></div>
    <input type="hidden" id="taskKidId" value="${esc(kidId)}"><input type="hidden" id="taskId" value="${esc(task.id)}">
    <div class="form-grid">
      <label class="field"><span>Name</span><input id="taskTitle" value="${esc(task.title)}"></label>
      <label class="field"><span>Symbol</span><input id="taskEmoji" value="${esc(task.emoji)}"></label>
    </div>
    <button class="primary-button full" data-action="saveTask">Speichern</button>
    ${task.id ? `<button class="danger-button full" data-delete-task="${esc(kidId)}:${esc(task.id)}">Aufgabe löschen</button>` : ""}
  </section></div>`;
}

function rewardEditorModal(id = "") {
  const reward = state.rewards.find(item => item.id === id) || { id: "", title: "", emoji: "🎁", cost: 3 };
  return `<div class="modal-backdrop"><section class="modal-card">
    <div class="modal-head"><h2>${reward.id ? "Belohnung bearbeiten" : "Belohnung hinzufügen"}</h2><button class="close-button" data-action="closeModal">×</button></div>
    <input type="hidden" id="rewardId" value="${esc(reward.id)}">
    <div class="form-grid">
      <label class="field"><span>Name</span><input id="rewardTitle" value="${esc(reward.title)}"></label>
      <label class="field"><span>Symbol</span><input id="rewardEmoji" value="${esc(reward.emoji)}"></label>
      <label class="field wide"><span>Sterne</span><input id="rewardCost" type="number" min="1" max="99" value="${reward.cost}"></label>
    </div>
    <button class="primary-button full" data-action="saveReward">Speichern</button>
    ${reward.id ? `<button class="danger-button full" data-delete-reward="${esc(reward.id)}">Belohnung löschen</button>` : ""}
  </section></div>`;
}

function parentView() {
  return appShell(`<section class="parent-panel">
    <div class="parent-title"><h1>Elternbereich</h1><button class="primary-button" data-action="exitParent">Fertig</button></div>
    <nav class="parent-tabs">
      ${[
        ["dashboard", "Heute"],
        ["content", "Inhalte"],
        ["tasks", "Unser Tag"],
        ["rewards", "Schatz"],
        ["album", "Album"],
        ["settings", "Einstellungen"]
      ].map(([id, label]) => `<button class="${parentTab === id ? "active" : ""}" data-parent-tab="${id}">${label}</button>`).join("")}
    </nav>
    <div class="parent-content">${parentTabContent()}</div>
  </section>`, { parent: false });
}

function ticketAdminGraphic(kidId, id, ticket) {
  return `<div class="mini-ticket ${ticket.kind}">
    <span>${id.startsWith("single") ? "▶" : id === "double" ? "▶▶" : "⭐"}</span>
    <small>${ticket.used}/${ticket.total}</small>
  </div>`;
}

function parentTabContent() {
  if (parentTab === "dashboard") {
    return `<div class="dashboard-grid">
      ${state.kids.map(kid => {
        const data = dailyKid(kid.id);
        const done = data.tasksDone.length;
        const total = state.tasks[kid.id]?.length || 0;
        return `<article class="parent-kid-card">
          <div class="parent-kid-head"><span>${esc(kid.avatar)}</span><div><h2>${esc(kid.name)}</h2><small>${done}/${total} Tagesaufgaben</small></div></div>
          <div class="mini-ticket-row">${Object.entries(data.tickets).filter(([id]) => id !== "bonus" || data.tickets.bonus.total > 0).map(([id, ticket]) => ticketAdminGraphic(kid.id, id, ticket)).join("")}</div>
          <div class="bonus-control">
            <span>Bonus heute</span>
            <button data-bonus="${esc(kid.id)}:-1">−</button>
            <strong>${data.tickets.bonus.total}</strong>
            <button data-bonus="${esc(kid.id)}:1">+</button>
          </div>
          <div class="star-control">
            <span>⭐ ${state.stars[kid.id] || 0}</span>
            <button data-stars="${esc(kid.id)}:-1">−</button>
            <button data-stars="${esc(kid.id)}:1">+</button>
          </div>
          <button class="secondary-button full" data-reset-tickets="${esc(kid.id)}">Tickets zurücksetzen</button>
        </article>`;
      }).join("")}
    </div>
    ${requestAdminList()}`;
  }

  if (parentTab === "content") {
    return `<div class="section-head"><h2>Bärflix</h2><button class="primary-button" data-edit-content="series:">Serie hinzufügen</button></div>
      <div class="admin-list">${state.series.map(series => `<div class="admin-row">
        <img src="${thumb(series.episodes[0].youtubeId)}" alt="">
        <div><strong>${esc(series.title)}</strong><small>${series.episodes.length} Folgen · ${esc(series.source)}</small></div>
        <button class="secondary-button" data-edit-content="series:${esc(series.id)}">Bearbeiten</button>
      </div>`).join("")}</div>
      <div class="section-head top-space"><h2>Musikzimmer</h2><button class="primary-button" data-edit-content="music:">Lied hinzufügen</button></div>
      <div class="admin-list">${state.music.map(item => `<div class="admin-row">
        <img src="${thumb(item.youtubeId)}" alt="">
        <div><strong>${esc(item.title)}</strong><small>${esc(item.artist)}</small></div>
        <button class="secondary-button" data-edit-content="music:${esc(item.id)}">Bearbeiten</button>
      </div>`).join("")}</div>`;
  }

  if (parentTab === "tasks") {
    return `<div class="kid-task-columns">${state.kids.map(kid => `<section class="task-admin-card">
      <div class="section-head"><h2>${esc(kid.avatar)} ${esc(kid.name)}</h2><button class="primary-button" data-edit-task="${esc(kid.id)}:">Hinzufügen</button></div>
      <div class="admin-list">${(state.tasks[kid.id] || []).map((task, index, tasks) => `<div class="admin-row compact">
        <span class="admin-emoji">${esc(task.emoji)}</span>
        <div><strong>${esc(task.title)}</strong></div>
        <div class="row-actions">
          <button class="tiny-button" data-move-task="${esc(kid.id)}:${esc(task.id)}:-1" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="tiny-button" data-move-task="${esc(kid.id)}:${esc(task.id)}:1" ${index === tasks.length - 1 ? "disabled" : ""}>↓</button>
          <button class="secondary-button" data-edit-task="${esc(kid.id)}:${esc(task.id)}">Bearbeiten</button>
        </div>
      </div>`).join("")}</div>
    </section>`).join("")}</div>`;
  }

  if (parentTab === "rewards") {
    return `${requestAdminList()}
      <div class="section-head top-space"><h2>Belohnungen</h2><button class="primary-button" data-edit-reward="">Hinzufügen</button></div>
      <div class="admin-list">${state.rewards.map(reward => `<div class="admin-row compact">
        <span class="admin-emoji">${esc(reward.emoji)}</span>
        <div><strong>${esc(reward.title)}</strong><small>⭐ ${reward.cost}</small></div>
        <button class="secondary-button" data-edit-reward="${esc(reward.id)}">Bearbeiten</button>
      </div>`).join("")}</div>`;
  }

  if (parentTab === "album") {
    return `<div class="album-upload">
      <label class="field"><span>Fotos oder Videos</span><input id="mediaFiles" type="file" accept="image/*,video/*" multiple></label>
      <label class="field"><span>Sichtbar für</span><select id="mediaAudience">
        <option value="all">Alle Kinder</option>
        ${state.kids.map(kid => `<option value="${esc(kid.id)}">${esc(kid.name)}</option>`).join("")}
      </select></label>
      <button class="primary-button" data-action="uploadMedia">Hinzufügen</button>
    </div>
    <p class="hint">Die Dateien bleiben ausschließlich auf diesem Gerät im Browser gespeichert.</p>
    <div class="album-admin-grid">${mediaCache.map(item => {
      const url = mediaUrl(item.blob);
      const preview = item.type.startsWith("video/") ? `<video src="${url}" muted playsinline></video>` : `<img src="${url}" alt="">`;
      return `<article class="album-admin-item">${preview}<div><strong>${esc(item.name || "Datei")}</strong><small>${item.audience === "all" ? "Alle" : esc(state.kids.find(kid => kid.id === item.audience)?.name || item.audience)}</small></div><button class="small-danger" data-delete-media="${esc(item.id)}">Löschen</button></article>`;
    }).join("")}</div>`;
  }

  return `<div class="settings-grid">
    <section class="settings-card">
      <h2>Bedienung</h2>
      <label class="switch-row"><span>Töne</span><input id="settingSounds" type="checkbox" ${state.settings.sounds ? "checked" : ""}></label>
      <label class="field"><span>Lautstärke</span><input id="settingVolume" type="range" min="0" max="1" step="0.05" value="${state.settings.volume}"></label>
      <button class="secondary-button" data-action="testSound">Testton</button>
      <label class="switch-row"><span>Kurze Beschriftungen im Kinderbereich</span><input id="settingLabels" type="checkbox" ${state.settings.childLabels ? "checked" : ""}></label>
      <label class="switch-row"><span>Raumnamen vorlesen</span><input id="settingVoice" type="checkbox" ${state.settings.voiceLabels ? "checked" : ""}></label>
      <label class="switch-row"><span>Lieblingsserien nach vorn</span><input id="settingSmart" type="checkbox" ${state.settings.smartSort ? "checked" : ""}></label>
    </section>
    <section class="settings-card">
      <h2>PIN</h2>
      <label class="field"><span>Eltern-PIN</span><input id="settingPin" type="password" inputmode="numeric" maxlength="8" value="${esc(state.pin)}"></label>
      <small>1234 bleibt zusätzlich als Notfall-PIN aktiv.</small>
      <button class="primary-button full" data-action="saveSettings">Speichern</button>
    </section>
    <section class="settings-card">
      <h2>Backup</h2>
      <button class="primary-button full" data-action="exportBackup">Komplettes Backup herunterladen</button>
      <label class="field"><span>Backup-Datei</span><input id="backupFile" type="file" accept="application/json"></label>
      <button class="secondary-button full" data-action="importBackup">Backup importieren</button>
      <small>Das komplette Backup kann wegen der Album-Dateien größer sein.</small>
    </section>
    <section class="settings-card">
      <h2>App</h2>
      <p>Version ${VERSION}</p>
      <button class="danger-button full" data-action="resetApp">Bärenhaus zurücksetzen</button>
    </section>
  </div>`;
}

function requestAdminList() {
  const pending = state.requests.filter(request => request.status === "pending");
  const ready = state.requests.filter(request => request.status === "ready");
  if (!pending.length && !ready.length) return "";
  return `<section class="request-section top-space"><h2>Wünsche</h2><div class="admin-list">
    ${[...pending, ...ready].map(request => {
      const kid = state.kids.find(item => item.id === request.kidId);
      const reward = state.rewards.find(item => item.id === request.rewardId);
      if (!kid || !reward) return "";
      return `<div class="admin-row compact">
        <span class="admin-emoji">${esc(reward.emoji)}</span>
        <div><strong>${esc(kid.name)}: ${esc(reward.title)}</strong><small>${request.status === "pending" ? "wartet auf Entscheidung" : "ist bereit"}</small></div>
        <div class="row-actions">
          ${request.status === "pending" ? `<button class="primary-button" data-request="${esc(request.id)}:approve">Erlauben</button><button class="small-danger" data-request="${esc(request.id)}:reject">Ablehnen</button>` : `<button class="secondary-button" data-request="${esc(request.id)}:cancel">Zurücknehmen</button>`}
        </div>
      </div>`;
    }).join("")}
  </div></section>`;
}

function playerOverlay(item, context, remaining = null) {
  const youtubeId = item.youtubeId;
  return `<div class="video-player">
    <div class="player-bar">
      <button class="round-button player-close" data-action="closePlayer" aria-label="Video schließen">←</button>
      ${remaining !== null ? `<div class="player-tickets">${Array.from({ length: remaining }, () => "<i>▶</i>").join("")}</div>` : ""}
    </div>
    <iframe title="${esc(item.title)}" src="https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
  </div>`;
}

async function render() {
  const serial = ++renderSerial;
  ensureDaily();
  saveState();
  releaseObjectUrls();

  try {
    mediaCache = await listMedia();
  } catch (error) {
    console.error("Album konnte nicht geladen werden", error);
    mediaCache = [];
  }
  if (serial !== renderSerial) return;

  let html;
  if (!selectedKid && !["profiles", "parent"].includes(view)) view = "profiles";

  switch (view) {
    case "profiles": html = profilesView(); break;
    case "home": html = homeView(); break;
    case "tickets": html = ticketsView(); break;
    case "flix": html = flixLibraryView(); break;
    case "series": html = seriesEpisodesView(); break;
    case "music": html = musicView(); break;
    case "day": html = dayView(); break;
    case "treasure": html = treasureView(); break;
    case "album": html = await albumView(); break;
    case "parent": html = parentView(); break;
    default: view = "profiles"; html = profilesView();
  }

  if (modal?.type === "pin") html += pinModal();
  if (modal?.type === "reward") html += confirmRewardModal(modal.rewardId);
  if (modal?.type === "content") html += contentEditorModal(modal.kind, modal.id);
  if (modal?.type === "task") html += taskEditorModal(modal.kidId, modal.taskId);
  if (modal?.type === "rewardEditor") html += rewardEditorModal(modal.id);

  root.innerHTML = html;
  bindEvents();
}

function bindEvents() {
  $$("[data-kid]").forEach(button => button.addEventListener("click", () => {
    selectedKid = state.kids.find(kid => kid.id === button.dataset.kid) || null;
    if (!selectedKid) return;
    sounds.play("open");
    speak(selectedKid.name);
    view = "home";
    render();
  }));

  $$("[data-room]").forEach(button => button.addEventListener("click", () => {
    const room = button.dataset.room;
    sounds.play("open");
    const labels = { flix: "Bärflix", day: "Unser Tag", music: "Musik", treasure: "Schatzkammer", album: "Familienalbum" };
    speak(labels[room] || "");
    if (room === "flix") {
      const data = dailyKid();
      if (data.activeTicketId && ticketRemaining(data.tickets[data.activeTicketId]) > 0) view = "flix";
      else view = "tickets";
    } else view = room;
    render();
  }));

  $$("[data-ticket]").forEach(button => button.addEventListener("click", () => {
    const data = dailyKid();
    const id = button.dataset.ticket;
    if (!data.tickets[id] || ticketRemaining(data.tickets[id]) <= 0) return;
    data.activeTicketId = id;
    sounds.play("ticket");
    view = "flix";
    saveState();
    render();
  }));

  $$("[data-series]").forEach(button => button.addEventListener("click", () => {
    activeSeriesId = button.dataset.series;
    sounds.play("open");
    view = "series";
    render();
  }));

  $$("[data-play]").forEach(button => button.addEventListener("click", () => {
    playContent(button.dataset.content, button.dataset.play);
  }));

  $$("[data-favorite]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    const list = new Set(array(state.favorites[selectedKid.id]));
    const id = button.dataset.favorite;
    if (list.has(id)) list.delete(id); else list.add(id);
    state.favorites[selectedKid.id] = [...list];
    sounds.play("star");
    saveState();
    render();
  }));

  $$("[data-task]").forEach(button => button.addEventListener("click", () => {
    toggleTask(button.dataset.task);
  }));

  $$("[data-reward]").forEach(button => button.addEventListener("click", () => {
    const rewardId = button.dataset.reward;
    const request = state.requests.find(item => item.kidId === selectedKid.id && item.rewardId === rewardId && item.status !== "rejected");
    if (request?.status === "ready") {
      request.status = "collected";
      sounds.play("done");
      saveState();
      return render();
    }
    if (request?.status === "pending") {
      sounds.play("tap");
      return;
    }
    const reward = state.rewards.find(item => item.id === rewardId);
    if (!reward || (state.stars[selectedKid.id] || 0) < reward.cost) {
      sounds.play("error");
      return;
    }
    modal = { type: "reward", rewardId };
    sounds.play("open");
    render();
  }));

  $$("[data-confirm-reward]").forEach(button => button.addEventListener("click", () => {
    const rewardId = button.dataset.confirmReward;
    if (!state.requests.some(item => item.kidId === selectedKid.id && item.rewardId === rewardId && ["pending", "ready"].includes(item.status))) {
      state.requests.push({ id: uid("request"), kidId: selectedKid.id, rewardId, status: "pending", createdAt: new Date().toISOString() });
    }
    modal = null;
    sounds.play("done");
    saveState();
    render();
  }));

  $$("[data-parent-tab]").forEach(button => button.addEventListener("click", () => {
    parentTab = button.dataset.parentTab;
    sounds.play("tap");
    render();
  }));

  $$("[data-bonus]").forEach(button => button.addEventListener("click", () => {
    const [kidId, deltaRaw] = button.dataset.bonus.split(":");
    const delta = Number(deltaRaw);
    const bonus = dailyKid(kidId).tickets.bonus;
    bonus.total = Math.max(0, Math.min(5, bonus.total + delta));
    bonus.used = Math.min(bonus.used, bonus.total);
    if (bonus.total === 0 && dailyKid(kidId).activeTicketId === "bonus") dailyKid(kidId).activeTicketId = null;
    sounds.play("tap");
    saveState();
    render();
  }));

  $$("[data-stars]").forEach(button => button.addEventListener("click", () => {
    const [kidId, deltaRaw] = button.dataset.stars.split(":");
    state.stars[kidId] = Math.max(0, (state.stars[kidId] || 0) + Number(deltaRaw));
    sounds.play(Number(deltaRaw) > 0 ? "star" : "tap");
    saveState();
    render();
  }));

  $$("[data-reset-tickets]").forEach(button => button.addEventListener("click", () => {
    const kidId = button.dataset.resetTickets;
    const bonusTotal = dailyKid(kidId).tickets.bonus.total;
    state.daily.kids[kidId] = makeDailyKid();
    state.daily.kids[kidId].tickets.bonus.total = bonusTotal;
    sounds.play("done");
    saveState();
    render();
  }));

  $$("[data-edit-content]").forEach(button => button.addEventListener("click", () => {
    const [kind, id] = button.dataset.editContent.split(":");
    modal = { type: "content", kind, id };
    render();
  }));

  $$("[data-delete-content]").forEach(button => button.addEventListener("click", () => {
    const [kind, id] = button.dataset.deleteContent.split(":");
    if (!confirm("Wirklich löschen?")) return;
    if (kind === "series") state.series = state.series.filter(item => item.id !== id);
    else state.music = state.music.filter(item => item.id !== id);
    modal = null;
    state = normalize(state);
    saveState();
    render();
  }));

  $$("[data-delete-episode]").forEach(button => button.addEventListener("click", () => {
    const [seriesId, episodeId] = button.dataset.deleteEpisode.split(":");
    const series = state.series.find(item => item.id === seriesId);
    if (!series) return;
    series.episodes = series.episodes.filter(episode => episode.id !== episodeId);
    if (!series.episodes.length) {
      state.series = state.series.filter(item => item.id !== seriesId);
      modal = null;
    } else {
      modal = { type: "content", kind: "series", id: seriesId };
    }
    state = normalize(state);
    saveState();
    render();
  }));

  $$("[data-edit-task]").forEach(button => button.addEventListener("click", () => {
    const [kidId, taskId] = button.dataset.editTask.split(":");
    modal = { type: "task", kidId, taskId };
    render();
  }));

  $$("[data-delete-task]").forEach(button => button.addEventListener("click", () => {
    const [kidId, taskId] = button.dataset.deleteTask.split(":");
    state.tasks[kidId] = state.tasks[kidId].filter(task => task.id !== taskId);
    modal = null;
    saveState();
    render();
  }));

  $$("[data-move-task]").forEach(button => button.addEventListener("click", () => {
    const [kidId, taskId, directionRaw] = button.dataset.moveTask.split(":");
    const tasks = state.tasks[kidId];
    const index = tasks.findIndex(task => task.id === taskId);
    const next = index + Number(directionRaw);
    if (index < 0 || next < 0 || next >= tasks.length) return;
    [tasks[index], tasks[next]] = [tasks[next], tasks[index]];
    saveState();
    render();
  }));

  $$("[data-edit-reward]").forEach(button => button.addEventListener("click", () => {
    modal = { type: "rewardEditor", id: button.dataset.editReward };
    render();
  }));

  $$("[data-delete-reward]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.deleteReward;
    state.rewards = state.rewards.filter(item => item.id !== id);
    state.requests = state.requests.filter(item => item.rewardId !== id);
    modal = null;
    saveState();
    render();
  }));

  $$("[data-request]").forEach(button => button.addEventListener("click", () => {
    const [requestId, action] = button.dataset.request.split(":");
    const request = state.requests.find(item => item.id === requestId);
    if (!request) return;
    const reward = state.rewards.find(item => item.id === request.rewardId);
    if (action === "approve") {
      if (!reward || (state.stars[request.kidId] || 0) < reward.cost) {
        sounds.play("error");
        return toast("Nicht genug Sterne");
      }
      state.stars[request.kidId] -= reward.cost;
      request.status = "ready";
      sounds.play("done");
    } else if (action === "reject") {
      request.status = "rejected";
    } else if (action === "cancel") {
      request.status = "rejected";
      if (reward) state.stars[request.kidId] += reward.cost;
    }
    saveState();
    render();
  }));

  $$("[data-delete-media]").forEach(button => button.addEventListener("click", async () => {
    await deleteMedia(button.dataset.deleteMedia);
    sounds.play("tap");
    render();
  }));

  $$("[data-action]").forEach(button => button.addEventListener("click", () => handleAction(button.dataset.action)));
}

async function handleAction(action) {
  if (action === "parent") {
    modal = { type: "pin" };
    sounds.play("open");
    return render();
  }
  if (action === "closeModal") {
    modal = null;
    sounds.play("tap");
    return render();
  }
  if (action === "unlock") {
    const pin = $("#pinInput")?.value || "";
    if (pin === state.pin || pin === "1234") {
      modal = null;
      view = "parent";
      parentTab = "dashboard";
      sounds.play("done");
      return render();
    }
    sounds.play("error");
    return toast("PIN stimmt nicht");
  }
  if (action === "profiles") {
    selectedKid = null;
    view = "profiles";
    sounds.play("tap");
    return render();
  }
  if (action === "home") {
    if (view === "series") view = "flix";
    else if (view === "flix") {
      const data = dailyKid();
      data.activeTicketId = null;
      view = "home";
    } else view = selectedKid ? "home" : "profiles";
    sounds.play("tap");
    return render();
  }
  if (action === "exitParent") {
    view = selectedKid ? "home" : "profiles";
    sounds.play("done");
    return render();
  }
  if (action === "albumPrev" || action === "albumNext") {
    const count = mediaCache.filter(item => item.audience === "all" || item.audience === selectedKid.id).length;
    if (!count) return;
    albumIndex = (albumIndex + (action === "albumNext" ? 1 : -1) + count) % count;
    sounds.play("tap");
    return render();
  }
  if (action === "closePlayer") {
    closePlayer();
    return;
  }
  if (action === "saveContent") return saveContentForm();
  if (action === "saveTask") return saveTaskForm();
  if (action === "saveReward") return saveRewardForm();
  if (action === "uploadMedia") return uploadMedia();
  if (action === "saveSettings") return saveSettings();
  if (action === "testSound") {
    const enabled = state.settings.sounds;
    state.settings.sounds = true;
    sounds.play("star");
    state.settings.sounds = enabled;
    return;
  }
  if (action === "exportBackup") return exportBackup();
  if (action === "importBackup") return importBackup();
  if (action === "resetApp") return resetApp();
}

function playContent(kind, id) {
  let item;
  let remaining = null;

  if (kind === "series") {
    const series = state.series.find(entry => entry.id === activeSeriesId);
    item = series?.episodes.find(episode => episode.id === id);
    const data = dailyKid();
    const ticket = data?.tickets?.[data.activeTicketId];
    if (!ticket || ticketRemaining(ticket) <= 0) {
      data.activeTicketId = null;
      view = "tickets";
      sounds.play("error");
      return render();
    }
    ticket.used += 1;
    remaining = ticketRemaining(ticket);
    state.history.push({
      kidId: selectedKid.id,
      seriesId: series.id,
      episodeId: item?.id,
      youtubeId: item?.youtubeId,
      at: new Date().toISOString()
    });
    state.history = state.history.slice(-1000);
    playerContext = { kind, ticketId: data.activeTicketId, returnView: "series" };
  } else {
    item = state.music.find(entry => entry.id === id);
    playerContext = { kind, returnView: "music" };
  }

  if (!item) {
    sounds.play("error");
    return;
  }

  saveState();
  sounds.play("open");
  document.body.insertAdjacentHTML("beforeend", playerOverlay(item, kind, remaining));
  bindEvents();
}

function closePlayer() {
  $(".video-player")?.remove();
  if (playerContext?.kind === "series") {
    const data = dailyKid();
    const ticket = data.tickets[playerContext.ticketId];
    if (!ticket || ticketRemaining(ticket) <= 0) {
      data.activeTicketId = null;
      view = "tickets";
    } else {
      view = playerContext.returnView || "series";
    }
  } else if (playerContext?.kind === "music") {
    view = "music";
  }
  playerContext = null;
  sounds.play("tap");
  render();
}

function toggleTask(taskId) {
  const data = dailyKid();
  const done = new Set(data.tasksDone);
  const awarded = new Set(data.taskStarsAwarded);
  if (done.has(taskId)) {
    done.delete(taskId);
    sounds.play("tap");
  } else {
    done.add(taskId);
    if (!awarded.has(taskId)) {
      awarded.add(taskId);
      state.stars[selectedKid.id] = (state.stars[selectedKid.id] || 0) + 1;
      sounds.play("star");
      confetti();
    } else {
      sounds.play("done");
    }
  }
  data.tasksDone = [...done];
  data.taskStarsAwarded = [...awarded];
  saveState();
  render();
}

function confetti() {
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  const pieces = ["⭐", "✨", "🌟", "💛", "🩵"];
  for (let index = 0; index < 24; index++) {
    const piece = document.createElement("i");
    piece.textContent = pieces[index % pieces.length];
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2200);
}

function saveContentForm() {
  const kind = $("#editKind")?.value;
  const id = $("#contentId")?.value;
  const title = $("#contentTitle")?.value.trim();
  const emoji = $("#contentEmoji")?.value.trim() || (kind === "series" ? "🎬" : "🎵");
  const source = $("#contentSource")?.value.trim();
  const url = $("#contentUrl")?.value.trim();
  const youtubeId = extractYouTubeId(url);

  if (!title) return toast("Titel fehlt");

  const allVideoIds = new Set([
    ...state.series.flatMap(series => series.episodes.map(episode => episode.youtubeId)),
    ...state.music.map(item => item.youtubeId)
  ]);

  if (kind === "music") {
    if (!youtubeId) return toast("YouTube-Link fehlt");
    const duplicate = [...state.music, ...state.series.flatMap(series => series.episodes)]
      .some(item => item.youtubeId === youtubeId && item.id !== id);
    if (duplicate) return toast("Video ist bereits vorhanden");

    let item = state.music.find(entry => entry.id === id);
    if (!item) {
      item = { id: uid("music"), title, artist: source || "", emoji, youtubeId };
      state.music.push(item);
    } else {
      item.title = title;
      item.artist = source || "";
      item.emoji = emoji;
      item.youtubeId = youtubeId;
    }
  } else {
    let series = state.series.find(entry => entry.id === id);
    if (!series) {
      series = { id: uid("series"), title, emoji, source: source || "Eigener Eintrag", episodes: [] };
      state.series.push(series);
    }
    series.title = title;
    series.emoji = emoji;
    series.source = source || "Eigener Eintrag";

    if (url) {
      if (!youtubeId) return toast("YouTube-Link nicht erkannt");
      if (allVideoIds.has(youtubeId)) return toast("Video ist bereits vorhanden");
      series.episodes.push({
        id: uid("episode"),
        title: $("#episodeTitle")?.value.trim() || "Folge",
        youtubeId
      });
    }

    if (!series.episodes.length) {
      state.series = state.series.filter(entry => entry.id !== series.id);
      modal = null;
      saveState();
      render();
      return toast("Leere Serie wurde nicht gespeichert");
    }
  }

  state = normalize(state);
  modal = null;
  sounds.play("done");
  saveState();
  render();
}

function saveTaskForm() {
  const kidId = $("#taskKidId")?.value;
  const id = $("#taskId")?.value;
  const title = $("#taskTitle")?.value.trim();
  const emoji = $("#taskEmoji")?.value.trim() || "⭐";
  if (!title || !state.tasks[kidId]) return toast("Name fehlt");
  let task = state.tasks[kidId].find(item => item.id === id);
  if (!task) {
    task = { id: uid("task"), title, emoji };
    state.tasks[kidId].push(task);
  } else {
    task.title = title;
    task.emoji = emoji;
  }
  modal = null;
  sounds.play("done");
  saveState();
  render();
}

function saveRewardForm() {
  const id = $("#rewardId")?.value;
  const title = $("#rewardTitle")?.value.trim();
  const emoji = $("#rewardEmoji")?.value.trim() || "🎁";
  const cost = Math.max(1, Number($("#rewardCost")?.value) || 1);
  if (!title) return toast("Name fehlt");
  let reward = state.rewards.find(item => item.id === id);
  if (!reward) {
    reward = { id: uid("reward"), title, emoji, cost };
    state.rewards.push(reward);
  } else {
    reward.title = title;
    reward.emoji = emoji;
    reward.cost = cost;
  }
  modal = null;
  sounds.play("done");
  saveState();
  render();
}

async function uploadMedia() {
  const files = [...($("#mediaFiles")?.files || [])];
  const audience = $("#mediaAudience")?.value || "all";
  if (!files.length) return toast("Datei auswählen");
  for (const file of files) {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) continue;
    if (file.size > 60 * 1024 * 1024) {
      toast(`${file.name} ist zu groß`);
      continue;
    }
    await putMedia({
      id: uid("media"),
      name: file.name,
      type: file.type,
      audience,
      createdAt: new Date().toISOString(),
      blob: file
    });
  }
  sounds.play("done");
  render();
}

function saveSettings() {
  const pin = $("#settingPin")?.value.trim();
  if (!/^\d{4,8}$/.test(pin)) return toast("PIN: 4 bis 8 Ziffern");
  state.pin = pin;
  state.settings.sounds = $("#settingSounds")?.checked ?? true;
  state.settings.volume = Number($("#settingVolume")?.value ?? 0.65);
  state.settings.childLabels = $("#settingLabels")?.checked ?? true;
  state.settings.voiceLabels = $("#settingVoice")?.checked ?? false;
  state.settings.smartSort = $("#settingSmart")?.checked ?? true;
  sounds.play("done");
  saveState();
  toast("Gespeichert");
  render();
}

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(",");
  const type = header.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function exportBackup() {
  try {
    const media = await listMedia();
    const encodedMedia = [];
    for (const item of media) {
      encodedMedia.push({
        id: item.id,
        name: item.name,
        type: item.type,
        audience: item.audience,
        createdAt: item.createdAt,
        dataUrl: await blobToDataUrl(item.blob)
      });
    }
    const bundle = { app: "Bärenhaus", version: VERSION, exportedAt: new Date().toISOString(), state, media: encodedMedia };
    const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Baerenhaus-Backup-${todayKey()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    sounds.play("done");
  } catch (error) {
    console.error(error);
    sounds.play("error");
    toast("Backup konnte nicht erstellt werden");
  }
}

async function importBackup() {
  const file = $("#backupFile")?.files?.[0];
  if (!file) return toast("Backup-Datei auswählen");
  try {
    const parsed = JSON.parse(await file.text());
    const importedState = parsed.state || parsed;
    state = normalize(importedState);
    if (Array.isArray(parsed.media)) {
      await clearMedia();
      for (const item of parsed.media) {
        if (!item.dataUrl) continue;
        await putMedia({
          id: item.id || uid("media"),
          name: item.name || "Datei",
          type: item.type || "application/octet-stream",
          audience: item.audience || "all",
          createdAt: item.createdAt || new Date().toISOString(),
          blob: dataUrlToBlob(item.dataUrl)
        });
      }
    }
    selectedKid = null;
    view = "profiles";
    modal = null;
    saveState();
    sounds.play("done");
    render();
  } catch (error) {
    console.error(error);
    sounds.play("error");
    toast("Backup ist fehlerhaft");
  }
}

async function resetApp() {
  if (!confirm("Bärenhaus wirklich vollständig zurücksetzen?")) return;
  localStorage.removeItem(KEY);
  await clearMedia();
  state = defaults();
  selectedKid = null;
  view = "profiles";
  modal = null;
  sounds.play("done");
  render();
}

window.addEventListener("error", event => {
  console.error(event.error || event.message);
  toast("🐻");
});

window.addEventListener("unhandledrejection", event => {
  console.error(event.reason);
  toast("🐻");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    ensureDaily();
    saveState();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js?v=100").catch(console.warn));
}

render();
