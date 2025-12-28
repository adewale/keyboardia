/**
 * Garten - Context-aware theming
 *
 * A minimal theming engine. Provide your own configuration.
 */

export interface GartenConfig {
  time: Record<string, string>;
  season: Record<string, string>;
  events: Array<{
    start: string;
    end: string;
    accent: string;
    gradient?: string[];
  }>;
}

export interface GartenOptions {
  southern?: boolean;
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

function getSeason(southern = false): string {
  const m = new Date().getMonth();
  const seasons = ['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter'];
  const s = seasons[m];
  if (southern) return { winter:'summer', summer:'winter', spring:'autumn', autumn:'spring' }[s]!;
  return s;
}

function getEvent(events: GartenConfig['events']) {
  const now = new Date();
  const mmdd = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return events.find(e => {
    if (e.start <= e.end) return mmdd >= e.start && mmdd <= e.end;
    return mmdd >= e.start || mmdd <= e.end;
  });
}

export function init(config: GartenConfig, options: GartenOptions = {}) {
  const timeKey = getTimeOfDay();
  const seasonKey = getSeason(options.southern);

  const time = config.time[timeKey] ?? config.time['afternoon'];
  const season = config.season[seasonKey] ?? config.season['autumn'];
  const event = getEvent(config.events);

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
