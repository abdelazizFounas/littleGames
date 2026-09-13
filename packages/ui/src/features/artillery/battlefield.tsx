import { useId } from 'react';
import {
  tankPosition,
  terrain,
  trajectory,
  type ArtilleryState,
  type Shot,
} from '@littlegames/artillery-logic';
export const THEMES = {
  mesa: {
    name: 'Amber Mesa',
    subtitle: 'Warm skies. Long shadows.',
    sky: '#302536',
    glow: '#db8860',
    far: '#72516a',
    mid: '#965d67',
    ground: '#79493f',
    edge: '#e4aa78',
    sun: '#ffd6a0',
  },
  alpine: {
    name: 'Alpine Echo',
    subtitle: 'High peaks. Higher stakes.',
    sky: '#142e45',
    glow: '#5d9ca5',
    far: '#547c92',
    mid: '#355e72',
    ground: '#254b52',
    edge: '#b1d9d7',
    sun: '#e0f2d7',
  },
  moon: {
    name: 'Lunar Outpost',
    subtitle: 'Low gravity. Giant arcs.',
    sky: '#10172e',
    glow: '#544b82',
    far: '#3b3d67',
    mid: '#53537f',
    ground: '#393a58',
    edge: '#a4a4d4',
    sun: '#c6c4f4',
  },
};
function TankArt({
  color,
  angle,
  wreck,
}: {
  readonly color: string;
  readonly angle: number;
  readonly wreck: boolean;
}) {
  return (
    <g opacity={wreck ? 0.45 : 1}>
      <ellipse cx="0" cy="17" rx="45" ry="9" fill="#081524" opacity=".4" />
      <rect
        x="-35"
        y="-1"
        width="70"
        height="24"
        rx="12"
        fill="#172630"
        stroke="#adc0bb"
        strokeWidth="2"
      />
      {[-24, -12, 0, 12, 24].map((x) => (
        <g key={x}>
          <circle cx={x} cy="11" r="7" fill="#465863" />
          <circle cx={x} cy="11" r="3" fill="#99aca8" />
        </g>
      ))}
      <path d="M-32 0-24-12H20L32 0Z" fill={color} stroke="#e2e4cd" strokeWidth="1.5" />
      <g transform={`rotate(${-angle})`}>
        <path d="M0-5H48v10H0Z" fill={color} stroke="#f1ead1" strokeWidth="1.5" />
        <rect x="39" y="-7" width="12" height="14" rx="2" fill="#43555c" />
      </g>
      <path d="M-16-1v-14q16-12 32 0v14Z" fill={color} stroke="#f5ebd2" strokeWidth="1.5" />
      <rect x="-7" y="-16" width="14" height="5" rx="2" fill="#eff0c8" />
      <path d="M-23-13v-33m0 0 14 4-14 5" stroke="#e7dfc4" fill={color} strokeWidth="2" />
    </g>
  );
}
export function Battlefield({
  state,
  seat,
  angle,
  power,
  shot,
  impact,
  guide,
}: {
  readonly state: ArtilleryState;
  readonly seat: number;
  readonly angle: number;
  readonly power: number;
  readonly shot: Shot | null;
  readonly impact: boolean;
  readonly guide: boolean;
}) {
  const id = useId().replaceAll(':', ''),
    theme = THEMES[state.options.map];
  const ground = Array.from(
    { length: 61 },
    (_, i) => `${i * 20},${terrain(state.options.map, i * 20)}`,
  ).join(' ');
  const flight = shot?.path.map((point) => `${point.x},${point.y}`).join(' ');
  const preview =
    guide && state.phase === 'playing'
      ? trajectory(state, seat, angle, power)
          .path.slice(0, 12)
          .map((point) => `${point.x},${point.y}`)
          .join(' ')
      : '';
  return (
    <svg
      className="artillery-landscape"
      viewBox="0 0 1200 620"
      role="img"
      aria-label={`${theme.name} battlefield. Your tank is on the ${seat === 0 ? 'left' : 'right'}. Wind ${state.wind}.`}
    >
      <defs>
        <linearGradient id={`${id}-sky`} x2="0" y2="1">
          <stop stopColor={theme.sky} />
          <stop offset="1" stopColor={theme.glow} />
        </linearGradient>
        <linearGradient id={`${id}-earth`} x2="0" y2="1">
          <stop stopColor={theme.ground} />
          <stop offset="1" stopColor="#18232d" />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop stopColor={theme.sun} stopOpacity=".22" />
          <stop offset="1" stopColor={theme.sun} stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-ground`}>
          <polygon points={`0,620 ${ground} 1200,620`} />
        </clipPath>
      </defs>
      <path d="M0 0h1200v620H0Z" fill={`url(#${id}-sky)`} />
      {Array.from({ length: 38 }, (_, i) => (
        <circle
          key={i}
          cx={(i * 197 + 71) % 1200}
          cy={30 + ((i * 61) % 220)}
          r={i % 4 === 0 ? 1.7 : 0.8}
          fill="#ffecd9"
          opacity={state.options.map === 'moon' ? 0.7 : 0.23}
        />
      ))}
      <circle cx="865" cy="150" r="190" fill={`url(#${id}-halo)`} />
      <circle cx="865" cy="150" r="61" fill={theme.sun} />
      {state.options.map === 'moon' && (
        <g opacity=".3" fill="#6e729f">
          <circle cx="846" cy="131" r="14" />
          <circle cx="882" cy="172" r="19" />
          <circle cx="889" cy="122" r="8" />
        </g>
      )}
      <path
        d="M0 360 110 290 180 330 310 195 425 310 550 235 670 350 790 220 920 320 1070 200 1200 295V620H0Z"
        fill={theme.far}
        opacity=".7"
      />
      {state.options.map === 'alpine' && (
        <path
          d="m265 244 45-49 67 72-42-16-26-24-19 30Z m751 15 54-59 44 37-37-9-18 25Z"
          fill="#d1dce2"
          opacity=".8"
        />
      )}
      <path
        d="M0 380 170 340 260 400 410 315 520 370 680 320 815 385 950 305 1050 370 1200 340V620H0Z"
        fill={theme.mid}
      />
      <path
        className="artillery-cloud"
        d="M140 147h130m-105-10h60m455 80h110m-85-12h50"
        stroke={theme.sun}
        strokeWidth="9"
        strokeLinecap="round"
        opacity=".1"
      />
      <polygon points={`0,620 ${ground} 1200,620`} fill={`url(#${id}-earth)`} />
      <g clipPath={`url(#${id}-ground)`} fill="none" stroke={theme.edge} opacity=".16">
        {Array.from({ length: 8 }, (_, i) => (
          <path
            key={i}
            d={`M-30 ${475 + i * 24} Q280 ${370 + i * 24} 590 ${480 + i * 24} T1260 ${460 + i * 24}`}
            strokeWidth={i % 3 === 0 ? 7 : 2}
          />
        ))}
        {Array.from({ length: 34 }, (_, i) => (
          <circle key={i} cx={(i * 139) % 1200} cy={430 + ((i * 47) % 170)} r={2 + (i % 5)} />
        ))}
      </g>
      <polyline points={ground} fill="none" stroke={theme.edge} strokeWidth="5" />
      {[0, 1].map((player) => {
        const point = tankPosition(state.options.map, player),
          tank = state.tanks[player];
        return (
          <g key={player} transform={`translate(${point.x} ${point.y})`}>
            {state.turn === player && state.phase === 'playing' && (
              <path
                d="m-8-68 8 9 8-9"
                fill="none"
                stroke={player === seat ? '#daf691' : '#ffb995'}
                strokeWidth="3"
              />
            )}
            {tank?.shield && (
              <ellipse
                cy="-5"
                rx="53"
                ry="44"
                fill="#99dbef18"
                stroke="#a4eaff"
                strokeWidth="2"
                strokeDasharray="6 5"
              />
            )}
            <TankArt
              color={player === seat ? '#c6db8b' : '#ec9e83'}
              angle={player === seat ? angle : player === 0 ? 45 : 135}
              wreck={(tank?.health ?? 0) <= 0}
            />
          </g>
        );
      })}
      {preview && !shot && (
        <polyline
          points={preview}
          fill="none"
          stroke="#edfad0"
          strokeWidth="3"
          strokeDasharray="3 10"
          opacity=".55"
        />
      )}
      {shot && flight && !impact && (
        <g key={shot.id}>
          <polyline
            className="artillery-flight-trail"
            points={flight}
            fill="none"
            pathLength="1"
            stroke="#fff2c5"
            strokeWidth="3"
          />
          <g>
            <animateMotion
              dur="1.3s"
              path={`M${shot.path.map((p) => `${p.x},${p.y}`).join(' L')}`}
              rotate="auto"
              fill="freeze"
            />
            <ellipse rx="10" ry="4" fill="#fff7d5" />
            <path d="M-27 0h16" stroke="#ffba74" strokeWidth="5" opacity=".6" />
          </g>
        </g>
      )}
      {shot && impact && (
        <g key={`${shot.id}-impact`} transform={`translate(${shot.impact.x} ${shot.impact.y})`}>
          <circle
            className="artillery-explosion"
            r={shot.weapon === 'scatter' ? 100 : 70}
            fill="#ffb978"
            opacity=".4"
          />
          <circle className="artillery-explosion artillery-explosion--core" r="38" fill="#fff1b4" />
          {Array.from({ length: 12 }, (_, i) => (
            <g key={i} transform={`rotate(${i * 30})`}>
              <path
                className="artillery-debris"
                d="M0-10v-60"
                stroke="#ffdf9d"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </g>
          ))}
        </g>
      )}
      <text x="38" y="580" fill="#e6d1b5" opacity=".45" fontFamily="monospace" fontSize="13">
        {theme.name.toUpperCase()} / SECTOR 0{state.round}
      </text>
    </svg>
  );
}
