/**
 * Example Sessions for Landing Page
 *
 * Real published sessions displayed on the landing page.
 * These are curated examples that showcase different musical styles.
 *
 * Environment-specific UUIDs:
 * - Production (keyboardia.dev): Original published sessions
 * - Staging (staging.keyboardia.dev): Synced copies with different UUIDs
 * - Local (localhost): Uses staging UUIDs
 *
 * @see /specs/LANDING-PAGE.md for full specification
 */

export interface ExampleTrack {
  steps: boolean[];
}

export interface ExampleSession {
  uuid: string;
  name: string;
  tempo: number;
  tracks: ExampleTrack[];
}

/**
 * Detect current environment based on hostname
 */
function getEnvironment(): 'production' | 'staging' | 'local' {
  if (typeof window === 'undefined') return 'production';
  const hostname = window.location.hostname;
  if (hostname === 'keyboardia.dev' || hostname === 'www.keyboardia.dev') {
    return 'production';
  }
  if (hostname === 'staging.keyboardia.dev') {
    return 'staging';
  }
  // Local dev, preview, or other environments use staging sessions
  return 'local';
}

/**
 * UUID mapping: production UUID -> staging UUID
 * Staging sessions are synced copies with different UUIDs.
 * Local dev uses staging UUIDs.
 */
const STAGING_UUIDS: Record<string, string> = {
  // Synced on 2026-01-01
  "568f178d-87b2-4113-a157-4b663de664c5": "d2de21b9-6f2d-4fbb-b599-d9f246ce345c", // Shaker Groove
  "5c38321b-0099-4a9f-9635-4bc7340a0b3c": "5c38321b-0099-4a9f-9635-4bc7340a0b3c", // Mellow Goodness (not synced - use prod)
  "dbccf0ef-2b44-4e3f-b4b0-b68000b49e92": "c4df4c6b-5d55-48c9-adbd-805707ecdd00", // Happy House Drone
  "44252151-1e6b-487f-8204-d2ce095b0e4b": "9518e2f5-5999-444d-8c0e-43388b5dc7d3", // Afrobeat
  "ef7e16e3-ccbf-4614-917f-789bedcb5ab1": "446f29e5-7766-4d78-b141-c04bdcc5653b", // Polyrhythm Demo
  "6500c5e5-8a0e-4770-ace0-6f3579e5ef16": "d8253430-d4ee-4ed6-88ec-8161804c8375", // Newscast
  "e508d514-a128-4243-b30b-92dfcd6c0049": "dd66c06f-4c1e-44d0-a21a-cc5ea2052666", // Dreamjangler
  "c888f863-788b-49e3-a718-dec97ec5a59c": "a1e2cdf7-e660-42e6-81fe-886e9b091647", // Kristian remix
  "a269324b-dc0a-4bcd-8cd8-e98c9030767b": "bf7f126f-2648-431c-b17d-3ee0778f936b", // Hi-Hat as Shaker
  "60d91fff-18e2-4389-87f3-7ce65c1ad67d": "db050ac3-fec1-4006-8deb-dcdae0fa21cc", // Garden State
  "2564c14a-b33a-471a-812d-e734d2299712": "6068d2a5-6e77-443c-af37-da3d2fbd46a0", // 808 Trap Beat
  "b94ca868-5d89-4a29-9055-397a7a267ded": "1cecb3d7-53ca-4f65-8a46-fdb5c6f1e767", // Acoustic Groove
  "8e66f0fc-f175-4d7a-b8a8-30a1519163ed": "9f1ded83-cdef-4c14-a5fc-8331d39e4c48", // Finger Bass Funk
  "2d67db66-81bc-4876-b28a-49b372ccc658": "2aac433d-7915-4905-bc65-7bcb0b220a72", // Legato Dreams
  "559d2476-2fa7-49c6-8aab-7e769a0f95cf": "07cde4a8-2c6a-4c1e-b605-b41e879dec2c", // 303 Slide
  "f77c71a7-53ad-4a8d-aaec-f00e1ad6eca0": "c2fb7b70-9641-4297-b398-9e86552859ca", // Smooth Rhodes
  "6fcf648c-a96c-4313-b2e4-289336647ed8": "78cb4949-6667-4a56-9312-d553dad6d8f3", // Vibes & Strings
  "c75ae807-00b5-4874-9d24-b968bf6c0abc": "68436f01-34de-440b-aad7-e2adc3c47e0b", // Orchestral Groove
  "83015acd-c53d-4c53-94ae-3df62e7acef1": "83015acd-c53d-4c53-94ae-3df62e7acef1", // Pentatonic Flow (not synced)
  "dcc33ea4-f42b-4379-9c8e-9eb4d669eb30": "9cc9fd9d-899c-4dec-8f65-1161fa7641d3", // Jazz Exploration
  "ddfa76ad-128f-4d13-ac90-36e2d3e365ff": "bca77978-054f-441b-86b8-4456aac03927", // Minor Key Feels
};

