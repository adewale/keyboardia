# Garten

Context-aware theming engine.

## Files

- `garten.ts` — Generic engine, accepts any configuration
- `oshineye.ts` — UK-focused configuration for Oshineye.dev

## Usage

```html
<script type="module">
  import Oshineye from './oshineye.js';
  Oshineye.init();
</script>
```

## Custom Configuration

```typescript
import Garten from './garten';

Garten.init({
  time: {
    dawn: '#...',
    morning: '#...',
    afternoon: '#...',
    evening: '#...',
    night: '#...'
  },
  season: {
    spring: '#...',
    summer: '#...',
    autumn: '#...',
    winter: '#...'
  },
  events: [
    { start: 'MM-DD', end: 'MM-DD', accent: '#...' },
    { start: 'MM-DD', end: 'MM-DD', accent: '#...', gradient: ['#...', '#...'] }
  ]
});
```

## Variables

- `--garten-accent` — Current accent colour
- `--garten-season` — Season colour
- `--garten-gradient` — Gradient (when event specifies one)
