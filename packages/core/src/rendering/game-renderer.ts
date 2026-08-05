/**
 * Contract that every rendering engine must implement.
 *
 * A game receives a `GameRenderer` through injection and never learns which
 * engine sits behind it. That indirection is what allows a second engine to be
 * added later without touching game logic, networking or the lobby, and what
 * makes a do-nothing headless implementation enough to run a full match inside
 * a unit test.
 *
 * @typeParam TState - Snapshot type the game hands over on every frame.
 */
export interface GameRenderer<TState> {
  /**
   * Attach the renderer to a DOM container and acquire its drawing context.
   *
   * Asynchronous because current engines initialise their GPU context
   * asynchronously: PixiJS 8 requires `await app.init()` after construction,
   * the constructor alone no longer produces a usable renderer.
   */
  mount(container: HTMLElement): Promise<void>;

  /**
   * Draw a single frame.
   *
   * @param state - Snapshot to draw, expressed in fixed logical coordinates
   * that are independent of the screen size.
   * @param interpolationAlpha - Progress within `[0, 1]` between the previous
   * and the current simulation step, used to smooth motion between server
   * ticks.
   */
  render(state: TState, interpolationAlpha: number): void;

  /**
   * Rescale the drawing surface to the given pixel size.
   *
   * Logical coordinates are unaffected: scaling is the renderer's concern
   * alone.
   */
  resize(width: number, height: number): void;

  /** Release the drawing context and every resource acquired by `mount`. */
  destroy(): void;
}