/**
 * Get UUID for current environment
 */
function getUuidForEnvironment(productionUuid: string): string {
  const env = getEnvironment();
  if (env === 'production') {
    return productionUuid;
  }
  // Staging and local use staging UUIDs (fallback to production if not mapped)
  return STAGING_UUIDS[productionUuid] || productionUuid;
}

/**
 * Curated example sessions with environment-aware UUIDs.
 * Production uses original UUIDs, staging/local use synced copies.
 */
export const EXAMPLE_SESSIONS: ExampleSession[] = [
  {
    uuid: getUuidForEnvironment("568f178d-87b2-4113-a157-4b663de664c5"),
    name: "Shaker Groove",
    tempo: 95,
    tracks: [
      {
        steps: [
          true,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
        ],
      },
      {
        steps: [
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
        ],
      },
      {
        steps: [
          false,
          true,
          false,
          false,
          true,
          false,
          false,
          true,
          false,
          false,
          true,
          false,
          false,
          true,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          false,
          false,
          true,
          false,
          false,
          true,
          false,
          true,
          false,
          false,
          true,
          false,
          false,
          true,
          false,
        ],
      },
    ],
  },
  {
    uuid: getUuidForEnvironment("5c38321b-0099-4a9f-9635-4bc7340a0b3c"),
    name: "Mellow Goodness",
    tempo: 96,
    tracks: [
      {
        steps: [
          false,
          false,
          false,
          true,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          true,
          false,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
      },
    ],
  },
  {
    uuid: getUuidForEnvironment("dbccf0ef-2b44-4e3f-b4b0-b68000b49e92"),
    name: "Happy House Drone",
    tempo: 120,
    tracks: [
      {
        steps: [
          false,
          true,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          true,
        ],
      },
      {
        steps: [
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          true,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          true,
        ],
      },
      {
        steps: [
          false,
          true,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          true,
        ],
      },
    ],
  },
  {
    uuid: getUuidForEnvironment("44252151-1e6b-487f-8204-d2ce095b0e4b"),
    name: "Afrobeat",
    tempo: 110,
    tracks: [
      {
        steps: [
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          false,
          false,
          true,
          false,
          true,
          true,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          true,
          true,
          true,
          false,
          true,
          true,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          false,
          false,
          true,
          false,
          true,
          false,
          false,
          true,
          false,
          false,
          true,
          false,
          false,
          true,
          false,
        ],
      },
    ],
  },
  {
    uuid: getUuidForEnvironment("ef7e16e3-ccbf-4614-917f-789bedcb5ab1"),
    name: "Polyrhythm Demo",
    tempo: 120,
    tracks: [
      {
        steps: [
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          false,
          true,
          false,
          true,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
    ],
  },
  {
    uuid: getUuidForEnvironment("6500c5e5-8a0e-4770-ace0-6f3579e5ef16"),
    name: "Newscast",
    tempo: 104,
    tracks: [
      {
        steps: [
          true,
          true,
          true,
          false,
          true,
          false,
          true,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          false,
          true,
          false,
          true,
          false,
          true,
          false,
          true,
          false,
          true,
          false,
          true,
          false,
          true,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
    ],
  },
  {
    uuid: getUuidForEnvironment("e508d514-a128-4243-b30b-92dfcd6c0049"),
    name: "Dreamjangler",
    tempo: 120,
    tracks: [
      {
        steps: [
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          true,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          true,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
    ],
  },
  {
    uuid: getUuidForEnvironment("c888f863-788b-49e3-a718-dec97ec5a59c"),
    name: "Kristian (remixed without permission)",
    tempo: 120,
    tracks: [
      {
        steps: [
          true,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
        ],
      },
      {
        steps: [
          true,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          true,
          true,
          false,
          false,
          false,
          true,
          true,
          false,
          false,
          false,
          false,
          true,
          true,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          true,
          true,
          false,
          false,
          false,
          true,
          true,
          false,
          false,
          false,
          false,
          true,
          true,
          false,
          false,
        ],
      },
    ],
  },
  {
    uuid: getUuidForEnvironment("a269324b-dc0a-4bcd-8cd8-e98c9030767b"),
    name: "Hi-Hat as Shaker",
    tempo: 120,
    tracks: [
      {
        steps: [
          true,
          false,
          false,
          true,
          false,
          false,
          false,
          true,
          false,
          false,
          true,
          true,
          false,
          false,
          true,
          false,
        ],
      },
      {
        steps: [
          false,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
    ],
  },
  {
    uuid: getUuidForEnvironment("60d91fff-18e2-4389-87f3-7ce65c1ad67d"),
    name: "Garden State",
    tempo: 120,
    tracks: [
      {
        steps: [
          false,
          false,
          false,
          false,
          false,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
        ],
      },
      {
        steps: [
          true,
          false,
          true,
          true,
          false,
          true,
          true,
          false,
          false,
          true,
          true,
          true,
          false,
          false,
          false,
          false,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          false,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
        ],
      },
      {
        steps: [
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
          false,
        ],
      },
    ],
  },
  // Phase 29A: Sampled Instruments demos
  {
    uuid: getUuidForEnvironment("2564c14a-b33a-471a-812d-e734d2299712"),
    name: "808 Trap Beat",
    tempo: 140,
    tracks: [
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, true, false] },
      { steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false] },
      { steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, true] },
      { steps: [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false] },
    ],
  },
  {
    uuid: getUuidForEnvironment("b94ca868-5d89-4a29-9055-397a7a267ded"),
    name: "Acoustic Groove",
    tempo: 100,
    tracks: [
      { steps: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false] },
      { steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false] },
      { steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false] },
      { steps: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
    ],
  },
  {
    uuid: getUuidForEnvironment("8e66f0fc-f175-4d7a-b8a8-30a1519163ed"),
    name: "Finger Bass Funk",
    tempo: 105,
    tracks: [
      { steps: [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false] },
      { steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false] },
      { steps: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true] },
      { steps: [true, false, false, true, false, false, true, false, false, false, true, false, true, false, false, false] },
    ],
  },
  // Phase 29B: Tied Notes demos
  {
    uuid: getUuidForEnvironment("2d67db66-81bc-4876-b28a-49b372ccc658"),
    name: "Legato Dreams",
    tempo: 85,
    tracks: [
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false] },
    ],
  },
  {
    uuid: getUuidForEnvironment("559d2476-2fa7-49c6-8aab-7e769a0f95cf"),
    name: "303 Slide",
    tempo: 130,
    tracks: [
      { steps: [true, false, true, false, true, false, false, true, true, false, true, false, true, false, true, false] },
      { steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false] },
      { steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false] },
      { steps: [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, true] },
    ],
  },
  {
    uuid: getUuidForEnvironment("f77c71a7-53ad-4a8d-aaec-f00e1ad6eca0"),
    name: "Smooth Rhodes",
    tempo: 92,
    tracks: [
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, true] },
    ],
  },
  // Phase 29C: Expressive Samples demos
  {
    uuid: getUuidForEnvironment("6fcf648c-a96c-4313-b2e4-289336647ed8"),
    name: "Vibes & Strings",
    tempo: 75,
    tracks: [
      { steps: [true, false, false, false, true, false, false, false, true, false, false, false, false, false, true, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false] },
    ],
  },
  {
    uuid: getUuidForEnvironment("c75ae807-00b5-4874-9d24-b968bf6c0abc"),
    name: "Orchestral Groove",
    tempo: 95,
    tracks: [
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false] },
      { steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false] },
    ],
  },
  // Phase 29E: Key Assistant demos (scale lock + scale sidebar)
  {
    uuid: getUuidForEnvironment("83015acd-c53d-4c53-94ae-3df62e7acef1"),
    name: "Pentatonic Flow",
    tempo: 100,
    tracks: [
      { steps: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false] },
      { steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false] },
    ],
  },
  {
    uuid: getUuidForEnvironment("dcc33ea4-f42b-4379-9c8e-9eb4d669eb30"),
    name: "Jazz Exploration",
    tempo: 88,
    tracks: [
      { steps: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false] },
      { steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false] },
    ],
  },
  {
    uuid: getUuidForEnvironment("ddfa76ad-128f-4d13-ac90-36e2d3e365ff"),
    name: "Minor Key Feels",
    tempo: 75,
    tracks: [
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [false, false, false, false, true, false, false, false, false, false, false, false, false, false, true, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
      { steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] },
    ],
  },
];

/**
 * Get example sessions for display on landing page.
 * Returns all curated examples.
 */
export function getExamples(): ExampleSession[] {
  return EXAMPLE_SESSIONS;
}

/**
 * Get random example sessions for display on landing page.
 * Shuffles and returns a subset each time.
 */
export function getRandomExamples(count: number = 3): ExampleSession[] {
  const shuffled = [...EXAMPLE_SESSIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
