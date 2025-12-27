# Garten

Context-aware theming with special day overrides.

## Install

```html
<link rel="stylesheet" href="garten.css">
<script type="module">
  import Garten from './garten.js';
  const { mood } = Garten.init();
  document.querySelector('.garten-badge').textContent = mood;
</script>
```

## Footer Badge

```html
<footer>
  <span class="garten-badge"></span>
</footer>
```

## Variables

| Variable | Use |
|----------|-----|
| `--garten-accent` | Primary accent (time-based, or event override) |
| `--garten-season` | Season color |
| `--garten-gradient` | Rainbow gradient (Pride month) |

## Configuration

Edit `CONFIG` in `garten.ts`:

- `time` - Accent colors for dawn/morning/afternoon/evening/night
- `season` - Accent colors for spring/summer/autumn/winter
- `events` - Special days that override the base accent

## Adding Events

```javascript
{ id: 'event-id', start: 'MM-DD', end: 'MM-DD', accent: '#hex', name: 'Display Name' }
```
