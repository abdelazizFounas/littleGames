import { PARTS_PER_BODY, poseOf, type PartBox } from '@littlegames/arena-logic';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
// Required to register shadow rendering with the scene.
// oxlint-disable-next-line import/no-unassigned-import
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Scene } from '@babylonjs/core/scene.js';
// Side effects only, and required: this is the module that puts the
// thinInstance methods on Mesh. Imported for its own sake because the deep
// paths above are what keep the rest of the engine out of the chunk, and those
// do not drag it in.
// oxlint-disable-next-line import/no-unassigned-import
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { ARENA_INSTANCES, type BoxInstance } from './instances.ts';
import { SKY, TRACER, TRACER_HIT, colourOfPart, colourOfSeat, type Rgb } from './palette.ts';
import { createHud, type Hud } from './hud.ts';
import type { ArenaRenderer, ArenaView } from './view.ts';

/**
 * Draws the arena with Babylon.js.
 *
 * This is the only file in the project allowed to know Babylon exists, and the
 * package it lives in is reached by a dynamic import so the engine never enters
 * the entry chunk. It receives a finished view and draws it: no rules, no
 * clock, no network, and no camera of its own.
 *
 * The arena walls share one mesh. Every box is a thin instance of a single
 * unit cube, placed by a matrix and coloured by a per-instance attribute, so
 * the structural scenery shares one material. Floor markings and shadows
 * are rendered separately.
 */

/** Just past the far corner of the arena, so nothing is clipped by the sky. */
const SKY_SIZE = 400;

/**
 * How thick a tracer is, as a fraction of its distance from the eye.
 *
 * A fixed width in metres does not work here: the arena is twenty-three metres
 * across, and a line four centimetres wide at that range is under a pixel on a
 * normal display — drawn correctly, uploaded correctly, and invisible. Sizing it
 * by distance instead makes a tracer subtend the same angle wherever it is, so
 * it reads the same across the gap as it does at your feet.
 */
const TRACER_ANGULAR_THICKNESS = 0.0018;
const TRACER_MIN_THICKNESS = 0.012;
const TRACER_MAX_THICKNESS = 0.07;

/**
 * How much of a tracer is skipped at the muzzle end.
 *
 * A shot starts at the shooter's eye, and this player's eye is the camera: drawn
 * from its true origin, their own tracer would be a bar across the middle of the
 * screen. Starting it a stride out puts it where a muzzle would be, and costs
 * the opponent's tracers nothing anybody can see from across the arena.
 */
const TRACER_MUZZLE_METRES = 0.04;

/** As many tracers as can plausibly be in the air at once. */
const MAX_TRACERS = 8;

/** Parts per body including its rifle, for both seats, plus the view model. */
const VIEW_MODEL_PARTS = 12;
const MAX_PARTS = PARTS_PER_BODY * 2 + VIEW_MODEL_PARTS;

function toColor3(colour: Rgb): Color3 {
  return new Color3(colour.r, colour.g, colour.b);
}

/** A translation and a scale, which is all a box ever needs. */
function matrixFor(centre: BoxInstance['centre'], size: BoxInstance['size'], into: Matrix): void {
  Matrix.ComposeToRef(
    new Vector3(size.x, size.y, size.z),
    Quaternion.Identity(),
    new Vector3(centre.x, centre.y, centre.z),
    into,
  );
}

/** A cube with no shine on it, which is every surface in this game. */
function flatMaterial(name: string, owner: Scene): StandardMaterial {
  const material = new StandardMaterial(name, owner);
  // A specular highlight on a flat voxel face reads as a smear rather than as
  // a light, and there is no light source to justify one: the scene is lit by
  // the sky alone.
  material.specularColor = Color3.Black();
  material.diffuseColor = Color3.White();
  return material;
}

