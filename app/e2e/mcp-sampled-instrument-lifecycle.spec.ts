import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, type Page } from '@playwright/test';
import {
  getBaseUrl,
  test,
  useMockAPI,
  waitForAppReady,
  waitForCollaborationReady,
} from './global-setup';

const CONTROL_TRACK = {
  trackId: 'mcp-control-hihat',
  name: 'MCP Control Hi-Hat',
  sampleId: 'hihat',
} as const;

const MCP_SAMPLED_TRACKS = [
  {
    trackId: 'jazz-brush-snare',
    name: 'Jazz Brush Snare',
    sampleId: 'sampled:brushes-snare',
    instrumentId: 'brushes-snare',
  },
  {
    trackId: 'jazz-ride-cymbal',
    name: 'Jazz Ride Cymbal',
    sampleId: 'sampled:acoustic-ride',
    instrumentId: 'acoustic-ride',
  },
  {
    trackId: 'take5-alto-sax',
    name: 'Take 5 Sax',
    sampleId: 'sampled:alto-sax',
    instrumentId: 'alto-sax',
  },
] as const;

const ACTIVE_STEPS = Array.from({ length: 16 }, (_, step) => step);
const SILENCE_PEAK = 1e-4;

test.skip(useMockAPI, 'MCP lifecycle acceptance requires the real Worker and WebSocket backend');

function trackRow(page: Page, name: string) {
  return page.locator('.track-row').filter({
    has: page.getByRole('button', { name, exact: true }),
  });
}

async function connectMcpAgent(baseUrl: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl));
  const client = new Client(
    { name: 'mcp-audio-lifecycle-acceptance', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(transport);
  return client;
}

async function callMcpTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeTruthy();
  return result.structuredContent as Record<string, unknown>;
}

async function addActiveTrack(
  client: Client,
  sessionId: string,
  track: { trackId: string; name: string; sampleId: string },
): Promise<void> {
  await callMcpTool(client, 'edit_session', {
    session_id: sessionId,
    edit: {
      operation: 'add_track',
      track_id: track.trackId,
      sample_id: track.sampleId,
      name: track.name,
    },
  });
  await callMcpTool(client, 'edit_session', {
    session_id: sessionId,
    edit: {
      operation: 'set_steps',
      track_id: track.trackId,
      changes: ACTIVE_STEPS.map((step) => ({ step, value: true })),
    },
  });
}

async function installAudioProbes(page: Page, trackIds: string[]): Promise<void> {
  await page.evaluate((ids) => {
    type TrackBus = { getOutputNode: () => AudioNode };
    type TrackBusManager = { getOrCreateBus: (trackId: string) => TrackBus };
    type Engine = {
      getAudioContext: () => AudioContext | null;
      trackBusManager?: TrackBusManager;
    };
    const engine = (window as unknown as { __audioEngine__?: Engine }).__audioEngine__;
    const context = engine?.getAudioContext();
    const manager = engine?.trackBusManager;
    if (!context || !manager) throw new Error('Audio graph unavailable');

    const probes: Record<string, AnalyserNode> = {};
    for (const trackId of ids) {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      manager.getOrCreateBus(trackId).getOutputNode().connect(analyser);
      probes[trackId] = analyser;
    }
    (window as unknown as { __mcpAudioProbes__?: Record<string, AnalyserNode> })
      .__mcpAudioProbes__ = probes;
  }, trackIds);
}

async function measurePeaks(
  page: Page,
  trackIds: string[],
  durationMs = 2_500,
): Promise<Record<string, number>> {
  const peaks = Object.fromEntries(trackIds.map((trackId) => [trackId, 0]));
  const deadline = Date.now() + durationMs;

  while (Date.now() < deadline) {
    const frame = await page.evaluate(() => {
      const probes = (window as unknown as {
        __mcpAudioProbes__?: Record<string, AnalyserNode>;
      }).__mcpAudioProbes__;
      if (!probes) throw new Error('MCP audio probes unavailable');

      return Object.fromEntries(Object.entries(probes).map(([trackId, analyser]) => {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        return [trackId, peak];
      }));
    });
    for (const [trackId, peak] of Object.entries(frame)) {
      peaks[trackId] = Math.max(peaks[trackId] ?? 0, peak);
    }
    await page.waitForTimeout(25);
  }
  return peaks;
}

async function sampledReadiness(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate((instrumentIds) => {
    type Engine = { isSampledInstrumentReady: (id: string) => boolean };
    const engine = (window as unknown as { __audioEngine__?: Engine }).__audioEngine__;
    return Object.fromEntries(instrumentIds.map((instrumentId) => [
      instrumentId,
      engine?.isSampledInstrumentReady(instrumentId) ?? false,
    ]));
  }, MCP_SAMPLED_TRACKS.map(({ instrumentId }) => instrumentId));
}

