# Garten

Blended context theming that adapts to time, season, device, location, and cultural events.

## Quick Start

```html
<link rel="stylesheet" href="garten.css">
<script type="module">
  import Garten from './garten.js';
  Garten.init();
</script>
```

## Usage

```javascript
import Garten from './garten.js';

// Auto-detect everything
Garten.init();

// With configuration
Garten.init({
  hemisphere: 'south',           // For correct seasons
  region: 'asia',                // For cultural events
  respectReducedMotion: true,    // Honor prefers-reduced-motion
  culturalEvents: true           // Enable event overlays
});

// Manual override for testing
Garten.init({
  overrideTime: 'night',
  overrideSeason: 'winter'
});

// Update later (e.g., user changes region)
Garten.update({ region: 'europe' });

// Stop auto-updates
Garten.stop();
```

## CSS Variables

After `init()`, these variables are available:

| Variable | Description |
|----------|-------------|
| `--garten-bg` | Page background |
| `--garten-surface` | Card/panel background |
| `--garten-surface-elevated` | Elevated elements |
| `--garten-border` | Border color |
| `--garten-accent` | Primary accent |
| `--garten-accent-muted` | Subdued accent |
| `--garten-accent-secondary` | Secondary accent (events only) |
| `--garten-accent-tertiary` | Tertiary accent (events only) |
| `--garten-gradient` | Gradient (Pride month, etc.) |
| `--garten-text` | Primary text |
| `--garten-text-muted` | Muted text |
| `--garten-glow-opacity` | For box-shadow effects |
| `--garten-animation-scale` | Multiply transition durations |
| `--garten-transition` | Pre-computed transition value |

## Data Attributes

Set on `<html>`:

- `data-garten-mood` - e.g., "focused-warm", "contemplative-crisp"
- `data-garten-event` - Active cultural event name (if any)

## Detection Helpers

```javascript
import { detect } from './garten.js';

detect.timeOfDay();     // 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night'
detect.season('north'); // 'spring' | 'summer' | 'autumn' | 'winter'
detect.device();        // 'full' | 'reduced' | 'minimal'
detect.region();        // 'americas' | 'europe' | 'asia' | etc.
detect.activeEvents();  // Array of current cultural events
```

## Layers

1. **Time of Day** (base) - Dawn coral, morning gold, afternoon orange, evening pink, night purple
2. **Season** (modifier) - Shifts hue/saturation: spring fresh, summer vibrant, autumn warm, winter crisp
3. **Device** (adjustment) - Reduces glow/animation for mobile, respects reduced-motion
4. **Region** (preference) - Filters which cultural events apply
5. **Cultural Events** (overlay) - Accent overrides for celebrations

## Adding Cultural Events

```javascript
// In garten.ts, add to CULTURAL_EVENTS array:
{
  id: 'your-event',
  name: 'Your Event',
  start: '03-15',        // MM-DD
  end: '03-21',
  regions: ['europe'],   // Optional: limit by region
  accent: '#ff0000',     // Override accent
  accentSecondary: '#00ff00',
  glowBoost: 1.2         // Optional: extra glow
}
```
