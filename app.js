import {
  VERSION,
  DEFAULT_SERIES,
  DEFAULT_MUSIC,
  DEFAULT_REWARDS,
  STICKERS
} from "./data.js";

const KEY = "baerenhaus.v12";
const LEGACY_KEYS = [
  "baerenhaus.v1",
  "baerenhaus.v11",
  "baerflix.v91",
  "baerflix.v9",
  "baerflix.complete.v8",
  "baerflix.complete.v7",
  "baerflix.complete.v6"
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const array = value => Array.isArray(value) ? value : [];
const copy = value => structuredClone(value);
const todayKey = () => new Date().toLocaleDateString("sv-SE");
const uid = (prefix = "id") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const slug = value => String(value || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");

function youtubeId(value) {
  const raw = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  return raw.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/)?.[1] || "";
}

const thumb = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function baseState() {
  return {
    version: VERSION,
    pin: "1234",
    kids: [
      { id: "ludwig", name: "Ludwig", avatar: "🧒", accent: "blue", ticketMinutes: 15 },
      { id: "fabian", name: "Fabian", avatar: "👦", accent: "pink", ticketMinutes: 15 }
    ],
    series: copy(DEFAULT_SERIES),
    music: copy(DEFAULT_MUSIC),
    rewards: copy(DEFAULT_REWARDS),
    stars: { ludwig: 0, fabian: 0 },
    favorites: { ludwig: [], fabian: [] },
    history: [],
    requests: [],
    daily: { date: todayKey(), kids: {} },
    settings: {
      sounds: true,
      volume: 0.7,
      smartSort: true,
      childLabels: true,
      voiceLabels: false,
      treasureEnabled: true,
      finishEpisode: true
    }
  };
}

function cleanEpisodes(items, globallyUsed) {
  const result = [];
  for (const item of array(items)) {
    const id = youtubeId(item?.youtubeId || item?.url || item?.link);
    if (!id || globallyUsed.has(id)) continue;
    globallyUsed.add(id);
    result.push({
      id: String(item?.id || uid("episode")),
      title: String(item?.title || "Folge"),
      youtubeId: id
    });
  }
  return result;
}

function mergeSeries(items, seedDefaults = false) {
  const used = new Set();
  const result = [];
  const byTitle = new Map();

  for (const source of seedDefaults ? copy(DEFAULT_SERIES) : []) {
    const series = {
      id: source.id,
      title: source.title,
      emoji: source.emoji || "🎬",
      source: source.source || "Offizieller Kanal",
      episodes: cleanEpisodes(source.episodes, used)
    };
    if (!series.episodes.length) continue;
    result.push(series);
    byTitle.set(slug(series.title), series);
  }

  for (const source of array(items)) {
    const title = String(source?.title || "").trim();
    if (!title) continue;

    const localUsed = new Set();
    const cleaned = cleanEpisodes(source.episodes, localUsed);
    if (!cleaned.length) continue;

    const existing = byTitle.get(slug(title));
    if (existing) {
      for (const episode of cleaned) {
        if (!used.has(episode.youtubeId)) {
          used.add(episode.youtubeId);
          existing.episodes.push(episode);
        }
      }
      continue;
    }

    const episodes = cleaned.filter(episode => {
      if (used.has(episode.youtubeId)) return false;
      used.add(episode.youtubeId);
      return true;
    });
    if (!episodes.length) continue;

    const series = {
      id: String(source.id || uid("series")),
      title,
      emoji: String(source.emoji || "🎬"),
      source: String(source.source || "Eigener Eintrag"),
      episodes
    };
    result.push(series);
    byTitle.set(slug(title), series);
  }
  return result;
}

function mergeMusic(items, seedDefaults = false) {
  const used = new Set();
  const result = [];
  for (const source of [...(seedDefaults ? copy(DEFAULT_MUSIC) : []), ...array(items)]) {
    const id = youtubeId(source?.youtubeId || source?.url || source?.link);
    if (!id || used.has(id)) continue;
    used.add(id);
    result.push({
      id: String(source.id || uid("music")),
      title: String(source.title || "Lied"),
      artist: String(source.artist || ""),
      emoji: String(source.emoji || "🎵"),
      youtubeId: id
    });
  }
  return result;
}

function normalize(raw, options = {}) {
  const base = baseState();
  const input = raw && typeof raw === "object" ? raw : {};
  const seedSeries = options.seedDefaults === true ||
    (!Array.isArray(input.series) && !Array.isArray(input.collections));
  const seedMusic = options.seedDefaults === true || !Array.isArray(input.music);

  const kids = array(input.kids).length
    ? input.kids.slice(0, 6).map((kid, index) => ({
        id: String(kid?.id || `kind-${index + 1}`),
        name: String(kid?.name || `Kind ${index + 1}`),
        avatar: String(kid?.avatar || "🧒"),
        accent: String(kid?.accent || (index % 2 ? "pink" : "blue")),
        ticketMinutes: Math.max(5, Math.min(45, Number(kid?.ticketMinutes) || 15))
      }))
    : base.kids;

  const series = mergeSeries(input.series || input.collections, seedSeries);
  const music = mergeMusic(input.music, seedMusic);
  const validEpisodeIds = new Set(series.flatMap(item => item.episodes.map(episode => episode.id)));

  const favorites = {};
  const stars = {};
  for (const kid of kids) {
    favorites[kid.id] = [...new Set(array(input.favorites?.[kid.id]).filter(id => validEpisodeIds.has(id)))];
    stars[kid.id] = Math.max(0, Number(input.stars?.[kid.id]) || 0);
  }

  return ensureDaily({
    version: VERSION,
    pin: /^\d{4,8}$/.test(String(input.pin || "")) ? String(input.pin) : "1234",
    kids,
    series,
    music,
    rewards: array(input.rewards).length
      ? input.rewards.map(reward => ({
          id: String(reward?.id || uid("reward")),
          title: String(reward?.title || "Belohnung"),
          emoji: String(reward?.emoji || "🎁"),
          cost: Math.max(1, Number(reward?.cost) || 1)
        }))
      : base.rewards,
    stars,
    favorites,
    history: array(input.history).filter(entry => validEpisodeIds.has(entry?.episodeId)).slice(-1000),
    requests: array(input.requests).map(request => ({
      id: String(request?.id || uid("request")),
      kidId: String(request?.kidId || ""),
      rewardId: String(request?.rewardId || ""),
      status: ["pending", "ready", "collected", "rejected"].includes(request?.status)
        ? request.status : "pending",
      createdAt: request?.createdAt || new Date().toISOString()
    })),
    daily: input.daily && typeof input.daily === "object" ? input.daily : base.daily,
    settings: {
      ...base.settings,
      ...(input.settings || {}),
      volume: Math.min(1, Math.max(0, Number(input.settings?.volume ?? base.settings.volume))),
      treasureEnabled: input.settings?.treasureEnabled !== false,
      finishEpisode: input.settings?.finishEpisode !== false
    }
  });
}

function migrateLegacy(raw) {
  const base = baseState();
  if (!raw || typeof raw !== "object") return base;

  const curatedTitles = new Set(DEFAULT_SERIES.map(series => slug(series.title)));
  const customSeries = array(raw.series || raw.collections)
    .filter(series => !curatedTitles.has(slug(series?.title)));

  return normalize({
    ...base,
    ...raw,
    kids: array(raw.kids).length ? raw.kids : base.kids,
    series: [...copy(DEFAULT_SERIES), ...customSeries],
    music: Array.isArray(raw.music) ? raw.music : copy(DEFAULT_MUSIC),
    stars: raw.stars || base.stars,
    settings: { ...base.settings, ...(raw.settings || {}), finishEpisode: true }
  });
}

function loadState() {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return normalize(JSON.parse(current));
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) return migrateLegacy(JSON.parse(legacy));
    }
  } catch (error) {
    console.error("Speicher konnte nicht geladen werden", error);
  }
  return baseState();
}

