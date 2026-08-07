import type { ArenaRenderer } from '@littlegames/arena-renderer-babylon';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { describeError } from '../lib/describe-error';

/**
 * The arena, flown through by nobody.
 *
 * A development-only page, and the first thing in this game anyone can look at:
 * there is no server here, no prediction and no opponent, only the geometry the
 * rules are compiled against and a camera moving through it on a fixed path.
 * That is deliberately the whole of it — the point of this phase is that a
 * second rendering engine can be added without any of the rest, and a page that
 * needed a match to show anything would not have proved it.
 *
 * React mounts the box and then stays out of the loop, exactly as it does for a
 * real match.
 */
export function ArenaPreviewRoute(): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }

    let renderer: ArenaRenderer | null = null;
    let frame = 0;
    let cancelled = false;
    let observer: ResizeObserver | null = null;

    const run = async (): Promise<void> => {
      // Loaded only now, so no page that never shows the arena carries a 3D
      // engine. This dynamic import is the reason the entry chunk stays clear
      // of Babylon, and the build is checked for it.
      const { createArenaBabylonRenderer, flythroughAt } = await import(
        '@littlegames/arena-renderer-babylon'
      );
      if (cancelled) {
        return;
      }

      const created = createArenaBabylonRenderer();
      await created.mount(container);
      if (cancelled) {
        created.destroy();
        return;
      }
      renderer = created;
      created.resize(container.clientWidth, container.clientHeight);

      observer = new ResizeObserver(() => {
        created.resize(container.clientWidth, container.clientHeight);
      });
      observer.observe(container);

      const startedAt = performance.now();
      const draw = (now: number): void => {
        frame = requestAnimationFrame(draw);
        created.render(
          {
            camera: flythroughAt((now - startedAt) / 1000),
            players: [],
            shots: [],
            viewModel: [],
            hud: {
              ownScore: 0,
              opponentScore: 0,
              message: 'Arena preview',
              respawnSeconds: 0,
              crosshair: false,
              scope: 0,
              hitMarker: 0,
              damage: 0,
            },
          },
          0,
        );
      };
      frame = requestAnimationFrame(draw);
    };

    void run().catch((cause: unknown) => {
      if (!cancelled) {
        setError(describeError(cause, 'The arena could not be drawn.'));
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer?.destroy();
    };
  }, []);

  return (
    <section>
      <h1>Arena preview</h1>
      <p className="hint">
        The arena as the rules describe it, on a camera path that goes nowhere. No server, no
        opponent, no controls yet.
      </p>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div className="stage">
        <div className="stage__frame">
          <div ref={containerRef} className="stage__surface stage__surface--arena" />
        </div>
      </div>
    </section>
  );
}
