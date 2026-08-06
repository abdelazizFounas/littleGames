import { Container, Graphics } from 'pixi.js';
import { GRID } from './layout.ts';
import { SEA_DEEP, SEA_WAVE_HIGH, SEA_WAVE_LOW, SEA_WAVE_MID } from './palette.ts';

/**
 * Sea that never stops moving.
 *
 * This is what makes a turn-based game need a render loop at all: nothing about
 * the match changes between turns, but the water does, sixty times a second,
 * whether or not anyone has taken one.
 *
 * The waves are drawn once and then only ever moved. Rebuilding the geometry
 * every frame would re-tessellate and re-upload some thousands of segments for
 * a picture that differs from the last by a few pixels of drift, so each band
 * is a ribbon twice as wide as the grid, slid sideways under a mask and wrapped
 * once it has travelled a whole grid's width. The wavelengths all divide that
 * width, so the wrap lands on a whole number of crests and cannot be seen.
 */

interface Band {
  readonly view: Graphics;
  /** Sideways drift, in units a second. Signs differ so the layers separate. */
  readonly drift: number;
  /** How far the band rises and falls, and how quickly. */
  readonly heave: number;
  readonly heaveRate: number;
  readonly phase: number;
}

interface BandSpec {
  readonly spacing: number;
  readonly amplitude: number;
  /** Must divide `GRID`, or the wrap shows as a seam. */
  readonly wavelength: number;
  readonly drift: number;
  readonly heave: number;
  readonly heaveRate: number;
  readonly thickness: number;
  readonly colour: number;
  readonly alpha: number;
}

const BANDS: readonly BandSpec[] = [
  {
    spacing: 22,
    amplitude: 3,
    wavelength: GRID / 5,
    drift: 15,
    heave: 2,
    heaveRate: 0.9,
    thickness: 2,
    colour: SEA_WAVE_MID,
    alpha: 0.22,
  },
  {
    spacing: 34,
    amplitude: 5,
    wavelength: GRID / 4,
    drift: -23,
    heave: 3,
    heaveRate: 0.6,
    thickness: 3,
    colour: SEA_WAVE_LOW,
    alpha: 0.5,
  },
  {
    spacing: 52,
    amplitude: 8,
    wavelength: GRID / 2,
    drift: 8,
    heave: 4,
    heaveRate: 0.4,
    thickness: 4,
    colour: SEA_WAVE_HIGH,
    alpha: 0.12,
  },
];

/** Distance between sampled points along a crest. */
const STEP = 10;

/** How far past the top and bottom edges a band is drawn, to cover its heave. */
const OVERDRAW = 24;

export interface Water {
  /** Add this where the grid starts; it fills exactly one grid. */
  readonly view: Container;
  /** Moves the sea on to a given moment, in seconds since the game began. */
  update: (seconds: number) => void;
}

function drawBand(spec: BandSpec, phase: number): Graphics {
  const band = new Graphics();

  for (let y = -OVERDRAW; y <= GRID + OVERDRAW; y += spec.spacing) {
    // Drawn across two grid widths so that sliding by one always leaves the
    // visible half covered by the other.
    for (let x = 0; x <= GRID * 2; x += STEP) {
      const wave = y + spec.amplitude * Math.sin((x / spec.wavelength) * Math.PI * 2 + phase);
      if (x === 0) {
        band.moveTo(x, wave);
      } else {
        band.lineTo(x, wave);
      }
    }
    band.stroke({ width: spec.thickness, color: spec.colour, alpha: spec.alpha });
  }

  return band;
}

/**
 * Builds one patch of sea.
 *
 * @param phase - Offset into the wave, so two grids on screen at once are not
 * the same picture twice.
 */
export function createWater(phase: number): Water {
  const view = new Container();

  const floor = new Graphics();
  floor.rect(0, 0, GRID, GRID).fill(SEA_DEEP);

  const bands: Band[] = BANDS.map((spec, index) => ({
    view: drawBand(spec, phase + index * 1.7),
    drift: spec.drift,
    heave: spec.heave,
    heaveRate: spec.heaveRate,
    phase: phase + index,
  }));

  // Without this the bands would show outside the grid they belong to, since
  // each is drawn wider and taller than the water it fills.
  const clip = new Graphics();
  clip.rect(0, 0, GRID, GRID).fill(0xffffff);

  view.addChild(floor);
  for (const band of bands) {
    view.addChild(band.view);
  }
  view.addChild(clip);
  view.mask = clip;

  return {
    view,
    update(seconds: number): void {
      for (const band of bands) {
        // Modulo twice: the first can come back negative for a band drifting
        // the other way, which would slide it off its own drawn width.
        band.view.x = -((((seconds * band.drift) % GRID) + GRID) % GRID);
        band.view.y = band.heave * Math.sin(seconds * band.heaveRate + band.phase);
      }
    },
  };
}