function saveState() {
  state.version = VERSION;
  localStorage.setItem(KEY, JSON.stringify(state));
}

function newDailyKid() {
  return {
    tickets: {
      single1: { kind: "single", units: 1, usedSeconds: 0 },
      single2: { kind: "single", units: 1, usedSeconds: 0 },
      double: { kind: "double", units: 2, usedSeconds: 0 },
      bonus: { kind: "bonus", units: 0, usedSeconds: 0 }
    },
    activeTicketId: null
  };
}

function minutesPerUnit(kidId = selectedKid?.id) {
  const kid = state.kids.find(item => item.id === kidId);
  return Math.max(5, Math.min(45, Number(kid?.ticketMinutes) || 15));
}

function unitSeconds(kidId = selectedKid?.id) {
  return minutesPerUnit(kidId) * 60;
}

function ticketTotalSeconds(ticket, kidId = selectedKid?.id) {
  return Math.max(0, Number(ticket?.units || 0) * unitSeconds(kidId));
}

function ticketRemainingSeconds(ticket, kidId = selectedKid?.id) {
  return Math.max(0, ticketTotalSeconds(ticket, kidId) - Math.max(0, Number(ticket?.usedSeconds || 0)));
}

function ticketUnitFraction(ticket, unitIndex, kidId = selectedKid?.id) {
  const seconds = unitSeconds(kidId);
  const spent = Math.max(0, Number(ticket?.usedSeconds || 0) - unitIndex * seconds);
  return Math.max(0, Math.min(1, (seconds - Math.min(seconds, spent)) / seconds));
}

function progressBubble(ticket, ticketId, unitIndex, size = "normal", kidId = selectedKid?.id) {
  const fraction = ticketUnitFraction(ticket, unitIndex, kidId);
  return `<i class="progress-play ${size} ${fraction <= 0.001 ? "empty" : ""}"
    data-progress-ticket="${esc(ticketId)}" data-progress-unit="${unitIndex}"
    style="--progress:${(fraction * 100).toFixed(2)}%"><span>▶</span></i>`;
}

function ensureDaily(target = state) {
  const date = todayKey();
  if (!target.daily || target.daily.date !== date || typeof target.daily.kids !== "object") {
    target.daily = { date, kids: {} };
  }

  for (const kid of target.kids) {
    if (!target.daily.kids[kid.id]) target.daily.kids[kid.id] = newDailyKid();
    const daily = target.daily.kids[kid.id];
    daily.tickets ||= newDailyKid().tickets;

    for (const [id, template] of Object.entries(newDailyKid().tickets)) {
      const previous = daily.tickets[id] || {};
      const units = Math.max(0, Number(previous.units ?? previous.total ?? template.units));
      const migratedUsedSeconds = Number.isFinite(Number(previous.usedSeconds))
        ? Number(previous.usedSeconds)
        : Math.max(0, Number(previous.used || 0)) * unitSeconds(kid.id);

      daily.tickets[id] = {
        kind: previous.kind || template.kind,
        units,
        usedSeconds: Math.min(Math.max(0, migratedUsedSeconds), units * unitSeconds(kid.id))
      };
    }

    if (!daily.tickets[daily.activeTicketId] ||
        ticketRemainingSeconds(daily.tickets[daily.activeTicketId], kid.id) <= 0) {
      daily.activeTicketId = null;
    }
  }
  return target;
}

function dailyKid(kidId = selectedKid?.id) {
  ensureDaily();
  return kidId ? state.daily.kids[kidId] : null;
}

function availableTicketCards(kidId) {
  return Object.values(dailyKid(kidId)?.tickets || {})
    .filter(ticket => ticketRemainingSeconds(ticket, kidId) > 0.5).length;
}

