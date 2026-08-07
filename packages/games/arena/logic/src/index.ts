export * from './constants.ts';
export type { Bounds } from './bounds.ts';
export { overlaps } from './bounds.ts';
export type { Vec2, Vec3 } from './vector.ts';
export {
  DEFAULT_AIM,
  ZERO_2,
  aimFromWire,
  aimToWire,
  clampToUnit,
  fromWire,
  moveFromWire,
  moveToWire,
  normalizeAim,
  toWire,
} from './vector.ts';
export type { Box, BoxKind, Seat } from './arena.ts';
export {
  ARENA_BOXES,
  COLLIDERS,
  OCCLUDERS,
  SEATS,
  SPAWNS,
  SPAWN_AIM,
  mirrorX,
  mirrorZ,
  opponentOf,
} from './arena.ts';
export type { MoveIntent, PlayerBody } from './body.ts';
export type { Crouchable } from './body.ts';
export {
  bodyBounds,
  bodyHeight,
  eyeHeight,
  eyePosition,
  restingBody,
  stepBody,
} from './body.ts';
export type { BodyPart, PartBox, Pose } from './pose.ts';
export { PARTS_PER_BODY, facingOf, hittablePartsOf, lift, poseOf, swing } from './pose.ts';
export type { OrientedBox, ShotTarget, Trace } from './ray.ts';
export { rayVsBox, rayVsOrientedBox, traceShot } from './ray.ts';
export { deflect, seedOf, spreadOf, unitFrom, xorshift32 } from './spread.ts';
export type {
  ArenaInput,
  ArenaInputs,
  ArenaState,
  HistoryFrame,
  MatchPhase,
  PlayerSim,
} from './state.ts';
export {
  NO_INPUT,
  clampRewind,
  createInitialState,
  historyAt,
  playerOf,
  respawn,
  startCountdown,
} from './state.ts';
export type { ShotEvent, StepResult } from './step.ts';
export { damageOf, step } from './step.ts';