/** The scenery: one cube, one matrix and one colour per box. */
function buildArena(owner: Scene): Mesh {
  const cube = CreateBox('arena', { size: 1 }, owner);
  const matrices = new Float32Array(ARENA_INSTANCES.length * 16);
  const colours = new Float32Array(ARENA_INSTANCES.length * 4);
  const placement = Matrix.Identity();

  for (const [index, instance] of ARENA_INSTANCES.entries()) {
    matrixFor(instance.centre, instance.size, placement);
    placement.copyToArray(matrices, index * 16);
    colours.set([instance.colour.r, instance.colour.g, instance.colour.b, 1], index * 4);
  }

  const material = flatMaterial('arena', owner);
  const texture = new DynamicTexture('panel-detail', 256, owner, true);
  const context = texture.getContext();
  context.fillStyle = '#ececec'; context.fillRect(0, 0, 256, 256);
  context.strokeStyle = '#b8b8b8'; context.lineWidth = 3; context.strokeRect(5, 5, 246, 246);
  context.strokeStyle = '#f9f9f9'; context.lineWidth = 2; context.strokeRect(8, 8, 240, 240);
  context.fillStyle = '#a4a4a4';
  for (const x of [15, 237]) for (const y of [15, 237]) context.fillRect(x, y, 4, 4);
  context.fillStyle = '#d8d8d8';
  for (let y = 85; y < 175; y += 12) context.fillRect(94, y, 68, 3);
  texture.update();
  material.diffuseTexture = texture;
  cube.material = material;
  cube.receiveShadows = true;
  cube.thinInstanceSetBuffer('matrix', matrices, 16);
  cube.thinInstanceSetBuffer('color', colours, 4);
  // Without this the per-instance colours are uploaded and ignored, and the
  // whole arena comes out white.
  cube.useVertexColors = true;
  return cube;
}

/**
 * The bodies, as a second instanced cube.
 *
 * A separate mesh from the scenery because these move: the scenery's buffers
 * are written once at mount, and these are rewritten every frame — into the
 * same two arrays, which is why they are handed in rather than allocated. Two
 * is the capacity of a match, and a body that is not drawn is not a body that
 * needs its buffer resized.
 */
function buildPlayers(owner: Scene, matrices: Float32Array, colours: Float32Array): Mesh {
  const cube = CreateBox('players', { size: 1 }, owner);
  cube.material = flatMaterial('players', owner);
  cube.useVertexColors = true;
  // Never culled. A thin-instanced mesh is tested against the bounding box of
  // the mesh the instances were built from, and that box is a unit cube at the
  // origin — in the middle of the ravine. Look anywhere that does not contain
  // the middle of the ravine and every instance disappears at once, wherever it
  // actually is. Refreshing the bounds each frame would be the other answer;
  // for two bodies, not culling at all is cheaper than working out that they
  // are visible.
  cube.alwaysSelectAsActiveMesh = true;
  cube.thinInstanceSetBuffer('matrix', matrices, 16, false);
  cube.thinInstanceSetBuffer('color', colours, 4, false);
  cube.thinInstanceCount = 0;
  cube.isVisible = false;
  return cube;
}

/**
 * The tracers, as a third instanced cube.
 *
 * Unlit and bright: a tracer is not a surface catching the light, it is the
 * light. Lighting it like scenery would make it dimmest exactly where it
 * matters, which is against the dark far wall.
 */
function buildTracers(owner: Scene, matrices: Float32Array, colours: Float32Array): Mesh {
  const cube = CreateBox('tracers', { size: 1 }, owner);
  // Same as the bodies: culled by a unit cube in the middle of the ravine
  // unless told otherwise, which is why a tracer fired anywhere else was drawn
  // and never seen.
  //
  // Lit like everything else rather than unlit. `disableLighting` takes the
  // per-instance colour out of the shading path and the tracers came out
  // black — drawn, sized and oriented correctly, and the wrong colour
  // entirely. A generous emissive term lifts them off the scenery instead,
  // which is what made them read as a shot rather than as a stick.
  const material = flatMaterial('tracers', owner);
  material.emissiveColor = new Color3(0.55, 0.55, 0.55);
  cube.material = material;
  cube.useVertexColors = true;
  cube.thinInstanceSetBuffer('matrix', matrices, 16, false);
  cube.thinInstanceSetBuffer('color', colours, 4, false);
  cube.thinInstanceCount = 0;
  cube.isVisible = false;
  cube.alwaysSelectAsActiveMesh = true;
  return cube;
}

