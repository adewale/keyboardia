# Oshineye Garten Config

UK-focused configuration for [Garten](https://github.com/adewale/garten).

## Usage

```javascript
import { Garten } from 'garten';
import { getConfig } from './oshineye';

const garden = new Garten(getConfig('#garden'));
```

Or just the accent:

```javascript
import { Garten } from 'garten';
import { getAccent } from './oshineye';

const garden = new Garten({
  container: '#garden',
  colors: { accent: getAccent() }
});
```

## API

- `getAccent()` — Returns accent colour based on time of day, or special event
- `getSeasonAccent()` — Returns season colour
- `getConfig(container)` — Returns full Garten config object