function formatSeconds(seconds) {
  const value = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

class SoundManager {
  constructor() {
    this.names = ["tap", "open", "ticket", "star", "done", "error"];
    this.audio = Object.fromEntries(this.names.map(name => {
      const audio = new Audio(`./assets/sounds/${name}.wav`);
      audio.preload = "auto";
      return [name, audio];
    }));
  }

  play(name) {
    if (!state.settings.sounds) return;
    try {
      const sound = (this.audio[name] || this.audio.tap).cloneNode();
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
let parentTab = "today";
let playerContext = null;
let youtubePlayer = null;
let usageTimer = null;
let lastPlayerSecond = null;
let lastUsageSave = 0;

let resolveYouTubeReady;
const youtubeReady = new Promise(resolve => {
  resolveYouTubeReady = resolve;
  if (window.YT?.Player) {
    resolve();
  } else {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") previous();
      resolve();
    };
  }
});

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

function shell(content, options = {}) {
  return `<div class="app-shell">
    <header class="topbar">
      <div class="brand">${bearLogo()}<span>Bärenhaus</span></div>
      <div class="top-actions">
        ${options.home ? `<button class="round-button" data-action="home" aria-label="Zum Bärenhaus">⌂</button>` : ""}
        ${options.parent === false ? "" : `<button class="round-button parent-button" data-action="parent" aria-label="Elternbereich">🔒</button>`}
      </div>
    </header>
    <main class="main-content">${content}</main>
  </div>`;
}

function childHeader(icon, extra = "") {
  return `<div class="child-header">
    <button class="round-button" data-action="home" aria-label="Zurück">←</button>
    <div class="child-avatar">${selectedKid ? esc(selectedKid.avatar) : icon}</div>
    ${extra}
    <div class="header-bear">🐻</div>
  </div>`;
}

function label(text) {
  return state.settings.childLabels ? `<span>${esc(text)}</span>` : "";
}

function profilesView() {
  return shell(`<section class="profiles-page">
    <div class="welcome-bear">🐻</div>
    <div class="profile-grid">${state.kids.map(kid => `<button class="profile-card ${esc(kid.accent)}" data-kid="${esc(kid.id)}" aria-label="${esc(kid.name)}">
      <div class="profile-avatar">${esc(kid.avatar)}</div>
      <strong>${esc(kid.name)}</strong>
    </button>`).join("")}</div>
  </section>`);
}

function posterStrip(items, kind) {
  return `<div class="poster-strip">${items.slice(0, 3).map((item, index) => {
    const id = kind === "series" ? item.episodes[0]?.youtubeId : item.youtubeId;
    return `<img style="--poster:${index}" src="${thumb(id)}" alt="">`;
  }).join("")}</div>`;
}

function homeView() {
  const topSeries = [...state.series].sort((a, b) => seriesScore(b) - seriesScore(a)).slice(0, 3);
  const topMusic = state.music.slice(0, 3);
  const ready = state.requests.filter(request => request.kidId === selectedKid.id && request.status === "ready").length;

  return shell(`<section class="focus-home">
    <div class="home-profile-row">
      <button class="profile-bubble" data-action="profiles" aria-label="Profil wechseln">${esc(selectedKid.avatar)}</button>
      <div class="home-bear">🐻</div>
    </div>

    <button class="media-portal flix-portal" data-room="flix" aria-label="Bärflix">
      ${posterStrip(topSeries, "series")}
      <div class="portal-overlay"><strong>🎬 Bärflix</strong><i>▶</i></div>
      <b class="portal-badge">${availableTicketCards(selectedKid.id) ? "🎟️" : "💤"}</b>
    </button>

    <button class="media-portal music-portal" data-room="music" aria-label="Musik">
      ${posterStrip(topMusic, "music")}
      <div class="portal-overlay"><strong>🎵 Musik</strong><i>▶</i></div>
    </button>

    ${state.settings.treasureEnabled ? `<button class="treasure-strip" data-room="treasure" aria-label="Schatzkiste">
      <span>🧰</span>
      ${label("Schatzkiste")}
      <b>⭐ ${state.stars[selectedKid.id] || 0}</b>
      ${ready ? `<i>${ready}</i>` : ""}
    </button>` : ""}
  </section>`);
}

function ticketCard(ticket, id) {
  const plays = Array.from({ length: ticket.units }, (_, index) =>
    progressBubble(ticket, id, index, "large")).join("");

  return `<button class="ticket-card ${ticket.kind} ${id}" data-ticket="${id}"
    aria-label="${ticket.kind === "double" ? "Zwei Folgen" : ticket.kind === "bonus" ? "Bonus" : "Eine Folge"}">
    <span class="ticket-cut left"></span><span class="ticket-cut right"></span>
    ${ticket.kind === "bonus"
      ? `<em>⭐</em><div class="bonus-plays">${plays}</div>`
      : `<div class="ticket-plays">${plays}</div>`}
  </button>`;
}

function ticketsView() {
  const tickets = dailyKid().tickets;
  return shell(`${childHeader("🎟️")}
    <section class="tickets-focus">
      <div class="ticket-mascot">🐻🎟️</div>
      <div class="ticket-layout">
        ${ticketRemainingSeconds(tickets.single1) > 0.5 ? ticketCard(tickets.single1, "single1") : ""}
        ${ticketRemainingSeconds(tickets.single2) > 0.5 ? ticketCard(tickets.single2, "single2") : ""}
        ${ticketRemainingSeconds(tickets.double) > 0.5 ? ticketCard(tickets.double, "double") : ""}
        ${ticketRemainingSeconds(tickets.bonus) > 0.5 ? ticketCard(tickets.bonus, "bonus") : ""}
      </div>
      ${availableTicketCards(selectedKid.id) ? "" : `<div class="all-used">🐻💤</div>`}
    </section>`);
}

function seriesScore(series) {
  const ids = new Set(series.episodes.map(episode => episode.id));
  let score = 0;
  for (const entry of state.history) if (entry.kidId === selectedKid?.id && ids.has(entry.episodeId)) score += 3;
  for (const id of array(state.favorites[selectedKid?.id])) if (ids.has(id)) score += 5;
  return score;
}

function activeTicketDots() {
  const data = dailyKid();
  const ticket = data?.tickets?.[data.activeTicketId];
  if (!ticket) return "";
  return `<div class="ticket-dots">${Array.from({ length: ticket.units }, (_, index) =>
    progressBubble(ticket, data.activeTicketId, index, "small")).join("")}</div>`;
}

function flixView() {
  const series = [...state.series];
  if (state.settings.smartSort) series.sort((a, b) => seriesScore(b) - seriesScore(a) || a.title.localeCompare(b.title, "de"));
  return shell(`${childHeader("🎬", activeTicketDots())}
    <section class="series-grid">${series.map(item => `<button class="series-card" data-series="${esc(item.id)}" aria-label="${esc(item.title)}">
      <img src="${thumb(item.episodes[0].youtubeId)}" alt="">
      <strong>${esc(item.title)}</strong><i>▶</i>
    </button>`).join("")}</section>`);
}

function episodesView() {
  const series = state.series.find(item => item.id === activeSeriesId);
  if (!series) {
    view = "flix";
    return flixView();
  }
  const favorites = new Set(array(state.favorites[selectedKid.id]));
  const episodes = [...series.episodes].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));

  return shell(`${childHeader(series.emoji || "🎬", activeTicketDots())}
    <section class="episode-grid">${episodes.map(episode => `<article class="episode-card">
      <button class="episode-play" data-play="${esc(episode.id)}" data-kind="series" aria-label="${esc(episode.title)}">
        <img src="${thumb(episode.youtubeId)}" alt=""><i>▶</i>
      </button>
      <button class="favorite-button" data-favorite="${esc(episode.id)}" aria-label="Favorit">${favorites.has(episode.id) ? "❤️" : "🤍"}</button>
    </article>`).join("")}</section>`);
}

function musicView() {
  return shell(`${childHeader("🎵")}
    <section class="music-grid">${state.music.map(item => `<button class="music-card" data-play="${esc(item.id)}" data-kind="music" aria-label="${esc(item.title)}">
      <img src="${thumb(item.youtubeId)}" alt=""><i>▶</i>
      <b>${esc(item.emoji || "🎵")}</b>
      ${state.settings.childLabels ? `<strong>${esc(item.title)}</strong>` : ""}
    </button>`).join("")}</section>`);
}

function treasureView() {
  const stars = state.stars[selectedKid.id] || 0;
  const requests = new Map(
    state.requests.filter(request => request.kidId === selectedKid.id && request.status !== "rejected")
      .map(request => [request.rewardId, request])
  );

  return shell(`${childHeader("⭐")}
    <section class="star-counter"><span>⭐</span><strong>${stars}</strong></section>
    <section class="sticker-grid">${STICKERS.map(sticker => `<div class="sticker ${stars >= sticker.need ? "unlocked" : ""}">
      ${stars >= sticker.need ? sticker.emoji : "🔒"}
    </div>`).join("")}</section>
    <section class="reward-grid">${state.rewards.map(reward => {
      const request = requests.get(reward.id);
      const affordable = stars >= reward.cost;
      return `<button class="reward-card ${affordable ? "affordable" : ""} ${request?.status || ""}" data-reward="${esc(reward.id)}" aria-label="${esc(reward.title)}">
        <em>${esc(reward.emoji)}</em>${label(reward.title)}<b>⭐ ${reward.cost}</b>
        ${request?.status === "ready" ? "<i>✓</i>" : request?.status === "pending" ? "<i>…</i>" : ""}
      </button>`;
    }).join("")}</section>`);
}

function pinModal() {
  return `<div class="modal-backdrop"><section class="modal-card pin-card">
    <div class="modal-head"><h2>Elternbereich</h2><button class="close-button" data-action="closeModal">×</button></div>
    <label class="field"><span>PIN</span><input id="pinInput" type="password" inputmode="numeric" maxlength="8"></label>
    <button class="primary-button full" data-action="unlock">Öffnen</button>
    <small>Notfall-PIN: 1234</small>
  </section></div>`;
}

function rewardConfirmModal(rewardId) {
  const reward = state.rewards.find(item => item.id === rewardId);
  if (!reward) return "";
  return `<div class="modal-backdrop"><section class="modal-card reward-confirm">
    <div class="reward-big">${esc(reward.emoji)}</div>
    <div class="confirm-actions">
      <button data-action="closeModal">←</button>
      <button class="yes" data-confirm-reward="${esc(reward.id)}">✓</button>
    </div>
  </section></div>`;
}

function contentModal(kind, id = "") {
  if (kind === "music") {
    const item = state.music.find(entry => entry.id === id) || { id: "", title: "", artist: "", emoji: "🎵", youtubeId: "" };
    return `<div class="modal-backdrop"><section class="modal-card">
      <div class="modal-head"><h2>${id ? "Lied bearbeiten" : "Lied hinzufügen"}</h2><button class="close-button" data-action="closeModal">×</button></div>
      <input id="editKind" type="hidden" value="music"><input id="contentId" type="hidden" value="${esc(item.id)}">
      <div class="form-grid">
        <label class="field"><span>Titel</span><input id="contentTitle" value="${esc(item.title)}"></label>
        <label class="field"><span>Kanal/Künstler</span><input id="contentSource" value="${esc(item.artist || "")}"></label>
        <label class="field"><span>Symbol</span><input id="contentEmoji" value="${esc(item.emoji || "🎵")}"></label>
        <label class="field wide"><span>YouTube-Link</span><input id="contentUrl" value="${item.youtubeId ? `https://youtu.be/${esc(item.youtubeId)}` : ""}"></label>
      </div>
      <button class="primary-button full" data-action="saveContent">Speichern</button>
      ${id ? `<button class="danger-button full" data-delete-content="music:${esc(item.id)}">Lied löschen</button>` : ""}
    </section></div>`;
  }

  const series = state.series.find(entry => entry.id === id) || { id: "", title: "", emoji: "🎬", source: "", episodes: [] };
  return `<div class="modal-backdrop"><section class="modal-card large">
    <div class="modal-head"><h2>${id ? "Serie bearbeiten" : "Serie hinzufügen"}</h2><button class="close-button" data-action="closeModal">×</button></div>
    <input id="editKind" type="hidden" value="series"><input id="contentId" type="hidden" value="${esc(series.id)}">
    <div class="form-grid">
      <label class="field"><span>Titel</span><input id="contentTitle" value="${esc(series.title)}"></label>
      <label class="field"><span>Symbol</span><input id="contentEmoji" value="${esc(series.emoji || "🎬")}"></label>
      <label class="field wide"><span>Quelle</span><input id="contentSource" value="${esc(series.source || "")}"></label>
      <label class="field wide"><span>Neue Folge – YouTube-Link</span><input id="contentUrl"></label>
      <label class="field wide"><span>Titel der neuen Folge</span><input id="episodeTitle"></label>
    </div>
    <button class="primary-button full" data-action="saveContent">Speichern</button>
    ${id ? `<div class="admin-list">${series.episodes.map(episode => `<div class="admin-row">
      <img src="${thumb(episode.youtubeId)}" alt=""><div><strong>${esc(episode.title)}</strong><small>${esc(episode.youtubeId)}</small></div>
      <button class="small-danger" data-delete-episode="${esc(series.id)}:${esc(episode.id)}">Löschen</button>
    </div>`).join("")}</div>
    <button class="danger-button full" data-delete-content="series:${esc(series.id)}">Serie löschen</button>` : ""}
  </section></div>`;
}

function rewardEditorModal(id = "") {
  const reward = state.rewards.find(item => item.id === id) || { id: "", title: "", emoji: "🎁", cost: 3 };
  return `<div class="modal-backdrop"><section class="modal-card">
    <div class="modal-head"><h2>${id ? "Belohnung bearbeiten" : "Belohnung hinzufügen"}</h2><button class="close-button" data-action="closeModal">×</button></div>
    <input id="rewardId" type="hidden" value="${esc(reward.id)}">
    <div class="form-grid">
      <label class="field"><span>Name</span><input id="rewardTitle" value="${esc(reward.title)}"></label>
      <label class="field"><span>Symbol</span><input id="rewardEmoji" value="${esc(reward.emoji)}"></label>
      <label class="field wide"><span>Sterne</span><input id="rewardCost" type="number" min="1" max="99" value="${reward.cost}"></label>
    </div>
    <button class="primary-button full" data-action="saveReward">Speichern</button>
    ${id ? `<button class="danger-button full" data-delete-reward="${esc(reward.id)}">Belohnung löschen</button>` : ""}
  </section></div>`;
}

function requestList() {
  const requests = state.requests.filter(request => ["pending", "ready"].includes(request.status));
  if (!requests.length) return "";
  return `<section class="request-section"><h2>Wünsche</h2><div class="admin-list">${requests.map(request => {
    const kid = state.kids.find(item => item.id === request.kidId);
    const reward = state.rewards.find(item => item.id === request.rewardId);
    if (!kid || !reward) return "";
    return `<div class="admin-row compact">
      <span class="admin-emoji">${esc(reward.emoji)}</span>
      <div><strong>${esc(kid.name)}: ${esc(reward.title)}</strong><small>${request.status === "pending" ? "wartet" : "freigegeben"}</small></div>
      <div class="row-actions">${request.status === "pending"
        ? `<button class="primary-button" data-request="${esc(request.id)}:approve">Erlauben</button><button class="small-danger" data-request="${esc(request.id)}:reject">Ablehnen</button>`
        : `<button class="secondary-button" data-request="${esc(request.id)}:cancel">Zurücknehmen</button>`}</div>
    </div>`;
  }).join("")}</div></section>`;
}

function parentView() {
  return shell(`<section class="parent-panel">
    <div class="parent-title"><h1>Elternbereich</h1><button class="primary-button" data-action="exitParent">Fertig</button></div>
    <nav class="parent-tabs">
      ${[["today", "Heute"], ["content", "Inhalte"], ["treasure", "Schatz"], ["settings", "Einstellungen"]]
        .map(([id, text]) => `<button class="${parentTab === id ? "active" : ""}" data-parent-tab="${id}">${text}</button>`).join("")}
    </nav>
    <div class="parent-content">${parentContent()}</div>
  </section>`, { parent: false });
}

function miniTicket(id, ticket, kidId) {
  const symbol = id.startsWith("single") ? "▶" : id === "double" ? "▶▶" : "⭐";
  return `<div class="mini-ticket ${ticket.kind}">
    <span>${symbol}</span>
    <small>${formatSeconds(ticketRemainingSeconds(ticket, kidId))}</small>
  </div>`;
}

function parentContent() {
  if (parentTab === "today") {
    return `<div class="dashboard-grid">${state.kids.map(kid => {
      const data = dailyKid(kid.id);
      return `<article class="parent-kid-card">
        <div class="parent-kid-head"><span>${esc(kid.avatar)}</span><h2>${esc(kid.name)}</h2></div>
        <div class="mini-ticket-row">${Object.entries(data.tickets)
          .filter(([id, ticket]) => id !== "bonus" || ticket.total > 0)
          .map(([id, ticket]) => miniTicket(id, ticket, kid.id)).join("")}</div>
        <label class="ticket-length-row"><span>Minuten je ▶</span><input type="number" min="5" max="45" step="1" value="${minutesPerUnit(kid.id)}" data-ticket-minutes="${esc(kid.id)}"></label>
        <div class="counter-row"><span>Bonus-▶ heute</span><button data-bonus="${esc(kid.id)}:-1">−</button><strong>${data.tickets.bonus.units}</strong><button data-bonus="${esc(kid.id)}:1">+</button></div>
        ${state.settings.treasureEnabled ? `<div class="counter-row"><span>Sterne</span><button data-stars="${esc(kid.id)}:-1">−</button><strong>⭐ ${state.stars[kid.id] || 0}</strong><button data-stars="${esc(kid.id)}:1">+</button></div>` : ""}
        <button class="secondary-button full" data-reset-tickets="${esc(kid.id)}">Tickets zurücksetzen</button>
      </article>`;
    }).join("")}</div>${requestList()}`;
  }

  if (parentTab === "content") {
    return `<div class="section-head"><h2>Bärflix</h2><button class="primary-button" data-edit-content="series:">Serie hinzufügen</button></div>
      <div class="admin-list">${state.series.map(series => `<div class="admin-row">
        <img src="${thumb(series.episodes[0].youtubeId)}" alt=""><div><strong>${esc(series.title)}</strong><small>${series.episodes.length} Folgen · ${esc(series.source)}</small></div>
        <button class="secondary-button" data-edit-content="series:${esc(series.id)}">Bearbeiten</button>
      </div>`).join("")}</div>
      <div class="section-head top-space"><h2>Musik</h2><button class="primary-button" data-edit-content="music:">Lied hinzufügen</button></div>
      <div class="admin-list">${state.music.map(item => `<div class="admin-row">
        <img src="${thumb(item.youtubeId)}" alt=""><div><strong>${esc(item.title)}</strong><small>${esc(item.artist)}</small></div>
        <button class="secondary-button" data-edit-content="music:${esc(item.id)}">Bearbeiten</button>
      </div>`).join("")}</div>`;
  }

  if (parentTab === "treasure") {
    return `<div class="treasure-explainer">
      <div>⭐</div><p>Ihr gebt Ludwig und Fabian Sterne für Dinge außerhalb der App. Die Kinder sehen damit Sticker und können eine Belohnung wünschen. Erst nach eurer Freigabe werden Sterne abgezogen.</p>
    </div>
    ${requestList()}
    <div class="section-head top-space"><h2>Belohnungen</h2><button class="primary-button" data-edit-reward="">Hinzufügen</button></div>
    <div class="admin-list">${state.rewards.map(reward => `<div class="admin-row compact">
      <span class="admin-emoji">${esc(reward.emoji)}</span><div><strong>${esc(reward.title)}</strong><small>⭐ ${reward.cost}</small></div>
      <button class="secondary-button" data-edit-reward="${esc(reward.id)}">Bearbeiten</button>
    </div>`).join("")}</div>`;
  }

  return `<div class="settings-grid">
    <section class="settings-card">
      <h2>Kinderbereich</h2>
      <label class="switch-row"><span>Schatzkiste anzeigen</span><input id="settingTreasure" type="checkbox" ${state.settings.treasureEnabled ? "checked" : ""}></label>
      <label class="switch-row"><span>Kurze Namen anzeigen</span><input id="settingLabels" type="checkbox" ${state.settings.childLabels ? "checked" : ""}></label>
      <label class="switch-row"><span>Bereiche vorlesen</span><input id="settingVoice" type="checkbox" ${state.settings.voiceLabels ? "checked" : ""}></label>
      <label class="switch-row"><span>Lieblingsserien zuerst</span><input id="settingSmart" type="checkbox" ${state.settings.smartSort ? "checked" : ""}></label>
      <label class="switch-row"><span>Begonnene ganze Folge zu Ende ansehen</span><input id="settingFinishEpisode" type="checkbox" ${state.settings.finishEpisode ? "checked" : ""}></label>
    </section>
    <section class="settings-card">
      <h2>Töne</h2>
      <label class="switch-row"><span>Töne aktiv</span><input id="settingSounds" type="checkbox" ${state.settings.sounds ? "checked" : ""}></label>
      <label class="field"><span>Lautstärke</span><input id="settingVolume" type="range" min="0" max="1" step="0.05" value="${state.settings.volume}"></label>
      <button class="secondary-button" data-action="testSound">Testton</button>
    </section>
    <section class="settings-card">
      <h2>PIN</h2>
      <label class="field"><span>Eltern-PIN</span><input id="settingPin" type="password" inputmode="numeric" maxlength="8" value="${esc(state.pin)}"></label>
      <small>1234 bleibt Notfall-PIN.</small>
      <button class="primary-button full" data-action="saveSettings">Speichern</button>
    </section>
    <section class="settings-card">
      <h2>Backup</h2>
      <button class="primary-button full" data-action="exportBackup">Backup herunterladen</button>
      <label class="field"><span>Backup-Datei</span><input id="backupFile" type="file" accept="application/json"></label>
      <button class="secondary-button full" data-action="importBackup">Backup importieren</button>
      <button class="danger-button full" data-action="resetApp">Bärenhaus zurücksetzen</button>
      <small>Version ${VERSION}</small>
    </section>
  </div>`;
}

function playerOverlay(item, ticket = null, ticketId = "") {
  const progress = ticket
    ? `<div class="player-tickets">${Array.from({ length: ticket.units }, (_, index) =>
        progressBubble(ticket, ticketId, index, "small")).join("")}</div>`
    : "";

  return `<div class="video-player">
    <div class="player-bar">
      <button class="round-button" data-action="closePlayer" aria-label="Zurück">←</button>
      ${progress}
    </div>
    <div id="youtubePlayer" class="youtube-player" aria-label="${esc(item.title)}"></div>
  </div>`;
}

function render() {
  ensureDaily();
  saveState();

  if (!selectedKid && !["profiles", "parent"].includes(view)) view = "profiles";

  let html;
  switch (view) {
    case "profiles": html = profilesView(); break;
    case "home": html = homeView(); break;
    case "tickets": html = ticketsView(); break;
    case "flix": html = flixView(); break;
    case "episodes": html = episodesView(); break;
    case "music": html = musicView(); break;
    case "treasure": html = treasureView(); break;
    case "parent": html = parentView(); break;
    default: view = "profiles"; html = profilesView();
  }

  if (modal?.type === "pin") html += pinModal();
  if (modal?.type === "reward") html += rewardConfirmModal(modal.rewardId);
  if (modal?.type === "content") html += contentModal(modal.kind, modal.id);
  if (modal?.type === "rewardEditor") html += rewardEditorModal(modal.id);

  root.innerHTML = html;
  bind();
}

function bind() {
  $$("[data-kid]").forEach(button => button.onclick = () => {
    selectedKid = state.kids.find(kid => kid.id === button.dataset.kid) || null;
    if (!selectedKid) return;
    sounds.play("open");
    speak(selectedKid.name);
    view = "home";
    render();
  });

  $$("[data-room]").forEach(button => button.onclick = () => {
    const room = button.dataset.room;
    sounds.play("open");
    speak(room === "flix" ? "Bärflix" : room === "music" ? "Musik" : "Schatzkiste");
    if (room === "flix") {
      const data = dailyKid();
      view = data.activeTicketId && ticketRemaining(data.tickets[data.activeTicketId]) > 0 ? "flix" : "tickets";
    } else {
      view = room;
    }
    render();
  });

  $$("[data-ticket]").forEach(button => button.onclick = () => {
    const data = dailyKid();
    const id = button.dataset.ticket;
    if (!data.tickets[id] || ticketRemainingSeconds(data.tickets[id]) <= 0.5) return;
    data.activeTicketId = id;
    sounds.play("ticket");
    view = "flix";
    saveState();
    render();
  });

  $$("[data-series]").forEach(button => button.onclick = () => {
    activeSeriesId = button.dataset.series;
    sounds.play("open");
    view = "episodes";
    render();
  });

  $$("[data-play]").forEach(button => button.onclick = () => play(button.dataset.kind, button.dataset.play));

  $$("[data-favorite]").forEach(button => button.onclick = event => {
    event.stopPropagation();
    const favorites = new Set(array(state.favorites[selectedKid.id]));
    if (favorites.has(button.dataset.favorite)) favorites.delete(button.dataset.favorite);
    else favorites.add(button.dataset.favorite);
    state.favorites[selectedKid.id] = [...favorites];
    sounds.play("star");
    saveState();
    render();
  });

  $$("[data-reward]").forEach(button => button.onclick = () => {
    const reward = state.rewards.find(item => item.id === button.dataset.reward);
    const request = state.requests.find(item => item.kidId === selectedKid.id && item.rewardId === reward?.id && item.status !== "rejected");

    if (request?.status === "ready") {
      request.status = "collected";
      sounds.play("done");
      saveState();
      return render();
    }
    if (request?.status === "pending") return sounds.play("tap");
    if (!reward || (state.stars[selectedKid.id] || 0) < reward.cost) return sounds.play("error");

    modal = { type: "reward", rewardId: reward.id };
    sounds.play("open");
    render();
  });

  $$("[data-confirm-reward]").forEach(button => button.onclick = () => {
    const rewardId = button.dataset.confirmReward;
    if (!state.requests.some(item => item.kidId === selectedKid.id && item.rewardId === rewardId && ["pending", "ready"].includes(item.status))) {
      state.requests.push({ id: uid("request"), kidId: selectedKid.id, rewardId, status: "pending", createdAt: new Date().toISOString() });
    }
    modal = null;
    sounds.play("done");
    saveState();
    render();
  });

  $$("[data-parent-tab]").forEach(button => button.onclick = () => {
    parentTab = button.dataset.parentTab;
    sounds.play("tap");
    render();
  });

  $$("[data-bonus]").forEach(button => button.onclick = () => {
    const [kidId, deltaText] = button.dataset.bonus.split(":");
    const bonus = dailyKid(kidId).tickets.bonus;
    bonus.units = Math.max(0, Math.min(5, bonus.units + Number(deltaText)));
    bonus.usedSeconds = Math.min(bonus.usedSeconds, bonus.units * unitSeconds(kidId));
    if (!bonus.units && dailyKid(kidId).activeTicketId === "bonus") dailyKid(kidId).activeTicketId = null;
    sounds.play("tap");
    saveState();
    render();
  });

  $$("[data-ticket-minutes]").forEach(input => input.onchange = () => {
    const kid = state.kids.find(item => item.id === input.dataset.ticketMinutes);
    if (!kid) return;
    kid.ticketMinutes = Math.max(5, Math.min(45, Number(input.value) || 15));

    const data = dailyKid(kid.id);
    for (const ticket of Object.values(data.tickets)) {
      ticket.usedSeconds = Math.min(ticket.usedSeconds, ticket.units * unitSeconds(kid.id));
    }
    sounds.play("done");
    saveState();
    render();
  });

  $$("[data-stars]").forEach(button => button.onclick = () => {
    const [kidId, deltaText] = button.dataset.stars.split(":");
    state.stars[kidId] = Math.max(0, (state.stars[kidId] || 0) + Number(deltaText));
    sounds.play(Number(deltaText) > 0 ? "star" : "tap");
    saveState();
    render();
  });

  $$("[data-reset-tickets]").forEach(button => button.onclick = () => {
    const kidId = button.dataset.resetTickets;
    const bonus = dailyKid(kidId).tickets.bonus.units;
    state.daily.kids[kidId] = newDailyKid();
    state.daily.kids[kidId].tickets.bonus.units = bonus;
    sounds.play("done");
    saveState();
    render();
  });

  $$("[data-edit-content]").forEach(button => button.onclick = () => {
    const [kind, id] = button.dataset.editContent.split(":");
    modal = { type: "content", kind, id };
    render();
  });

  $$("[data-delete-content]").forEach(button => button.onclick = () => {
    const [kind, id] = button.dataset.deleteContent.split(":");
    if (!confirm("Wirklich löschen?")) return;
    if (kind === "series") state.series = state.series.filter(item => item.id !== id);
    else state.music = state.music.filter(item => item.id !== id);
    modal = null;
    state = normalize(state);
    saveState();
    render();
  });

  $$("[data-delete-episode]").forEach(button => button.onclick = () => {
    const [seriesId, episodeId] = button.dataset.deleteEpisode.split(":");
    const series = state.series.find(item => item.id === seriesId);
    if (!series) return;
    series.episodes = series.episodes.filter(episode => episode.id !== episodeId);
    if (!series.episodes.length) {
      state.series = state.series.filter(item => item.id !== seriesId);
      modal = null;
    } else modal = { type: "content", kind: "series", id: seriesId };
    state = normalize(state);
    saveState();
    render();
  });

  $$("[data-edit-reward]").forEach(button => button.onclick = () => {
    modal = { type: "rewardEditor", id: button.dataset.editReward };
    render();
  });

  $$("[data-delete-reward]").forEach(button => button.onclick = () => {
    const id = button.dataset.deleteReward;
    state.rewards = state.rewards.filter(item => item.id !== id);
    state.requests = state.requests.filter(item => item.rewardId !== id);
    modal = null;
    saveState();
    render();
  });

  $$("[data-request]").forEach(button => button.onclick = () => {
    const [requestId, action] = button.dataset.request.split(":");
    const request = state.requests.find(item => item.id === requestId);
    const reward = state.rewards.find(item => item.id === request?.rewardId);
    if (!request) return;

    if (action === "approve") {
      if (!reward || (state.stars[request.kidId] || 0) < reward.cost) return toast("Nicht genug Sterne");
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
  });

  $$("[data-action]").forEach(button => button.onclick = () => action(button.dataset.action));
}

function action(name) {
  if (name === "parent") {
    modal = { type: "pin" };
    sounds.play("open");
    return render();
  }
  if (name === "closeModal") {
    modal = null;
    sounds.play("tap");
    return render();
  }
  if (name === "unlock") {
    const pin = $("#pinInput")?.value || "";
    if (pin === state.pin || pin === "1234") {
      modal = null;
      view = "parent";
      parentTab = "today";
      sounds.play("done");
      return render();
    }
    sounds.play("error");
    return toast("PIN stimmt nicht");
  }
  if (name === "profiles") {
    selectedKid = null;
    view = "profiles";
    sounds.play("tap");
    return render();
  }
  if (name === "home") {
    if (view === "episodes") view = "flix";
    else if (view === "flix") {
      dailyKid().activeTicketId = null;
      view = "home";
    } else view = selectedKid ? "home" : "profiles";
    sounds.play("tap");
    return render();
  }
  if (name === "exitParent") {
    view = selectedKid ? "home" : "profiles";
    sounds.play("done");
    return render();
  }
  if (name === "closePlayer") return closePlayer();
  if (name === "saveContent") return saveContent();
  if (name === "saveReward") return saveReward();
  if (name === "testSound") {
    const old = state.settings.sounds;
    state.settings.sounds = true;
    sounds.play("star");
    state.settings.sounds = old;
    return;
  }
  if (name === "saveSettings") return saveSettings();
  if (name === "exportBackup") return exportBackup();
  if (name === "importBackup") return importBackup();
  if (name === "resetApp") return resetApp();
}

function updateProgressVisuals(ticketId, ticket, kidId = selectedKid?.id) {
  $$(`[data-progress-ticket="${CSS.escape(ticketId)}"]`).forEach(element => {
    const index = Number(element.dataset.progressUnit);
    const fraction = ticketUnitFraction(ticket, index, kidId);
    element.style.setProperty("--progress", `${(fraction * 100).toFixed(2)}%`);
    element.classList.toggle("empty", fraction <= 0.001);
  });
}

function stopUsageTracker({ save = true } = {}) {
  clearInterval(usageTimer);
  usageTimer = null;
  lastPlayerSecond = null;
  if (save) saveState();
}

function handleTicketExpired() {
  if (!playerContext || playerContext.kind !== "series" || playerContext.ticketExpired) return;
  playerContext.ticketExpired = true;
  stopUsageTracker();
  sounds.play("done");

  if (!state.settings.finishEpisode) {
    try { youtubePlayer?.pauseVideo(); } catch {}
    setTimeout(() => closePlayer(), 350);
  }
}

function consumePlayback(seconds) {
  if (!playerContext || playerContext.kind !== "series" || playerContext.ticketExpired) return;
  const data = dailyKid();
  const ticket = data.tickets[playerContext.ticketId];
  if (!ticket) return;

  ticket.usedSeconds = Math.min(
    ticketTotalSeconds(ticket),
    Math.max(0, Number(ticket.usedSeconds || 0) + Math.max(0, seconds))
  );
  updateProgressVisuals(playerContext.ticketId, ticket);

  const now = Date.now();
  if (now - lastUsageSave > 2500) {
    lastUsageSave = now;
    saveState();
  }

  if (ticketRemainingSeconds(ticket) <= 0.05) handleTicketExpired();
}

function startUsageTracker() {
  if (!playerContext || playerContext.kind !== "series" || playerContext.ticketExpired || usageTimer) return;
  lastPlayerSecond = null;

  usageTimer = setInterval(() => {
    if (!youtubePlayer?.getCurrentTime) return;
    let current;
    try {
      current = Number(youtubePlayer.getCurrentTime());
    } catch {
      return;
    }
    if (!Number.isFinite(current)) return;

    if (lastPlayerSecond !== null) {
      const delta = current - lastPlayerSecond;
      if (delta > 0 && delta < 2.5) consumePlayback(delta);
    }
    lastPlayerSecond = current;
  }, 500);
}

function onPlayerStateChange(event) {
  if (!window.YT) return;
  if (event.data === YT.PlayerState.PLAYING) {
    startUsageTracker();
  } else {
    stopUsageTracker();
    if (event.data === YT.PlayerState.ENDED) {
      setTimeout(() => closePlayer(), 450);
    }
  }
}

async function play(kind, id) {
  let item;
  let ticket = null;
  let ticketId = "";

  if (kind === "series") {
    const series = state.series.find(entry => entry.id === activeSeriesId);
    item = series?.episodes.find(episode => episode.id === id);
    const data = dailyKid();
    ticketId = data.activeTicketId;
    ticket = data.tickets[ticketId];

    if (!ticket || ticketRemainingSeconds(ticket) <= 0.5) {
      data.activeTicketId = null;
      view = "tickets";
      sounds.play("error");
      return render();
    }

    state.history.push({
      kidId: selectedKid.id,
      seriesId: series.id,
      episodeId: item?.id,
      youtubeId: item?.youtubeId,
      at: new Date().toISOString()
    });
    state.history = state.history.slice(-1000);
    playerContext = { kind, ticketId, returnView: "episodes", ticketExpired: false };
  } else {
    item = state.music.find(entry => entry.id === id);
    playerContext = { kind, returnView: "music", ticketExpired: false };
  }

  if (!item) return sounds.play("error");

  stopUsageTracker({ save: false });
  saveState();
  sounds.play("open");
  document.body.insertAdjacentHTML("beforeend", playerOverlay(item, ticket, ticketId));
  bind();

  try {
    await Promise.race([
      youtubeReady,
      new Promise((_, reject) => setTimeout(() => reject(new Error("YouTube API timeout")), 10000))
    ]);
    if (!$("#youtubePlayer")) return;

    youtubePlayer = new YT.Player("youtubePlayer", {
      host: "https://www.youtube-nocookie.com",
      videoId: item.youtubeId,
      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        iv_load_policy: 3
      },
      events: {
        onReady: event => event.target.playVideo(),
        onStateChange: onPlayerStateChange,
        onError: () => {
          sounds.play("error");
          toast("Video konnte nicht geöffnet werden");
        }
      }
    });
  } catch (error) {
    console.error(error);
    $(".video-player")?.remove();
    playerContext = null;
    sounds.play("error");
    toast("Video konnte nicht geöffnet werden");
  }
}

function closePlayer() {
  stopUsageTracker();

  try {
    youtubePlayer?.pauseVideo?.();
    youtubePlayer?.destroy?.();
  } catch {}
  youtubePlayer = null;
  $(".video-player")?.remove();

  if (playerContext?.kind === "series") {
    const data = dailyKid();
    const ticket = data.tickets[playerContext.ticketId];
    if (!ticket || ticketRemainingSeconds(ticket) <= 0.5) {
      data.activeTicketId = null;
      view = "tickets";
    } else {
      view = playerContext.returnView;
    }
  } else if (playerContext?.kind === "music") {
    view = "music";
  }

  playerContext = null;
  sounds.play("tap");
  render();
}

function saveContent() {
  const kind = $("#editKind")?.value;
  const id = $("#contentId")?.value;
  const title = $("#contentTitle")?.value.trim();
  const emoji = $("#contentEmoji")?.value.trim() || (kind === "series" ? "🎬" : "🎵");
  const source = $("#contentSource")?.value.trim();
  const url = $("#contentUrl")?.value.trim();
  const idFromUrl = youtubeId(url);

  if (!title) return toast("Titel fehlt");

  const allVideos = new Set([
    ...state.series.flatMap(series => series.episodes.map(episode => episode.youtubeId)),
    ...state.music.map(item => item.youtubeId)
  ]);

  if (kind === "music") {
    if (!idFromUrl) return toast("YouTube-Link fehlt");
    const duplicate = [...state.music, ...state.series.flatMap(series => series.episodes)]
      .some(item => item.youtubeId === idFromUrl && item.id !== id);
    if (duplicate) return toast("Video ist schon vorhanden");

    let item = state.music.find(entry => entry.id === id);
    if (!item) {
      item = { id: uid("music"), title, artist: source || "", emoji, youtubeId: idFromUrl };
      state.music.push(item);
    } else {
      item.title = title;
      item.artist = source || "";
      item.emoji = emoji;
      item.youtubeId = idFromUrl;
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
      if (!idFromUrl) return toast("YouTube-Link nicht erkannt");
      if (allVideos.has(idFromUrl)) return toast("Video ist schon vorhanden");
      series.episodes.push({
        id: uid("episode"),
        title: $("#episodeTitle")?.value.trim() || "Folge",
        youtubeId: idFromUrl
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

function saveReward() {
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

function saveSettings() {
  const pin = $("#settingPin")?.value.trim();
  if (!/^\d{4,8}$/.test(pin)) return toast("PIN: 4 bis 8 Ziffern");

  state.pin = pin;
  state.settings.treasureEnabled = $("#settingTreasure")?.checked ?? true;
  state.settings.childLabels = $("#settingLabels")?.checked ?? true;
  state.settings.voiceLabels = $("#settingVoice")?.checked ?? false;
  state.settings.smartSort = $("#settingSmart")?.checked ?? true;
  state.settings.finishEpisode = $("#settingFinishEpisode")?.checked ?? true;
  state.settings.sounds = $("#settingSounds")?.checked ?? true;
  state.settings.volume = Number($("#settingVolume")?.value ?? 0.7);

  sounds.play("done");
  saveState();
  toast("Gespeichert");
  render();
}

function exportBackup() {
  const bundle = {
    app: "Bärenhaus",
    version: VERSION,
    exportedAt: new Date().toISOString(),
    state
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Baerenhaus-Backup-${todayKey()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  sounds.play("done");
}

async function importBackup() {
  const file = $("#backupFile")?.files?.[0];
  if (!file) return toast("Backup-Datei auswählen");
  try {
    const parsed = JSON.parse(await file.text());
    state = normalize(parsed.state || parsed);
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

function resetApp() {
  if (!confirm("Bärenhaus wirklich zurücksetzen?")) return;
  localStorage.removeItem(KEY);
  state = baseState();
  selectedKid = null;
  view = "profiles";
  modal = null;
  sounds.play("done");
  render();
}


document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopUsageTracker();
    try { youtubePlayer?.pauseVideo?.(); } catch {}
  }
});

window.addEventListener("error", event => {
  console.error(event.error || event.message);
  toast("🐻");
});

window.addEventListener("unhandledrejection", event => {
  console.error(event.reason);
  toast("🐻");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js?v=120").catch(console.warn));
}

render();