/** Painted navigation lines stay on existing floors and cannot change cover. */
function buildFloorMarkings(owner: Scene): void {
  for (const sign of [-1, 1]) {
    const texture = new DynamicTexture(`floor-${sign}`, { width: 1024, height: 512 }, owner, true);
    const context = texture.getContext();
    context.fillStyle = '#344756'; context.fillRect(0, 0, 1024, 512);
    context.strokeStyle = '#415766'; context.lineWidth = 2;
    for (let x = 0; x <= 1024; x += 51.2) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 512); context.stroke(); }
    for (let y = 0; y <= 512; y += 51.2) { context.beginPath(); context.moveTo(0, y); context.lineTo(1024, y); context.stroke(); }
    context.strokeStyle = sign < 0 ? '#a5d97b' : '#edaa88'; context.lineWidth = 5;
    context.strokeRect(20, 18, 984, 476);
    context.setLineDash([28, 18]); context.beginPath(); context.moveTo(20, 255); context.lineTo(1004, 255); context.stroke(); context.setLineDash([]);
    context.fillStyle = '#c8d3c8'; context.font = 'bold 44px monospace';
    context.fillText(sign < 0 ? 'SECTOR 01' : 'SECTOR 02', 380, 470);
    texture.update();
    const material = flatMaterial(`floor-paint-${sign}`, owner);
    material.diffuseTexture = texture;
    const ground = CreateGround(`floor-paint-${sign}`, { width: 20, height: 10 }, owner);
    ground.position.set(0, 0.003, sign * 8);
    ground.material = material;
    ground.receiveShadows = true;
    ground.isPickable = false;
  }
}

