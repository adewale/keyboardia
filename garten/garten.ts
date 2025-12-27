/**
 * Garten - Blended Context Theming
 * A simple, framework-agnostic theming system that blends multiple contexts.
 *
 * Layers (bottom to top):
 *   1. Time of Day (base palette)
 *   2. Season (color modifier)
 *   3. Device/Performance (adjustments)
 *   4. Geographic (preferences)
 *   5. Cultural Events (overlay)
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TimeOfDay = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type DeviceProfile = 'full' | 'reduced' | 'minimal';

export interface Palette {
  bg: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  accent: string;
  accentMuted: string;
  text: string;
  textMuted: string;
}

export interface ComputedTheme extends Palette {
  // Overlay additions
  accentSecondary?: string;
  accentTertiary?: string;
  gradient?: string[];

  // Effects
  glowOpacity: number;
  animationScale: number;

  // Metadata
  mood: string;
  activeEvent?: string;
}

export interface CulturalEvent {
  id: string;
  name: string;
  start: string;  // MM-DD
  end: string;    // MM-DD
  regions?: string[];
  accent?: string;
  accentSecondary?: string;
  accentTertiary?: string;
  gradient?: string[];
  glowBoost?: number;
}

export interface GartenConfig {
  respectReducedMotion?: boolean;
  respectDarkMode?: boolean;
  hemisphere?: 'north' | 'south';
  region?: string;
  overrideTime?: TimeOfDay;
  overrideSeason?: Season;
  culturalEvents?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1: TIME OF DAY
// ═══════════════════════════════════════════════════════════════════════════

const TIME_PALETTES: Record<TimeOfDay, Palette & { mood: string }> = {
  dawn: {
    bg: '#12101a',
    surface: '#1a1824',
    surfaceElevated: '#24202e',
    border: '#3a3548',
    accent: '#e8a87c',
    accentMuted: '#c4896a',
    text: 'rgba(255,255,255,0.9)',
    textMuted: 'rgba(255,255,255,0.5)',
    mood: 'awakening'
  },
  morning: {
    bg: '#141414',
    surface: '#1c1c1c',
    surfaceElevated: '#262626',
    border: '#3a3a3a',
    accent: '#f5a623',
    accentMuted: '#d4912a',
    text: 'rgba(255,255,255,0.9)',
    textMuted: 'rgba(255,255,255,0.55)',
    mood: 'energetic'
  },
  afternoon: {
    bg: '#121212',
    surface: '#1e1e1e',
    surfaceElevated: '#2a2a2a',
    border: '#3a3a3a',
    accent: '#ff6b35',
    accentMuted: '#e85a30',
    text: 'rgba(255,255,255,0.87)',
    textMuted: 'rgba(255,255,255,0.5)',
    mood: 'focused'
  },
  evening: {
    bg: '#100e18',
    surface: '#1a1722',
    surfaceElevated: '#24202c',
    border: '#3a3548',
    accent: '#d35f8d',
    accentMuted: '#b54f78',
    text: 'rgba(255,255,255,0.85)',
    textMuted: 'rgba(255,255,255,0.48)',
    mood: 'reflective'
  },
  night: {
    bg: '#0a0a0f',
    surface: '#121218',
    surfaceElevated: '#1a1a22',
    border: '#2a2a35',
    accent: '#7c6aef',
    accentMuted: '#6858c9',
    text: 'rgba(255,255,255,0.82)',
    textMuted: 'rgba(255,255,255,0.45)',
    mood: 'contemplative'
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2: SEASON MODIFIERS
// ═══════════════════════════════════════════════════════════════════════════

interface SeasonModifier {
  hueShift: number;      // degrees
  saturation: number;    // multiplier
  warmth: number;        // -1 (cool) to 1 (warm)
  mood: string;
}

const SEASON_MODIFIERS: Record<Season, SeasonModifier> = {
  spring: { hueShift: -10, saturation: 1.1, warmth: 0.2, mood: 'fresh' },
  summer: { hueShift: 5, saturation: 1.15, warmth: 0.4, mood: 'vibrant' },
  autumn: { hueShift: 15, saturation: 0.95, warmth: 0.6, mood: 'warm' },
  winter: { hueShift: -15, saturation: 0.85, warmth: -0.3, mood: 'crisp' }
};

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3: DEVICE/PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════

interface DeviceAdjustment {
  glowOpacity: number;
  animationScale: number;
}

const DEVICE_ADJUSTMENTS: Record<DeviceProfile, DeviceAdjustment> = {
  full: { glowOpacity: 0.6, animationScale: 1 },
  reduced: { glowOpacity: 0.3, animationScale: 0.5 },
  minimal: { glowOpacity: 0, animationScale: 0 }
};

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 5: CULTURAL EVENTS
// ═══════════════════════════════════════════════════════════════════════════

const CULTURAL_EVENTS: CulturalEvent[] = [
  // Global celebrations
  {
    id: 'new-year',
    name: 'New Year',
    start: '12-31',
    end: '01-02',
    accent: '#ffd700',
    accentSecondary: '#c0c0c0',
    glowBoost: 1.3
  },

  // Pride Month
  {
    id: 'pride',
    name: 'Pride Month',
    start: '06-01',
    end: '06-30',
    gradient: ['#e53935', '#ff9800', '#ffeb3b', '#4caf50', '#2196f3', '#9c27b0']
  },

  // Lunar New Year (approximate window)
  {
    id: 'lunar-new-year',
    name: 'Lunar New Year',
    start: '01-21',
    end: '02-10',
    regions: ['asia', 'east-asia'],
    accent: '#de2910',
    accentSecondary: '#ffd700',
    glowBoost: 1.4
  },

  // Diwali (approximate window - varies yearly)
  {
    id: 'diwali',
    name: 'Diwali',
    start: '10-20',
    end: '11-05',
    regions: ['south-asia', 'asia'],
    accent: '#ff9800',
    accentSecondary: '#ffc107',
    accentTertiary: '#d84315',
    glowBoost: 1.5
  },

  // Black History Month
  {
    id: 'black-history-month',
    name: 'Black History Month',
    start: '02-01',
    end: '02-28',
    regions: ['americas', 'north-america'],
    accent: '#ffd700',
    accentSecondary: '#2e7d32',
    accentTertiary: '#c62828'
  },

  // Juneteenth
  {
    id: 'juneteenth',
    name: 'Juneteenth',
    start: '06-19',
    end: '06-20',
    regions: ['americas', 'north-america'],
    accent: '#c62828',
    accentSecondary: '#1565c0'
  },

  // Hispanic Heritage Month
  {
    id: 'hispanic-heritage',
    name: 'Hispanic Heritage Month',
    start: '09-15',
    end: '10-15',
    regions: ['americas'],
    accent: '#ff5722',
    accentSecondary: '#4caf50',
    accentTertiary: '#f44336'
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function detectTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function detectSeason(hemisphere: 'north' | 'south' = 'north'): Season {
  const month = new Date().getMonth(); // 0-11
  const seasons: Season[] = hemisphere === 'north'
    ? ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter']
    : ['summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer'];
  return seasons[month];
}

function detectDeviceProfile(): DeviceProfile {
  if (typeof window === 'undefined') return 'full';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return 'minimal';

  // Check for low-power indicators
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const isSlowConnection = (navigator as any).connection?.effectiveType === '2g';

  if (isMobile || isSlowConnection) return 'reduced';

  return 'full';
}

function detectRegion(): string | undefined {
  if (typeof Intl === 'undefined') return undefined;

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Simple region mapping from timezone
    if (tz.startsWith('America/')) return 'americas';
    if (tz.startsWith('Europe/')) return 'europe';
    if (tz.startsWith('Asia/')) return 'asia';
    if (tz.startsWith('Africa/')) return 'africa';
    if (tz.startsWith('Australia/') || tz.startsWith('Pacific/')) return 'oceania';

    return undefined;
  } catch {
    return undefined;
  }
}

function getActiveEvents(region?: string): CulturalEvent[] {
  const now = new Date();
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return CULTURAL_EVENTS.filter(event => {
    // Check date range (handles year wrap for New Year)
    const inRange = event.start <= event.end
      ? mmdd >= event.start && mmdd <= event.end
      : mmdd >= event.start || mmdd <= event.end;

    if (!inRange) return false;

    // Check region if specified
    if (event.regions && region) {
      return event.regions.some(r => region.includes(r) || r.includes(region));
    }

    // Global event or no region filter
    return !event.regions;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// COLOR UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function applySeasonToColor(hex: string, modifier: SeasonModifier): string {
  if (hex.startsWith('rgba')) return hex; // Skip rgba colors

  const { h, s, l } = hexToHSL(hex);
  return hslToHex(
    h + modifier.hueShift,
    s * modifier.saturation,
    l + modifier.warmth * 0.02
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BLENDING ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export function blend(config: GartenConfig = {}): ComputedTheme {
  // Layer 1: Time of Day (base)
  const time = config.overrideTime ?? detectTimeOfDay();
  const basePalette = TIME_PALETTES[time];

  // Layer 2: Season modifier
  const hemisphere = config.hemisphere ?? 'north';
  const season = config.overrideSeason ?? detectSeason(hemisphere);
  const seasonMod = SEASON_MODIFIERS[season];

  // Layer 3: Device profile
  const device = detectDeviceProfile();
  const deviceAdj = DEVICE_ADJUSTMENTS[
    config.respectReducedMotion === false ? 'full' : device
  ];

  // Layer 4: Region (for event filtering)
  const region = config.region ?? detectRegion();

  // Apply season modifier to base palette
  const seasonedPalette: Palette = {
    bg: basePalette.bg,
    surface: basePalette.surface,
    surfaceElevated: basePalette.surfaceElevated,
    border: basePalette.border,
    accent: applySeasonToColor(basePalette.accent, seasonMod),
    accentMuted: applySeasonToColor(basePalette.accentMuted, seasonMod),
    text: basePalette.text,
    textMuted: basePalette.textMuted
  };

  // Start building computed theme
  let theme: ComputedTheme = {
    ...seasonedPalette,
    glowOpacity: deviceAdj.glowOpacity,
    animationScale: deviceAdj.animationScale,
    mood: `${basePalette.mood}-${seasonMod.mood}`
  };

  // Layer 5: Cultural event overlay
  if (config.culturalEvents !== false) {
    const events = getActiveEvents(region);
    if (events.length > 0) {
      const event = events[0]; // Primary event takes precedence
      theme = {
        ...theme,
        accent: event.accent ?? theme.accent,
        accentSecondary: event.accentSecondary,
        accentTertiary: event.accentTertiary,
        gradient: event.gradient,
        glowOpacity: theme.glowOpacity * (event.glowBoost ?? 1),
        activeEvent: event.name
      };
    }
  }

  return theme;
}

// ═══════════════════════════════════════════════════════════════════════════
// CSS APPLICATION
// ═══════════════════════════════════════════════════════════════════════════

export function applyTheme(theme: ComputedTheme, root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--garten-bg': theme.bg,
    '--garten-surface': theme.surface,
    '--garten-surface-elevated': theme.surfaceElevated,
    '--garten-border': theme.border,
    '--garten-accent': theme.accent,
    '--garten-accent-muted': theme.accentMuted,
    '--garten-text': theme.text,
    '--garten-text-muted': theme.textMuted,
    '--garten-glow-opacity': String(theme.glowOpacity),
    '--garten-animation-scale': String(theme.animationScale),
    '--garten-transition': `${0.3 * theme.animationScale}s ease`
  };

  if (theme.accentSecondary) {
    vars['--garten-accent-secondary'] = theme.accentSecondary;
  }
  if (theme.accentTertiary) {
    vars['--garten-accent-tertiary'] = theme.accentTertiary;
  }
  if (theme.gradient) {
    vars['--garten-gradient'] = `linear-gradient(90deg, ${theme.gradient.join(', ')})`;
  }

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  // Set data attributes for CSS selectors
  root.dataset.gartenMood = theme.mood;
  if (theme.activeEvent) {
    root.dataset.gartenEvent = theme.activeEvent;
  } else {
    delete root.dataset.gartenEvent;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN API
// ═══════════════════════════════════════════════════════════════════════════

let updateInterval: ReturnType<typeof setInterval> | null = null;

export function init(config: GartenConfig = {}): ComputedTheme {
  const theme = blend(config);
  applyTheme(theme);

  // Auto-update every 5 minutes for time changes
  if (typeof window !== 'undefined' && !updateInterval) {
    updateInterval = setInterval(() => {
      const newTheme = blend(config);
      applyTheme(newTheme);
    }, 5 * 60 * 1000);
  }

  return theme;
}

export function update(config: GartenConfig = {}): ComputedTheme {
  const theme = blend(config);
  applyTheme(theme);
  return theme;
}

export function stop(): void {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

// Export detection helpers for manual use
export const detect = {
  timeOfDay: detectTimeOfDay,
  season: detectSeason,
  device: detectDeviceProfile,
  region: detectRegion,
  activeEvents: getActiveEvents
};

// Default export for simple usage
export default { init, update, stop, blend, applyTheme, detect };
