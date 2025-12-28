/**
 * Garten - Context-aware theming
 */

const CONFIG = {
  time: {
    dawn:      '#e8a87c', // Soft coral - first light on the horizon
    morning:   '#f5a623', // Warm gold - energising daylight
    afternoon: '#ff6b35', // Bold orange - peak productivity
    evening:   '#d35f8d', // Dusky pink - winding down
    night:     '#7c6aef'  // Deep purple - contemplative darkness
  },

  season: {
    spring: '#4ade80', // Fresh green - new growth
    summer: '#fbbf24', // Warm amber - long sunny days
    autumn: '#f97316', // Burnt orange - falling leaves
    winter: '#94a3b8'  // Cool slate - bare branches, grey skies
  },

  // Special days - UK focused
  events: [
    // New Year - gold for champagne and celebration
    { start: '01-01', end: '01-01', accent: '#ffd700' },

    // Burns Night - Scottish saltire blue
    { start: '01-25', end: '01-25', accent: '#0065bd' },

    // Lunar New Year - lucky red, prosperity
    { start: '01-29', end: '01-29', accent: '#de2910' },

    // Valentine's Day - romantic pink
    { start: '02-14', end: '02-14', accent: '#e91e63' },

    // St David's Day - yellow for the daffodil, Welsh national flower
    { start: '03-01', end: '03-01', accent: '#ffcc00' },

    // International Women's Day - purple, the official IWD colour
    { start: '03-08', end: '03-08', accent: '#7b1fa2' },

    // Commonwealth Day - royal blue from the Commonwealth flag
    { start: '03-10', end: '03-10', accent: '#00247d' },

    // Ramadan - Islamic green, peace and paradise
    { start: '03-10', end: '04-09', accent: '#1b5e20' },

    // St Patrick's Day - shamrock green
    { start: '03-17', end: '03-17', accent: '#009a44' },

    // Holi - vibrant orange, the colours thrown in celebration
    { start: '03-25', end: '03-25', accent: '#ff6f00' },

    // Easter - liturgical purple for Lent and resurrection
    { start: '03-29', end: '04-21', accent: '#ab47bc' },

    // Vaisakhi - Khalsa saffron, Sikh faith
    { start: '04-14', end: '04-14', accent: '#ff9800' },

    // St George's Day - red from the cross of St George
    { start: '04-23', end: '04-23', accent: '#cf142b' },

    // May Day - workers' movement red, solidarity
    { start: '05-01', end: '05-01', accent: '#d32f2f' },

    // Coronation Day - royal purple, monarchy
    { start: '05-06', end: '05-06', accent: '#9c27b0' },

    // VE Day - allied blue, victory
    { start: '05-08', end: '05-08', accent: '#1565c0' },

    // Pride Month - red starts the rainbow flag
    { start: '06-01', end: '06-30', accent: '#e53935', gradient: ['#e53935','#ff9800','#ffeb3b','#4caf50','#2196f3','#9c27b0'] },

    // Eid al-Adha - Islamic green
    { start: '06-16', end: '06-17', accent: '#2e7d32' },

    // Windrush Day - Caribbean gold, warmth and heritage
    { start: '06-22', end: '06-22', accent: '#ffab00' },

    // Armed Forces Day - military navy
    { start: '06-29', end: '06-29', accent: '#1a237e' },

    // NHS Birthday - official NHS blue
    { start: '07-05', end: '07-05', accent: '#0072ce' },

    // South Asian Heritage Month - saffron, shared across the subcontinent
    { start: '07-18', end: '08-17', accent: '#e65100' },

    // Notting Hill Carnival - Caribbean orange, energy and movement
    { start: '08-24', end: '08-26', accent: '#ff6f00' },

    // Onam - harvest gold, Kerala's floral abundance
    { start: '09-05', end: '09-05', accent: '#ffc107' },

    // Black History Month UK - gold from the Pan-African colours
    { start: '10-01', end: '10-31', accent: '#e4b61a' },

    // Rosh Hashanah - blue, Torah scrolls and tallitot
    { start: '10-02', end: '10-04', accent: '#1976d2' },

    // Yom Kippur - white for purity and atonement
    { start: '10-11', end: '10-12', accent: '#f5f5f5' },

    // Diwali - lamp orange, festival of lights
    { start: '11-01', end: '11-01', accent: '#ff9800' },

    // Bonfire Night - fire orange, flames and sparklers
    { start: '11-05', end: '11-05', accent: '#ff5722' },

    // Remembrance - poppy red
    { start: '11-09', end: '11-11', accent: '#b71c1c' },

    // St Andrew's Day - Scottish saltire blue
    { start: '11-30', end: '11-30', accent: '#0065bd' },

    // Hanukkah - blue, the Star of David
    { start: '12-25', end: '01-02', accent: '#1976d2' },

    // Christmas Eve - evergreen, holly and pine
    { start: '12-24', end: '12-24', accent: '#2e7d32' },

    // Christmas Day - traditional red, warmth and cheer
    { start: '12-25', end: '12-25', accent: '#c62828' },

    // Boxing Day - calm blue, post-celebration rest
    { start: '12-26', end: '12-26', accent: '#1565c0' },

    // New Year's Eve - gold for celebration and hope
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
    return mmdd >= e.start || mmdd <= e.end;
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
