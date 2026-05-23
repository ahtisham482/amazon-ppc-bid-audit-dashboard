/**
 * First-run product tour — 4 steps, no library.
 *
 * Triggered automatically on first load (when localStorage flag is absent).
 * Each step highlights a target element with an outline + dim backdrop, and
 * shows a card with title/body/Next.
 *
 * The component takes an `active` prop. Pass `true` to render, `false` to
 * unmount. Use `onComplete` to persist the "seen" flag.
 */

import { useEffect, useLayoutEffect, useState } from "react";

export interface TourStep {
  /** A CSS selector that resolves to the element to highlight. */
  selector: string;
  title: string;
  body: string;
  /** Optional: which side to render the card on relative to target. */
  placement?: "top" | "bottom" | "left" | "right";
}

const STORAGE_KEY = "ppc-auditor.tour.v1";

export function hasSeenTour(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return true;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ completed: true, ts: new Date().toISOString() }),
    );
  } catch {
    /* noop */
  }
}

export function clearTourSeen(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export function Tour({
  steps,
  active,
  onComplete,
  onSkip,
}: {
  steps: TourStep[];
  active: boolean;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!active) return;
    const step = steps[idx];
    if (!step) return;

    const update = () => {
      const el = document.querySelector(step.selector);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        // Allow scroll to settle a tick
        window.setTimeout(() => {
          const r = el.getBoundingClientRect();
          setRect(r);
        }, 240);
      } else {
        setRect(null);
      }
    };
    update();
    const onResize = () => update();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [idx, active, steps]);

  // Reset to step 0 when re-activated
  useEffect(() => {
    if (active) setIdx(0);
  }, [active]);

  if (!active) return null;
  const step = steps[idx];
  if (!step) return null;

  const isLast = idx === steps.length - 1;
  // Card position: prefer below target, fall back to above if near bottom
  const placement =
    step.placement ?? (rect && rect.top < 200 ? "bottom" : "top");
  const cardStyle: React.CSSProperties = (() => {
    if (!rect) {
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };
    }
    const pad = 16;
    if (placement === "bottom") {
      return { left: rect.left + rect.width / 2, top: rect.bottom + pad };
    }
    if (placement === "right") {
      return { left: rect.right + pad, top: rect.top + rect.height / 2 };
    }
    if (placement === "left") {
      return {
        right: window.innerWidth - rect.left + pad,
        top: rect.top + rect.height / 2,
      };
    }
    // top
    return {
      left: rect.left + rect.width / 2,
      bottom: window.innerHeight - rect.top + pad,
    };
  })();

  return (
    <div
      className="tour-root"
      role="dialog"
      aria-modal="false"
      aria-label={`Tour step ${idx + 1} of ${steps.length}: ${step.title}`}
    >
      {/* Backdrop — split into 4 strips around the highlighted rect so the
          target stays clickable. */}
      {rect ? (
        <>
          <div
            className="tour-mask"
            style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) }}
          />
          <div
            className="tour-mask"
            style={{ top: rect.bottom, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className="tour-mask"
            style={{
              top: rect.top,
              left: 0,
              width: Math.max(0, rect.left),
              height: rect.height,
            }}
          />
          <div
            className="tour-mask"
            style={{
              top: rect.top,
              left: rect.right,
              right: 0,
              height: rect.height,
            }}
          />
          <div
            className="tour-outline"
            style={{
              top: rect.top - 4,
              left: rect.left - 4,
              width: rect.width + 8,
              height: rect.height + 8,
            }}
          />
        </>
      ) : (
        <div className="tour-mask tour-mask-full" />
      )}

      <div
        className={`tour-card tour-card-${placement}`}
        style={cardStyle}
        role="document"
      >
        <div className="tour-step-count">
          Step {idx + 1} of {steps.length}
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button
            type="button"
            className="link-button"
            onClick={onSkip}
            aria-label="Skip the tour"
          >
            Skip tour
          </button>
          <div className="tour-actions-right">
            {idx > 0 && (
              <button
                type="button"
                className="button ghost"
                onClick={() => setIdx(idx - 1)}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="button primary"
              onClick={() => {
                if (isLast) {
                  onComplete();
                } else {
                  setIdx(idx + 1);
                }
              }}
            >
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
