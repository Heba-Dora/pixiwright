/** Serializable contract between the Playwright process and the page agent. */

export type Matcher =
  | { kind: 'string'; value: string; exact: boolean }
  | { kind: 'regex'; source: string; flags: string };

export type QueryStep =
  | { kind: 'label'; match: Matcher }
  | { kind: 'text'; match: Matcher }
  | { kind: 'nth'; index: number };

export type Query = QueryStep[];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** What the agent can see about one scene object. */
export interface NodeInfo {
  /** Quoted label, or the type when the object has no label of its own. */
  name: string;
  type: string;
  /** Text of this object and its descendants, or null if there is none. */
  text: string | null;
  /** True when the object is drawn on the canvas. */
  visible: boolean;
  /** Why the object is not visible, or null when it is. */
  hiddenReason: string | null;
  /** Alpha after multiplying through every ancestor. */
  alpha: number;
  /** Visible portion in Pixi global coordinates, or null when hidden. */
  bounds: Rect | null;
  /** Visible portion in CSS pixels relative to the viewport, or null when hidden. */
  box: Rect | null;
}

export type ActionFailure =
  | 'no-app'
  | 'not-rendered'
  | 'not-found'
  | 'ambiguous'
  | 'hidden'
  | 'no-size'
  | 'masked'
  | 'off-canvas'
  | 'outside-viewport'
  | 'dom-covered'
  | 'covered'
  | 'curtained'
  | 'not-interactive';

export type ActionProbe =
  | { ok: true; x: number; y: number }
  | { ok: false; code: ActionFailure; message: string };

export interface ActionProbeOptions {
  /** Skip the checks that decide whether the object would receive the input. */
  force?: boolean;
  /** Offset from the object's top-left corner, in Pixi units. Defaults to its center. */
  position?: Point;
}

export interface SceneOptions {
  /** List every object, not only those with a label or text. */
  all?: boolean;
  /** Include each object's bounds. Text bounds vary with installed fonts. */
  bounds?: boolean;
  /** Only list objects whose label matches, for comparing part of a busy scene. */
  labels?: RegExp;
}

export type AgentSceneOptions = Omit<SceneOptions, 'labels'> & { labels?: { source: string; flags: string } };

export interface AgentConfig {
  /** Stop the clock as soon as an application starts. */
  freeze?: boolean;
}

export interface PixiAgent {
  appCount(): number;
  count(app: number, query: Query): number;
  describe(app: number, query: Query): NodeInfo[];
  actionPoint(app: number, query: Query, options: ActionProbeOptions): ActionProbe;
  scene(app: number, options: AgentSceneOptions): string | null;
  canvas(app: number): HTMLCanvasElement | null;
  freeze(app: number): boolean;
  resume(app: number): boolean;
  isFrozen(app: number): boolean;
  step(app: number, frames: number, fps: number): boolean;
  render(app: number): boolean;
  nextFrame(): Promise<void>;
}
