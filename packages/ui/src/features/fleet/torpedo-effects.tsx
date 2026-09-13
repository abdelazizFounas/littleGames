import { useLayoutEffect, useState, useRef, type RefObject } from 'react';
import { cellLabel } from '@littlegames/battleship-logic';
import type { TorpedoEvent } from './fleet-presentation';

interface Course {
  width: number;
  height: number;
  path: string;
  x: number;
  y: number;
}
export function TorpedoEffects({
  event,
  frame,
  reducedMotion,
  paused,
}: {
  readonly event: TorpedoEvent;
  readonly frame: RefObject<HTMLDivElement | null>;
  readonly reducedMotion: boolean;
  readonly paused: boolean;
}) {
  const ocean = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    if (paused) ocean.current?.pauseAnimations();
    else ocean.current?.unpauseAnimations();
  }, [paused, event.phase]);
  const [course, setCourse] = useState<Course | null>(null);
  useLayoutEffect(() => {
    const root = frame.current;
    const operations = root?.querySelector('.fleet-operations');
    if (!root || !operations) return undefined;
    const measure = () => {
      const origin = operations.getBoundingClientRect();
      const source = root
        .querySelector(
          event.direction === 'outgoing'
            ? '.fleet-grid--own .fleet-grid__cells'
            : '.fleet-grid--enemy .fleet-grid__cells',
        )
        ?.getBoundingClientRect();
      const target = root
        .querySelector(
          `${event.direction === 'outgoing' ? '.fleet-grid--enemy' : '.fleet-grid--own'} [data-cell="${event.shot.row * 10 + event.shot.column}"]`,
        )
        ?.getBoundingClientRect();
      if (!source || !target) return;
      const sx = source.left + source.width / 2 - origin.left;
      const sy = source.top + source.height / 2 - origin.top;
      const x = target.left + target.width / 2 - origin.left;
      const y = target.top + target.height / 2 - origin.top;
      const bend = Math.min(100, Math.abs(x - sx) / 4 + Math.abs(y - sy) / 6);
      setCourse({
        width: origin.width,
        height: origin.height,
        x,
        y,
        path: `M ${sx} ${sy} Q ${(sx + x) / 2} ${(sy + y) / 2 - bend} ${x} ${y}`,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(operations);
    return () => observer.disconnect();
  }, [event.direction, event.shot, frame]);
  const message =
    event.phase === 'flight'
      ? `${event.direction === 'outgoing' ? 'Torpedo away' : 'Incoming torpedo'} · ${cellLabel(event.shot.row, event.shot.column)}`
      : `${event.shot.result === 'miss' ? 'Water splash · Miss' : event.shot.result === 'sunk' ? 'Ship sunk · Wreck revealed' : 'Direct hit'} · ${cellLabel(event.shot.row, event.shot.column)}`;
  return (
    <div
      className={`fleet-effects fleet-effects--${event.phase} fleet-effects--${event.shot.result}`}
      data-direction={event.direction}
      data-shot={event.id}
    >
      <span className="fleet-effects__message" role="status">
        {message}
      </span>
      {course && !reducedMotion && (
        <svg
          ref={ocean}
          className="fleet-effects__ocean"
          aria-hidden="true"
          viewBox={`0 0 ${course.width} ${course.height}`}
        >
          {event.phase === 'flight' ? (
            <g key={event.id}>
              <path className="fleet-torpedo-course" d={course.path} fill="none" />
              <g className="fleet-torpedo">
                <animateMotion dur="0.65s" path={course.path} rotate="auto" fill="freeze" />
                <path
                  d="M-48 0H-13"
                  stroke="#bcefff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity=".6"
                />
                <path d="M-35 -5l22 4m-22 6 22-4" stroke="#66d3f1" fill="none" opacity=".6" />
                <path d="M-14 -4H5L14 0 5 4H-14l4-4Z" fill="#fff5ce" stroke="#71ddea" />
              </g>
            </g>
          ) : (
            <g key={`${event.id}-impact`} transform={`translate(${course.x} ${course.y})`}>
              <circle className="fleet-impact-ring" r="14" />
              <circle className="fleet-impact-ring fleet-impact-ring--second" r="14" />
              <circle className="fleet-impact-core" r="12" />
              {Array.from({ length: 10 }, (_, index) => (
                <g key={index} transform={`rotate(${index * 36})`}>
                  <path className="fleet-impact-spray" d="M0 -10v-21" />
                </g>
              ))}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
