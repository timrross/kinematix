/**
 * The suspension data model.
 *
 * A rear suspension is modelled as a 2D planar mechanism with one degree of
 * freedom. Everything is expressed as a flat set of points plus rigid-distance
 * constraints between them, so the *same* solver handles a single pivot, a
 * Horst-link four-bar, a VPP-style short-link four-bar and anything else a user
 * draws. There is deliberately no notion of "this is a Horst link" in the
 * model — topology is an emergent property of where the points and links are.
 *
 * Rigid bodies (e.g. a rocker, or a swingarm that carries the axle, a shock
 * mount and a pivot) are represented as several points wired together with
 * enough links to be rigid. A triangle of three links pins three points
 * rigidly relative to one another; that is how a moving body carries the axle.
 *
 * Coordinate convention (millimetres):
 *   - x increases rearward (toward the rear wheel).
 *   - y increases upward.
 *   - The ground line is y = 0; both wheels rest on it.
 *   - The bottom bracket sits near the origin.
 *
 * Zero React imports live in this module by design — it is pure geometry and is
 * unit-tested in isolation.
 */

/** A point in the mechanism. Coordinates are in millimetres. */
export interface Point {
  id: string;
  /** Display name, e.g. "Main pivot", "Axle". */
  name: string;
  x: number;
  y: number;
  /**
   * `true` if the point is fixed to the front triangle ("ground"). Fixed points
   * never move during a solve; free points are solved for.
   */
  fixed: boolean;
}

/**
 * A rigid link: the distance between its two endpoints is held constant. The
 * rest length is taken from the point positions in the design's home (fully
 * extended) configuration, so the drawn geometry defines the link lengths.
 */
export interface Link {
  id: string;
  a: string; // point id
  b: string; // point id
}

/**
 * The shock (damper). Treated as a variable-length member between two points;
 * its length is the driver we sweep. `eyeToEye` is the installed
 * eyelet-to-eyelet length in the home configuration (full extension), `stroke`
 * is the usable shock stroke. The sweep drives length from `eyeToEye` down to
 * `eyeToEye - stroke`.
 */
export interface Shock {
  frame: string; // point id, normally fixed to the front triangle
  link: string; // point id on the moving linkage
  eyeToEye: number;
  stroke: number;
}

/** Wheel size / tyre geometry and the pedalling/braking metric inputs. */
export interface MetricInputs {
  /** Chainring tooth count (front). */
  chainringTeeth: number;
  /** Cog tooth count at the rear (the gear used for the anti-squat figure). */
  cogTeeth: number;
  /** Centre-of-gravity height above the ground, mm. Estimate by default. */
  cogHeight: number;
  /** Wheelbase, mm. Estimate by default. */
  wheelbase: number;
  /** Rear tyre radius (axle height), mm. */
  rearTyreRadius: number;
  /** Front tyre radius, mm. */
  frontTyreRadius: number;
  /**
   * Whether the user has adjusted these from the preset defaults. When false,
   * the UI flags anti-squat / anti-rise as estimates.
   */
  touched: boolean;
}

export interface Design {
  /** Schema version, for forward-compatible save files / share links. */
  version: 1;
  name: string;
  /**
   * Optional provenance / disclaimer shown in the UI — e.g. for designs derived
   * from a reverse-engineered estimate of a real bike.
   */
  note?: string;
  points: Point[];
  links: Link[];
  shock: Shock;
  /** Point id of the rear axle. */
  axleId: string;
  /** Point id of the bottom bracket / chainring centre (normally fixed). */
  bbId: string;
  metrics: MetricInputs;
}

export function getPoint(design: Design, id: string): Point {
  const p = design.points.find((pt) => pt.id === id);
  if (!p) throw new Error(`Unknown point id: ${id}`);
  return p;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Rest length of a link, derived from the current point positions. */
export function linkLength(design: Design, link: Link): number {
  return distance(getPoint(design, link.a), getPoint(design, link.b));
}

/** A deep clone, used before mutating a design in the UI. */
export function cloneDesign(design: Design): Design {
  return {
    ...design,
    points: design.points.map((p) => ({ ...p })),
    links: design.links.map((l) => ({ ...l })),
    shock: { ...design.shock },
    metrics: { ...design.metrics },
  };
}
