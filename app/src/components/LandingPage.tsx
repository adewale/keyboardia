import { useState, useEffect, useRef, useCallback } from 'react';
import { EXAMPLE_SESSIONS, type ExampleSession } from '../data/example-sessions';
import './LandingPage.css';

interface LandingPageProps {
  onStartSession: () => void;
  onSelectExample: (pattern: number[][], bpm: number) => void;
}

// Convert boolean steps to number pattern for grid display
function sessionToPattern(session: ExampleSession): number[][] {
  return session.tracks.map(track =>
    track.steps.map(step => step ? 1 : 0)
  );
}

const demoPattern = [
  [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
  [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
  [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
  [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
];

export function LandingPage({ onStartSession }: LandingPageProps) {
  const [playhead, setPlayhead] = useState(0);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const slidesRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement[]>([]);

  const examples = EXAMPLE_SESSIONS;

  const visibleCount = 2;
  const maxCarouselIndex = examples.length - visibleCount;

  // Playhead animation
  useEffect(() => {
    const interval = setInterval(() => {
      setPlayhead(prev => (prev + 1) % 16);
    }, 300);
    return () => clearInterval(interval);
  }, []);

  // Update carousel transform
  useEffect(() => {
    if (slidesRef.current && cardsRef.current[0]) {
      const cardWidth = cardsRef.current[0].offsetWidth + 12;
      slidesRef.current.style.transform = `translateX(-${carouselIndex * cardWidth}px)`;
    }
  }, [carouselIndex]);

  const handlePrev = useCallback(() => {
    if (carouselIndex > 0) setCarouselIndex(prev => prev - 1);
  }, [carouselIndex]);

  const handleNext = useCallback(() => {
    if (carouselIndex < maxCarouselIndex) setCarouselIndex(prev => prev + 1);
  }, [carouselIndex, maxCarouselIndex]);

  const handleExampleClick = useCallback((example: ExampleSession) => {
    // Navigate to the published session
    window.location.href = `/s/${example.uuid}`;
  }, []);

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-header-left">
          <h1>Keyboardia</h1>
          <span className="landing-tagline">
            <span className="c">Create</span> · <span className="r">Remix</span> · <span className="s">Share</span>
          </span>
        </div>
        <button className="landing-btn primary" onClick={onStartSession}>
          Start Session
        </button>
      </header>

      <main className="landing-panel">
        <div className="landing-sequencer">
          <div className="landing-grid">
            {demoPattern.map((row, ri) => (
              <div key={ri} className="landing-grid-row">
                {row.map((active, ci) => (
                  <div
                    key={ci}
                    className={`landing-cell${active ? ' active' : ''}${ci === playhead ? ' playing' : ''}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="landing-examples">
          <h2 className="landing-examples-header">Examples to remix</h2>
          <div className="landing-carousel-wrapper">
            <button
              className="landing-carousel-btn"
              onClick={handlePrev}
              disabled={carouselIndex === 0}
              aria-label="Previous"
            >
              ‹
            </button>
            <div className="landing-carousel-track">
              <div className="landing-carousel-slides" ref={slidesRef}>
                {examples.map((ex, i) => {
                  const pattern = sessionToPattern(ex);
                  return (
                    <div
                      key={ex.uuid}
                      className="landing-example-card"
                      ref={el => { if (el) cardsRef.current[i] = el; }}
                      onClick={() => handleExampleClick(ex)}
                    >
                      <div className="landing-example-thumb">
                        {pattern.map((row, ri) => (
                          <div key={ri} className="landing-thumb-row">
                            {row.map((active, ci) => (
                              <div
                                key={ci}
                                className={`landing-thumb-cell${active ? ' active' : ''}`}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="landing-example-meta">
                        <span className="landing-example-name">{ex.name}</span>
                        <span className="landing-example-bpm">{ex.tempo} bpm</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <button
              className="landing-carousel-btn"
              onClick={handleNext}
              disabled={carouselIndex >= maxCarouselIndex}
              aria-label="Next"
            >
              ›
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
