/**
 * Garten - Context-aware theming
 */

const CONFIG = {
  time: {
    dawn:      '#e8a87c',
    morning:   '#f5a623',
    afternoon: '#ff6b35',
    evening:   '#d35f8d',
    night:     '#7c6aef'
  },

  season: {
    spring: '#4ade80',
    summer: '#fbbf24',
    autumn: '#f97316',
    winter: '#94a3b8'
  },

  // Special days - UK focused
  events: [
    // New Year
    { start: '01-01', end: '01-01', accent: '#ffd700' },

    // Burns Night
    { start: '01-25', end: '01-25', accent: '#0065bd' },

    // Lunar New Year (approximate)
    { start: '01-29', end: '01-29', accent: '#de2910' },

    // Black History Month UK (October)
    { start: '10-01', end: '10-31', accent: '#e4b61a' },

    // Valentine's Day
    { start: '02-14', end: '02-14', accent: '#e91e63' },

    // St David's Day
    { start: '03-01', end: '03-01', accent: '#ffcc00' },

    // International Women's Day
    { start: '03-08', end: '03-08', accent: '#7b1fa2' },

    // Commonwealth Day (second Monday March - approx)
    { start: '03-10', end: '03-10', accent: '#00247d' },

    // St Patrick's Day
    { start: '03-17', end: '03-17', accent: '#009a44' },

    // Holi (approximate)
    { start: '03-25', end: '03-25', accent: '#ff6f00' },

    // Easter (approximate range)
    { start: '03-29', end: '04-21', accent: '#ab47bc' },

    // Ramadan/Eid (approximate - moves yearly)
    { start: '03-10', end: '04-09', accent: '#1b5e20' },

    // St George's Day
    { start: '04-23', end: '04-23', accent: '#cf142b' },

    // Vaisakhi
    { start: '04-14', end: '04-14', accent: '#ff9800' },

    // Early May Bank Holiday / Workers Day
    { start: '05-01', end: '05-01', accent: '#d32f2f' },

    // Coronation Day
    { start: '05-06', end: '05-06', accent: '#9c27b0' },

    // VE Day
    { start: '05-08', end: '05-08', accent: '#1565c0' },

    // Windrush Day
    { start: '06-22', end: '06-22', accent: '#ffab00' },

    // Pride Month
    { start: '06-01', end: '06-30', accent: '#e53935', gradient: ['#e53935','#ff9800','#ffeb3b','#4caf50','#2196f3','#9c27b0'] },

    // Eid al-Adha (approximate - moves yearly)
    { start: '06-16', end: '06-17', accent: '#2e7d32' },

    // Armed Forces Day
    { start: '06-29', end: '06-29', accent: '#1a237e' },

    // NHS Birthday
    { start: '07-05', end: '07-05', accent: '#0072ce' },

    // Notting Hill Carnival (late August bank holiday weekend)
    { start: '08-24', end: '08-26', accent: '#ff6f00' },

    // South Asian Heritage Month
    { start: '07-18', end: '08-17', accent: '#e65100' },

    // Onam (approximate)
    { start: '09-05', end: '09-05', accent: '#ffc107' },

    // Rosh Hashanah (approximate)
    { start: '10-02', end: '10-04', accent: '#1976d2' },

    // Yom Kippur (approximate)
    { start: '10-11', end: '10-12', accent: '#f5f5f5' },

    // Diwali (approximate)
    { start: '11-01', end: '11-01', accent: '#ff9800' },

    // Bonfire Night
    { start: '11-05', end: '11-05', accent: '#ff5722' },

    // Remembrance Sunday (second Sunday November - approx)
    { start: '11-09', end: '11-11', accent: '#b71c1c' },

    // Armistice Day
    { start: '11-11', end: '11-11', accent: '#b71c1c' },

    // Hanukkah (approximate)
    { start: '12-25', end: '01-02', accent: '#1976d2' },

    // St Andrew's Day
    { start: '11-30', end: '11-30', accent: '#0065bd' },

    // Christmas Eve
    { start: '12-24', end: '12-24', accent: '#2e7d32' },

    // Christmas Day
    { start: '12-25', end: '12-25', accent: '#c62828' },

    // Boxing Day
    { start: '12-26', end: '12-26', accent: '#1565c0' },

    // New Year's Eve
    { start: '12-31', end: '12-31', accent: '#ffd700' },
  ]
};

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
  return CONFIG.events.find(e => {
    if (e.start <= e.end) return mmdd >= e.start && mmdd <= e.end;
    return mmdd >= e.start || mmdd <= e.end; // wraps year
  });
}

export function init(options: { southern?: boolean } = {}) {
  const time = CONFIG.time[getTimeOfDay()];
  const season = CONFIG.season[getSeason(options.southern)];
  const event = getEvent();

  const accent = event?.accent ?? time;

  const root = document.documentElement;
  root.style.setProperty('--garten-accent', accent);
  root.style.setProperty('--garten-season', season);

  if (event?.gradient) {
    root.style.setProperty('--garten-gradient', `linear-gradient(90deg, ${event.gradient.join(',')})`);
  } else {
    root.style.removeProperty('--garten-gradient');
  }
}

export default { init };
