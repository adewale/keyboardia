/**
 * Garten - Context-aware theming
 * Simple configuration with special day overrides.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Base themes by time of day
  time: {
    dawn:      { accent: '#e8a87c', mood: 'awakening' },
    morning:   { accent: '#f5a623', mood: 'energetic' },
    afternoon: { accent: '#ff6b35', mood: 'focused' },
    evening:   { accent: '#d35f8d', mood: 'reflective' },
    night:     { accent: '#7c6aef', mood: 'contemplative' }
  },

  // Season adjustments
  season: {
    spring: { accent: '#4ade80', mood: 'fresh' },
    summer: { accent: '#fbbf24', mood: 'vibrant' },
    autumn: { accent: '#f97316', mood: 'warm' },
    winter: { accent: '#94a3b8', mood: 'crisp' }
  },

  // Special days (override everything)
  events: [
    { id: 'new-year',       start: '01-01', end: '01-01', accent: '#ffd700', name: 'New Year' },
    { id: 'mlk-day',        start: '01-20', end: '01-20', accent: '#1e88e5', name: 'MLK Day' },
    { id: 'lunar-new-year', start: '01-29', end: '01-29', accent: '#de2910', name: 'Lunar New Year' },
    { id: 'black-history',  start: '02-01', end: '02-28', accent: '#ffd700', name: 'Black History Month' },
    { id: 'pride',          start: '06-01', end: '06-30', accent: '#e53935', gradient: ['#e53935','#ff9800','#ffeb3b','#4caf50','#2196f3','#9c27b0'], name: 'Pride' },
    { id: 'juneteenth',     start: '06-19', end: '06-19', accent: '#c62828', name: 'Juneteenth' },
    { id: 'diwali',         start: '11-01', end: '11-01', accent: '#ff9800', name: 'Diwali' },
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

function getSeason(southern = false) {
  const m = new Date().getMonth();
  const seasons = ['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter'];
  const s = seasons[m];
  if (southern) return { winter:'summer', summer:'winter', spring:'autumn', autumn:'spring' }[s];
  return s;
}

function getEvent() {
  const now = new Date();
  const mmdd = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return CONFIG.events.find(e => mmdd >= e.start && mmdd <= e.end);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

export function init(options = {}) {
  const time = CONFIG.time[getTimeOfDay()];
  const season = CONFIG.season[getSeason(options.southern)];
  const event = getEvent();
  const reduced = prefersReducedMotion();

  // Event overrides base, otherwise use time-based accent
  const accent = event?.accent ?? time.accent;
  const mood = event?.name ?? `${time.mood}`;

  // Apply CSS variables
  const root = document.documentElement;
  root.style.setProperty('--garten-accent', accent);
  root.style.setProperty('--garten-season', season.accent);
  root.style.setProperty('--garten-transition', reduced ? '0s' : '0.3s');
  root.dataset.gartenMood = mood;

  if (event?.gradient) {
    root.style.setProperty('--garten-gradient', `linear-gradient(90deg, ${event.gradient.join(',')})`);
  }

  return { accent, mood, event: event?.name, season: season.mood };
}

export default { init, getTimeOfDay, getSeason, getEvent };