export function createArenaBabylonRenderer(): ArenaRenderer {
  let canvas: HTMLCanvasElement | null = null;
  let engine: Engine | null = null;
  let scene: Scene | null = null;
  let camera: FreeCamera | null = null;
  let players: Mesh | null = null;
  let tracers: Mesh | null = null;
  let weapon: Mesh | null = null;
  let hud: Hud | null = null;

  // Reused every frame. Allocating these per frame is sixty allocations a
  // second for numbers that could simply be overwritten, and a garbage
  // collection in the middle of a duel is a dropped frame nobody can explain.
  const eye = new Vector3(0, 0, 0);
  const target = new Vector3(0, 0, 1);
  const scratch = Matrix.Identity();
  const playerMatrices = new Float32Array(MAX_PARTS * 16);
  const playerColours = new Float32Array(MAX_PARTS * 4);
  const weaponMatrices = new Float32Array(VIEW_MODEL_PARTS * 16);
  const weaponColours = new Float32Array(VIEW_MODEL_PARTS * 4);
  const tracerMatrices = new Float32Array(MAX_TRACERS * 16);
  const tracerColours = new Float32Array(MAX_TRACERS * 4);
  const along = new Vector3(0, 0, 1);
  const turn = new Quaternion();
  const forwardAxis = new Vector3(0, 0, 1);

  /**
   * The bodies, a box at a time.
   *
   * The pose comes from the rules rather than from an animation here, because
   * these are the boxes that will be shot at: a leg drawn where it is not is a
   * leg you can miss by hitting.
   */
  function drawPlayers(mesh: Mesh, view: ArenaView): void {
    let drawn = 0;

    for (const player of view.players) {
      if (!player.alive) {
        continue;
      }
      const pose = poseOf(player.body, player.aim);
      const seat = colourOfSeat(player.seat);
      for (const piece of pose.parts) {
        drawn = placePart(piece, colourOfPart(piece.part, seat), drawn);
      }
    }

    mesh.thinInstanceCount = drawn;
    // Hidden outright when there is nobody to draw. A thin-instanced mesh with
    // a count of zero does not draw nothing: it falls back to drawing itself,
    // and the unit cube it was built from appears in the middle of the arena.
    mesh.isVisible = drawn > 0;
    if (drawn > 0) {
      mesh.thinInstanceBufferUpdated('matrix');
      mesh.thinInstanceBufferUpdated('color');
    }
  }

  /**
   * Writes one part into the instance buffers, in its own frame.
   *
   * Each part carries its own axes now — a leg hinged at the hip is not aligned
   * to anything — so the matrix is built from those three vectors directly
   * rather than from a rotation about the vertical.
   */
  function placePart(piece: PartBox, colour: Rgb, index: number, matrices = playerMatrices, colours = playerColours): number {
    if (index >= MAX_PARTS) {
      return index;
    }
    Matrix.FromValuesToRef(
      piece.right.x * piece.half.x * 2, piece.right.y * piece.half.x * 2, piece.right.z * piece.half.x * 2, 0,
      piece.up.x * piece.half.y * 2, piece.up.y * piece.half.y * 2, piece.up.z * piece.half.y * 2, 0,
      piece.forward.x * piece.half.z * 2, piece.forward.y * piece.half.z * 2, piece.forward.z * piece.half.z * 2, 0,
      piece.centre.x, piece.centre.y, piece.centre.z, 1,
      scratch,
    );
    scratch.copyToArray(matrices, index * 16);
    colours.set([colour.r, colour.g, colour.b, 1], index * 4);
    return index + 1;
  }

  function drawWeapon(mesh: Mesh, view: ArenaView): void {
    let drawn = 0;
    for (const piece of view.viewModel.slice(0, VIEW_MODEL_PARTS)) {
      drawn = placePart(piece, colourOfPart(piece.part, colourOfSeat(view.seat)), drawn, weaponMatrices, weaponColours);
    }
    mesh.thinInstanceCount = drawn;
    mesh.isVisible = drawn > 0;
    if (drawn) {
      mesh.thinInstanceBufferUpdated('matrix');
      mesh.thinInstanceBufferUpdated('color');
    }
  }

  function drawTracers(mesh: Mesh, view: ArenaView): void {
    let drawn = 0;

    for (const shot of view.shots) {
      if (drawn >= MAX_TRACERS) {
        break;
      }
      along.set(shot.to.x - shot.from.x, shot.to.y - shot.from.y, shot.to.z - shot.from.z);
      const length = along.length();
      if (length <= TRACER_MUZZLE_METRES) {
        continue;
      }
      along.scaleInPlace(1 / length);
      Quaternion.FromUnitVectorsToRef(forwardAxis, along, turn);

      // The drawn segment runs from the muzzle to the endpoint, so its middle
      // is not the middle of the shot.
      const start = TRACER_MUZZLE_METRES;
      const drawnLength = length - start;
      const middle = start + drawnLength / 2;

      const centreX = shot.from.x + along.x * middle;
      const centreY = shot.from.y + along.y * middle;
      const centreZ = shot.from.z + along.z * middle;
      const range = Math.hypot(
        centreX - view.camera.position.x,
        centreY - view.camera.position.y,
        centreZ - view.camera.position.z,
      );
      const thickness = Math.min(
        Math.max(range * TRACER_ANGULAR_THICKNESS, TRACER_MIN_THICKNESS),
        TRACER_MAX_THICKNESS,
      );

      Matrix.ComposeToRef(
        new Vector3(thickness, thickness, drawnLength),
        turn,
        new Vector3(centreX, centreY, centreZ),
        scratch,
      );
      scratch.copyToArray(tracerMatrices, drawn * 16);

      const colour = shot.hitPlayer ? TRACER_HIT : TRACER;
      // Faded by dimming rather than by transparency: an opaque tracer needs no
      // sorting against the scenery it crosses, and a line that goes out is read
      // the same way as one that fades away.
      const left = 1 - Math.min(Math.max(shot.fade, 0), 1);
      tracerColours.set([colour.r * left, colour.g * left, colour.b * left, 1], drawn * 4);
      drawn += 1;
    }

    mesh.thinInstanceCount = drawn;
    mesh.isVisible = drawn > 0;
    if (drawn > 0) {
      mesh.thinInstanceBufferUpdated('matrix');
      mesh.thinInstanceBufferUpdated('color');
    }
  }

  return {
    get canvas(): HTMLCanvasElement | null {
      return canvas;
    },

    mount(container: HTMLElement): Promise<void> {
      const element = document.createElement('canvas');
      element.style.width = '100%';
      element.style.height = '100%';
      element.style.display = 'block';
      // A canvas that can be focused is a canvas that can hold the keyboard,
      // and pointer lock is requested on it.
      element.tabIndex = 0;
      element.style.outline = 'none';
      container.appendChild(element);
      canvas = element;

      const created = new Engine(element, true, { stencil: false, powerPreference: 'high-performance' }, false);
      engine = created;
      created.setHardwareScalingLevel(1 / Math.min(globalThis.devicePixelRatio || 1, 2));
      const built = new Scene(created);
      scene = built;
      built.clearColor = toColor3(SKY).toColor4(1);

      // One light, from above, and a ground bounce dark enough that the
      // underside of a crate is plainly its underside. This is what gives a
      // cube three distinguishable faces without a single texture; flat unlit
      // faces would make the whole arena one silhouette.
      const sky = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), built);
      sky.intensity = 0.72;
      sky.groundColor = new Color3(0.28, 0.31, 0.38);

      // Never given any input of its own. The session computes where the eye is
      // and hands it over in the view; a camera that also listened to the mouse
      // would fight it.
      const eyeCamera = new FreeCamera('eye', new Vector3(0, 2, 0), built);
      eyeCamera.inputs.clear();
      eyeCamera.minZ = 0.05;
      eyeCamera.maxZ = SKY_SIZE;
      built.activeCamera = eyeCamera;

      const scenery = buildArena(built);
      buildFloorMarkings(built);
      const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.35), built);
      sun.position = new Vector3(15, 24, -14);
      sun.diffuse = new Color3(1, 0.91, 0.78);
      sun.intensity = 1.15;
      const shadows = new ShadowGenerator(1024, sun);
      shadows.usePercentageCloserFiltering = true;
      shadows.bias = 0.002;
      shadows.normalBias = 0.02;
      shadows.addShadowCaster(scenery);
      shadows.setDarkness(0.3);
      const bodies = buildPlayers(built, playerMatrices, playerColours);
      shadows.addShadowCaster(bodies);
      const hands = buildPlayers(built, weaponMatrices, weaponColours);
      hands.name = 'first-person-rifle';
      hands.renderingGroupId = 1;
      // Clear world depth only for the first-person model, so nearby cover
      // never cuts through the rifle. World targets still use normal depth.
      built.setRenderingAutoClearDepthStencil(1, true, true, false);
      weapon = hands;
      const lines = buildTracers(built, tracerMatrices, tracerColours);

      // The sky is a box seen from the inside: its faces are flipped by scaling
      // it inside out rather than by a two-sided material, which would also
      // draw the outside nobody can reach.
      const dome = CreateBox('sky', { size: SKY_SIZE, sideOrientation: 1 }, built);
      const domeMaterial = new StandardMaterial('sky', built);
      domeMaterial.disableLighting = true;
      domeMaterial.emissiveColor = toColor3(SKY);
      domeMaterial.backFaceCulling = false;
      dome.material = domeMaterial;
      dome.infiniteDistance = true;

      engine = created;
      scene = built;
      camera = eyeCamera;
      players = bodies;
      tracers = lines;
      hud = createHud(container);

      // Nothing is drawn until the session asks for it. Babylon's own render
      // loop is deliberately never started: two loops would draw states nobody
      // composed, at a rate nobody chose.
      return Promise.resolve();
    },

    render(view: ArenaView): void {
      if (scene === null || camera === null || players === null || weapon === null || tracers === null || hud === null) {
        return;
      }

      eye.set(view.camera.position.x, view.camera.position.y, view.camera.position.z);
      camera.position.copyFrom(eye);
      target.set(
        view.camera.position.x + view.camera.forward.x,
        view.camera.position.y + view.camera.forward.y,
        view.camera.position.z + view.camera.forward.z,
      );
      camera.setTarget(target);
      camera.fov = view.camera.fieldOfView;

      drawPlayers(players, view);
      drawTracers(tracers, view);
      drawWeapon(weapon, view);
      hud.update(view.hud);
      scene.render();
    },

    resize(): void {
      // The canvas fills its container in CSS, so the size to adopt is the one
      // the browser has already worked out. Passing the numbers in would make
      // this the second opinion about it.
      engine?.resize();
    },

    destroy(): void {
      hud?.destroy();
      scene?.dispose();
      engine?.dispose();
      canvas?.remove();
      hud = null;
      tracers = null;
      players = null;
      weapon = null;
      camera = null;
      scene = null;
      engine = null;
      canvas = null;
    },
  };
}
