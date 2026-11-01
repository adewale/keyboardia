import { PNG } from 'pngjs';

export function comparePngs(beforeBuffer, afterBuffer, { maxChannelDelta = 6 } = {}) {
  const before = PNG.sync.read(beforeBuffer);
  const after = PNG.sync.read(afterBuffer);
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const diff = new PNG({ width, height });
  let differentPixels = 0;
  let rawDifferentPixels = 0;
  let maxObservedChannelDelta = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const diffIndex = (width * y + x) << 2;
      const beforeInBounds = x < before.width && y < before.height;
      const afterInBounds = x < after.width && y < after.height;
      const beforeIndex = beforeInBounds ? (before.width * y + x) << 2 : -1;
      const afterIndex = afterInBounds ? (after.width * y + x) << 2 : -1;
      const channelDeltas = beforeInBounds && afterInBounds
        ? [0, 1, 2, 3].map((channel) => (
          Math.abs(before.data[beforeIndex + channel] - after.data[afterIndex + channel])
        ))
        : [255];
      const observedDelta = Math.max(...channelDeltas);
      const rawEqual = observedDelta === 0;
      const equal = beforeInBounds && afterInBounds && observedDelta <= maxChannelDelta;
      if (!rawEqual) rawDifferentPixels += 1;
      maxObservedChannelDelta = Math.max(maxObservedChannelDelta, observedDelta);

      if (equal) {
        const grey = Math.round(
          before.data[beforeIndex] * 0.21
          + before.data[beforeIndex + 1] * 0.72
          + before.data[beforeIndex + 2] * 0.07,
        );
        diff.data[diffIndex] = grey;
        diff.data[diffIndex + 1] = grey;
        diff.data[diffIndex + 2] = grey;
        diff.data[diffIndex + 3] = 90;
      } else {
        differentPixels += 1;
        diff.data[diffIndex] = 255;
        diff.data[diffIndex + 1] = 0;
        diff.data[diffIndex + 2] = 64;
        diff.data[diffIndex + 3] = 255;
      }
    }
  }

  return {
    equal: differentPixels === 0,
    differentPixels,
    rawDifferentPixels,
    maxObservedChannelDelta,
    maxChannelDelta,
    beforeSize: { width: before.width, height: before.height },
    afterSize: { width: after.width, height: after.height },
    diff: PNG.sync.write(diff),
  };
}
