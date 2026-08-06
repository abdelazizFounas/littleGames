import { CROUCH_HEIGHT, PLAYER_HALF, STAND_HEIGHT } from '@littlegames/arena-logic';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
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
import { SKY, colourOfSeat, type Rgb } from './palette.ts';
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
 * The whole arena is one draw call. Every box is a thin instance of a single
 * unit cube, placed by a matrix and coloured by a per-instance attribute, so
 * forty pieces of scenery cost one mesh and one material.
 */

/** Just past the far corner of the arena, so nothing is clipped by the sky. */
const SKY_SIZE = 400;

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
function buildArena(owner: Scene): void {
  const cube = CreateBox('arena', { size: 1 }, owner);
  const matrices = new Float32Array(ARENA_INSTANCES.length * 16);
  const colours = new Float32Array(ARENA_INSTANCES.length * 4);
  const placement = Matrix.Identity();

  for (const [index, instance] of ARENA_INSTANCES.entries()) {
    matrixFor(instance.centre, instance.size, placement);
    placement.copyToArray(matrices, index * 16);
    colours.set([instance.colour.r, instance.colour.g, instance.colour.b, 1], index * 4);
  }

  cube.material = flatMaterial('arena', owner);
  cube.thinInstanceSetBuffer('matrix', matrices, 16);
  cube.thinInstanceSetBuffer('color', colours, 4);
  // Without this the per-instance colours are uploaded and ignored, and the
  // whole arena comes out white.
  cube.useVertexColors = true;
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
  cube.thinInstanceSetBuffer('matrix', matrices, 16, false);
  cube.thinInstanceSetBuffer('color', colours, 4, false);
  cube.thinInstanceCount = 0;
  cube.isVisible = false;
  return cube;
}

export function createArenaBabylonRenderer(): ArenaRenderer {
  let canvas: HTMLCanvasElement | null = null;
  let engine: Engine | null = null;
  let scene: Scene | null = null;
  let camera: FreeCamera | null = null;
  let players: Mesh | null = null;
  let hud: Hud | null = null;

  // Reused every frame. Allocating these per frame is sixty allocations a
  // second for numbers that could simply be overwritten, and a garbage
  // collection in the middle of a duel is a dropped frame nobody can explain.
  const eye = new Vector3(0, 0, 0);
  const target = new Vector3(0, 0, 1);
  const scratch = Matrix.Identity();
  const playerMatrices = new Float32Array(2 * 16);
  const playerColours = new Float32Array(2 * 4);

  function drawPlayers(mesh: Mesh, view: ArenaView): void {
    let drawn = 0;

    for (const player of view.players) {
      if (!player.alive || drawn >= 2) {
        continue;
      }
      const height = player.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
      matrixFor(
        // The rules hold feet; a cube is placed by its middle.
        { x: player.position.x, y: player.position.y + height / 2, z: player.position.z },
        { x: PLAYER_HALF * 2, y: height, z: PLAYER_HALF * 2 },
        scratch,
      );
      scratch.copyToArray(playerMatrices, drawn * 16);
      const colour = colourOfSeat(player.seat);
      playerColours.set([colour.r, colour.g, colour.b, 1], drawn * 4);
      drawn += 1;
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

      const created = new Engine(element, true, { stencil: false }, true);
      const built = new Scene(created);
      built.clearColor = toColor3(SKY).toColor4(1);

      // One light, from above, and a ground bounce dark enough that the
      // underside of a crate is plainly its underside. This is what gives a
      // cube three distinguishable faces without a single texture; flat unlit
      // faces would make the whole arena one silhouette.
      const sky = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), built);
      sky.intensity = 1;
      sky.groundColor = new Color3(0.22, 0.24, 0.3);

      // Never given any input of its own. The session computes where the eye is
      // and hands it over in the view; a camera that also listened to the mouse
      // would fight it.
      const eyeCamera = new FreeCamera('eye', new Vector3(0, 2, 0), built);
      eyeCamera.inputs.clear();
      eyeCamera.minZ = 0.05;
      eyeCamera.maxZ = SKY_SIZE;
      built.activeCamera = eyeCamera;

      buildArena(built);
      const bodies = buildPlayers(built, playerMatrices, playerColours);

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
      hud = createHud(container);

      // Nothing is drawn until the session asks for it. Babylon's own render
      // loop is deliberately never started: two loops would draw states nobody
      // composed, at a rate nobody chose.
      return Promise.resolve();
    },

    render(view: ArenaView): void {
      if (scene === null || camera === null || players === null || hud === null) {
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
      players = null;
      camera = null;
      scene = null;
      engine = null;
      canvas = null;
    },
  };
}
