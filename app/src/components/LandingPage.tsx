import { useState, useEffect, useRef, useCallback } from "react";
import {
  EXAMPLE_SESSIONS,
  getExampleHref,
  getExampleRemixTarget,
  type ExampleRemixTarget,
  type ExampleSession,
} from "../data/example-sessions";
import { resetDocumentMeta } from "../utils/document-meta";
import { ChevronLeft, ChevronRight } from "../icons";
import { RemixButton } from "./RemixButton";
import "./LandingPage.css";

interface LandingPageProps {
  onStartSession: () => void;
  onRemixExample: (target: ExampleRemixTarget) => Promise<void>;
}

// Convert boolean steps to number pattern for grid display
function sessionToPattern(session: ExampleSession): number[][] {
  return session.tracks.map((track) =>
    track.steps.map((step) => (step ? 1 : 0)),
  );
}

const demoPattern = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
];

export function LandingPage({ onStartSession, onRemixExample }: LandingPageProps) {
  const [playhead, setPlayhead] = useState(0);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [remixingExampleId, setRemixingExampleId] = useState<string | null>(null);
  const [remixError, setRemixError] = useState<string | null>(null);
  const slidesRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLElement[]>([]);

  const examples = EXAMPLE_SESSIONS;
  const visibleCount = viewportWidth <= 768 ? 1 : 2;
  const maxCarouselIndex = Math.max(0, examples.length - visibleCount);

  // Reset document meta when landing page mounts
  useEffect(() => {
    resetDocumentMeta();
  }, []);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  useEffect(() => {
    setCarouselIndex(current => Math.min(current, maxCarouselIndex));
  }, [maxCarouselIndex]);

  // Playhead animation
  useEffect(() => {
    const interval = setInterval(() => {
      setPlayhead((prev) => (prev + 1) % 16);
    }, 300);
    return () => clearInterval(interval);
  }, []);

  // Update carousel transform
  useEffect(() => {
    if (slidesRef.current && cardsRef.current[0]) {
      const cardWidth = cardsRef.current[0].offsetWidth + 12;
      slidesRef.current.style.transform = `translateX(-${carouselIndex * cardWidth}px)`;
    }
  }, [carouselIndex, viewportWidth]);

  const handlePrev = useCallback(() => {
    if (carouselIndex > 0) setCarouselIndex((prev) => prev - 1);
  }, [carouselIndex]);

  const handleNext = useCallback(() => {
    if (carouselIndex < maxCarouselIndex) setCarouselIndex((prev) => prev + 1);
  }, [carouselIndex, maxCarouselIndex]);

  const handleExampleRemix = useCallback(async (example: ExampleSession) => {
    if (remixingExampleId) return;
    const target = getExampleRemixTarget(example);
    setRemixingExampleId(target.sourceId);
    setRemixError(null);

    try {
      await onRemixExample(target);
    } catch {
      setRemixError(`Could not remix “${example.name}”. Please try again.`);
    } finally {
      setRemixingExampleId(null);
    }
  }, [onRemixExample, remixingExampleId]);

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-header-left">
          <h1>Keyboardia</h1>
          <span className="landing-tagline">
            <span className="c">Create</span> · <span className="r">Remix</span>{" "}
            · <span className="s">Share</span>
          </span>
        </div>
        <button className="landing-btn primary" onClick={onStartSession}>
          Start Session
        </button>
      </header>

      <section className="landing-features">
        <div className="landing-feature-card">
          <h3 className="landing-feature-title">Instant Creation</h3>
          <p className="landing-feature-desc">
            Jump straight into a step sequencer and start making beats.
          </p>
        </div>
        <div className="landing-feature-card">
          <h3 className="landing-feature-title">Remix Anything</h3>
          <p className="landing-feature-desc">
            Fork any session. Publish and share your creations.
          </p>
        </div>
        <div className="landing-feature-card">
          <h3 className="landing-feature-title">Multiplayer</h3>
          <p className="landing-feature-desc">
            Share a link. Jam together in real-time. See each other's changes
            instantly.
          </p>
        </div>
      </section>

      <main className="landing-panel">
        <div className="landing-sequencer">
          <div className="landing-grid">
            {demoPattern.map((row, ri) => (
              <div key={ri} className="landing-grid-row">
                {row.map((active, ci) => (
                  <div
                    key={ci}
                    className={`landing-cell${active ? " active" : ""}${ci === playhead ? " playing" : ""}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="landing-examples">
          <h2 className="landing-examples-header" id="landing-examples-heading">Examples to remix</h2>
          <div className="landing-carousel-wrapper">
            <button
              className="landing-carousel-btn"
              onClick={handlePrev}
              disabled={carouselIndex === 0}
              aria-label="Previous examples"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <div
              className="landing-carousel-track"
              role="region"
              aria-roledescription="carousel"
              aria-labelledby="landing-examples-heading"
            >
              <div className="landing-carousel-slides" ref={slidesRef}>
                {examples.map((ex, i) => {
                  const pattern = sessionToPattern(ex);
                  const remixTarget = getExampleRemixTarget(ex);
                  const isVisible = i >= carouselIndex && i < carouselIndex + visibleCount;
                  return (
                    <article
                      key={ex.uuid}
                      className="landing-example-card"
                      ref={(el) => {
                        if (el) cardsRef.current[i] = el;
                      }}
                      aria-hidden={!isVisible}
                      inert={!isVisible ? true : undefined}
                      aria-label={`${ex.name}, ${i + 1} of ${examples.length}`}
                    >
                      <div className="landing-example-thumb" aria-hidden="true">
                        {pattern.map((row, ri) => (
                          <div key={ri} className="landing-thumb-row">
                            {row.map((active, ci) => (
                              <div
                                key={ci}
                                className={`landing-thumb-cell${active ? " active" : ""}`}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="landing-example-meta">
                        <a
                          className="landing-example-details"
                          href={getExampleHref(ex)}
                          aria-label={`Open ${ex.name}`}
                          tabIndex={isVisible ? 0 : -1}
                        >
                          <span className="landing-example-name">
                            {ex.name}
                          </span>
                          <span className="landing-example-bpm">
                            {ex.tempo} bpm
                          </span>
                        </a>
                        <RemixButton
                          onClick={() => { void handleExampleRemix(ex); }}
                          disabled={remixingExampleId !== null}
                          isRemixing={remixingExampleId === remixTarget.sourceId}
                          primary
                          title={`Create an editable remix of ${ex.name}`}
                          ariaLabel={`Remix ${ex.name}`}
                          tabIndex={isVisible ? 0 : -1}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
            <button
              className="landing-carousel-btn"
              onClick={handleNext}
              disabled={carouselIndex >= maxCarouselIndex}
              aria-label="Next examples"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
          {remixError && <p className="landing-remix-error" role="alert">{remixError}</p>}
        </div>
      </main>

      {/* Cloudflare footer */}
      <footer className="cloudflare-footer">
        Built on <a href="https://developers.cloudflare.com/" target="_blank" rel="noopener noreferrer">the Cloudflare Developer Platform</a>
      </footer>
    </div>
  );
}
