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
  FEET_TOGETHER_EARLY,
  FEET_TOGETHER_LATE,
  bodyBounds,
  bodyHeight,
  eyeHeight,
  eyePosition,
  restingBody,
  stepBody,
} from './body.ts';
export type { BodyPart, PartBox, Pose } from './pose.ts';
export { facingOf, hittablePartsOf, poseOf, swing } from './pose.ts';
export type { ShotTarget, Trace } from './ray.ts';
export { rayVsBox, traceShot } from './ray.ts';
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
export { step } from './step.ts';