test('MCP-created sampled tracks become audible when added during uninterrupted playback', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const baseUrl = getBaseUrl();
  const mcp = await connectMcpAgent(baseUrl);
  const instrumentRequests = Object.fromEntries(
    MCP_SAMPLED_TRACKS.map(({ instrumentId }) => [instrumentId, [] as string[]]),
  );
  page.on('request', (request) => {
    for (const { instrumentId } of MCP_SAMPLED_TRACKS) {
      if (request.url().includes(`/instruments/${instrumentId}/`)) {
        instrumentRequests[instrumentId].push(request.url());
      }
    }
  });

  try {
    // The complete authored session path starts at MCP. REST is not used to
    // create or mutate musical state in this acceptance journey.
    const created = await callMcpTool(mcp, 'create_session', {
      idempotency_key: crypto.randomUUID(),
      name: 'MCP live sampled-instrument acceptance',
      tempo: 160,
    });
    const sessionId = created.session_id as string;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);

    await addActiveTrack(mcp, sessionId, CONTROL_TRACK);

    await page.goto(`${baseUrl}/s/${sessionId}?debug=1&trace=1`);
    await waitForAppReady(page);
    await waitForCollaborationReady(page);
    await expect(trackRow(page, CONTROL_TRACK.name)).toBeVisible();

    // One user gesture starts playback. It is never stopped or restarted
    // during the MCP edits below.
    const playButton = page.getByTestId('play-button');
    await playButton.click();
    await expect(playButton).toHaveAttribute('aria-label', 'Stop', { timeout: 30_000 });

    await installAudioProbes(page, [CONTROL_TRACK.trackId]);
    const controlBeforeMcpAdds = await measurePeaks(page, [CONTROL_TRACK.trackId], 1_000);
    expect(controlBeforeMcpAdds[CONTROL_TRACK.trackId]).toBeGreaterThan(SILENCE_PEAK);

    for (const track of MCP_SAMPLED_TRACKS) {
      await addActiveTrack(mcp, sessionId, track);
    }

    for (const track of MCP_SAMPLED_TRACKS) {
      const row = trackRow(page, track.name);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.locator('.step-cell').first()).toHaveClass(/\bactive\b/);
      await expect(row.locator('.step-cell').nth(15)).toHaveClass(/\bactive\b/);
    }

    const expectedReadiness = Object.fromEntries(
      MCP_SAMPLED_TRACKS.map(({ instrumentId }) => [instrumentId, true]),
    );
    await expect.poll(sampledReadiness.bind(null, page), {
      timeout: 30_000,
      message: 'Every MCP-added sampled instrument should finish loading without a Play restart',
    }).toEqual(expectedReadiness);

    // MCP remains the protocol oracle for persisted musical state as well as
    // the mutation driver used above.
    const compactSession = await callMcpTool(mcp, 'get_session', { session_id: sessionId });
    const compactTracks = compactSession.tracks as Array<{
      track_id: string;
      sample_id: string;
      active_steps: number[];
    }>;
    for (const track of [CONTROL_TRACK, ...MCP_SAMPLED_TRACKS]) {
      expect(compactTracks).toContainEqual(expect.objectContaining({
        track_id: track.trackId,
        sample_id: track.sampleId,
        active_steps: ACTIVE_STEPS,
      }));
    }

    const probedTrackIds = [
      CONTROL_TRACK.trackId,
      ...MCP_SAMPLED_TRACKS.map(({ trackId }) => trackId),
    ];
    await installAudioProbes(page, probedTrackIds);
    const peaks = await measurePeaks(page, probedTrackIds);
    const finalReadiness = await sampledReadiness(page);

    const observation = {
      sessionId,
      playButton: await playButton.getAttribute('aria-label'),
      controlBeforeMcpAdds,
      finalReadiness,
      peaks,
      instrumentRequests,
      compactTracks,
    };
    console.log('MCP_LIVE_SAMPLED_ACCEPTANCE', JSON.stringify(observation, null, 2));

    // Still playing proves there was no recovery-by-restart hidden in the test.
    expect(observation.playButton).toBe('Stop');
    expect(finalReadiness).toEqual(expectedReadiness);
    for (const { trackId, instrumentId } of MCP_SAMPLED_TRACKS) {
      expect(instrumentRequests[instrumentId].length).toBeGreaterThan(0);
      expect(peaks[trackId]).toBeGreaterThan(SILENCE_PEAK);
    }
    expect(peaks[CONTROL_TRACK.trackId]).toBeGreaterThan(SILENCE_PEAK);
  } finally {
    await mcp.close();
  }
});
