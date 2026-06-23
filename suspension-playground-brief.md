# Build Brief: MTB Suspension Design Playground

## 1. What this is

A free, browser-based tool that lets any curious rider build a rear suspension
linkage by dragging pivot points around, and watch the suspension behaviour
update live. The point is play and intuition, not professional-grade engineering
output. The win condition is that someone with no kinematics background can drag
a pivot, see the leverage curve change in real time, and start to understand why.

It must be free, require no account, and work on a phone as well as a desktop.

## 2. Audience and tone

Curious riders, not engineers. Assume they have heard the words "leverage ratio"
and "anti-squat" but cannot define them. Every metric needs a one-line plain
English explanation available in the UI. Nothing should require reading a manual
before the first drag.

## 3. Hard constraints

- Fully client-side. No backend, no database, no accounts in v1.
- Static hosting only (must deploy to something like Netlify, Vercel or GitHub
  Pages for free).
- Works offline once loaded.
- Mobile-first responsive layout. Pivot dragging must work with touch.
- Open source. MIT licence. Public repo.

## 4. Tech stack (decided, do not re-litigate)

- TypeScript throughout.
- React with Vite.
- SVG for the linkage view and the curve plots. Do not pull in a heavy chart
  library, the plots are simple line graphs and SVG keeps the bundle small and
  the styling consistent with the linkage view.
- State management: plain React state or Zustand, your call. No Redux.
- All geometry and solver code in a framework-agnostic `/src/kinematics` module
  with zero React imports, so it can be unit tested in isolation and reused.
- Vitest for unit tests on the solver.

## 5. The core: the kinematics solver

This is the hard part and everything else depends on it being correct and stable.
Build it first, behind a clean interface, with tests, before any UI work.

### Model

A rear suspension is a 2D planar mechanism with one degree of freedom. The front
triangle is "ground" (fixed). Links are rigid members. Joints are pin joints. The
shock is a variable-length member between two points.

Support two topologies in v1, both through the same solver code path:

- Single pivot (including linkage-driven single pivot).
- Four-bar. Note that Horst link, VPP, DW-link, Maestro and split-pivot are all
  four-bars that differ only in pivot placement and which member carries the rear
  wheel and the shock. Do not write a separate solver per marketing name.

### Solver approach

Use a general numerical loop-closure solver, not hand-coded closed-form geometry
per layout. This is what lets users build arbitrary valid linkages by dragging.

- Represent the mechanism as a set of points. Some are fixed to ground, some are
  free.
- Each rigid link imposes a constraint: the distance between its two endpoints is
  constant.
- Drive the mechanism by prescribing the shock length (eyelet-to-eyelet distance)
  as the swept input parameter. Sweep it from full extension to full compression.
  This is the natural driver because shock stroke maps directly to travel, and
  leverage ratio is defined against it.
- At each step, solve the constraint system F(q) = 0 for the free point positions
  using Newton-Raphson: assemble the residual vector, compute the Jacobian, iterate
  q <- q - J^-1 F(q). The system is small (a handful of unknowns) so a basic dense
  linear solve per iteration is fine.
- Use continuation: seed each step's solve with the previous step's solution. This
  keeps the mechanism on the correct assembly branch and stops it flipping
  over-centre mid-sweep.
- Detect non-convergence explicitly. If a step fails to converge, flag that region
  of travel as invalid and surface it in the UI rather than emitting garbage curves.
  An invalid or binding linkage is a normal thing for a user to draw while playing,
  so handle it gracefully.

Sweep resolution: 100 to 200 steps across full travel is plenty and stays instant.

### Outputs of the solver

For each step across the travel, record the full solved geometry. Everything below
is derived from that.

## 6. The metrics

Each metric needs: the computed curve, and a plain-English one-liner in the UI.

- **Wheel travel**: vertical rear axle displacement from the fully extended state.
- **Leverage ratio**: derivative of wheel travel with respect to shock stroke,
  computed numerically off the solved curve. Plot it against wheel travel. This is
  the headline metric, make it the default visible curve.
- **Progressivity**: a single summary number derived from the leverage curve,
  (initial LR minus final LR) divided by initial LR, shown as a percentage. Riders
  understand "how progressive is it" more readily than reading the curve.
- **Axle path**: the locus of the rear axle point through the travel. Plot it as
  an x/y path. Show rearward versus vertical clearly.
- **Anti-squat**: requires extra inputs (see below). Implement using the standard
  instant-force-centre geometric construction. Do NOT invent a formula. Implement
  it against a documented reference (for example the construction described in the
  Pinkbike "Behind the Numbers" methodology or a kinematics textbook) and add a
  unit test that reproduces a known published anti-squat figure for a known bike,
  so we can trust it. This is the metric most sensitive to error, treat it with
  suspicion until validated.
- **Anti-rise**: same construction family as anti-squat but using the brake
  reaction line instead of the chain line. Same caution applies.
- **Pedal kickback**: chain growth through the travel (change in the chainstay
  length path from chainring to cog) converted to crank rotation in degrees.

### Extra inputs the user provides for the pedalling/braking metrics

- Chainring tooth count and cog tooth count (for the chain line).
- Approximate centre of gravity height and wheelbase, with sensible defaults and
  a note that these are estimates. Let the user leave them at default.
- Front and rear tyre radius (or a single wheel size selector: 27.5, 29, mixed).

If the user has not touched these, anti-squat and anti-rise should still render
using defaults, but the UI should gently indicate they are estimates.

## 7. Interaction (this is the actual product)

The live, draggable canvas is the whole point. Prioritise this.

- A side-on SVG view of the linkage: front triangle, links, shock, both wheels,
  ground line, pivot points as draggable handles.
- Dragging any pivot re-solves and re-plots live, ideally every frame during the
  drag, or throttled if performance needs it. The feedback loop must feel instant.
- An animation control that cycles the suspension through its travel so the user
  can watch the linkage move and the axle trace its path.
- The curve plots sit alongside the linkage view and update in lockstep.
- Show the instant centre as a visible (possibly off-bike) point, since seeing it
  move is genuinely instructive for four-bars.
- Snap-to-grid and numeric coordinate entry for any selected pivot, for users who
  want precision over dragging.
- Clear visual state when the linkage is invalid or binding.

## 8. Starter presets

Ship a small set of preset linkages so a first-time user lands on a working,
moving bike, not a blank canvas. Include at least: a single pivot, a Horst-link
four-bar, and a short-link four-bar (VPP-style). These are educational
illustrations of layout types, label them as generic examples, not as specific
branded bikes, to avoid accuracy and trademark issues.

## 9. Save, load and share

- Encode the full design (all points, links, shock mount, metric inputs) as JSON.
- Save and load via a downloadable JSON file.
- Share via URL: serialise the design into the URL hash so a rider can send their
  creation to a friend with a link, no backend needed. This is a strong growth
  feature, prioritise it.
- localStorage to auto-restore the last session.

## 10. Explicitly out of scope for v1

- A shared online library of real bike models. This is the biggest ongoing
  maintenance burden and needs a backend, accounts and data moderation. Note it as
  a future possibility in the README, do not build it.
- Photo upload and trace-the-pivots-on-an-image. Tempting, but parallax and scale
  error make it unreliable and it is a large feature on its own. Numeric and drag
  input only for v1.
- Six-bar and idler-pulley / high-pivot designs. The solver should not actively
  prevent future extension to these, but they are not v1 targets.
- Any monetisation, ads or tracking. Keep it clean and free.

## 11. Suggested build order

1. Kinematics module: data model, constraint solver, continuation, tests on a
   hand-checked four-bar. No UI.
2. Derived metrics: leverage ratio, progressivity, axle path, pedal kickback, with
   tests.
3. Anti-squat and anti-rise, validated against a published figure.
4. Static SVG render of a preset linkage.
5. Live dragging and re-solve.
6. Curve plots wired to the live geometry.
7. Travel animation and instant-centre display.
8. Metric inputs panel and plain-English explainers.
9. Save / load / URL share / localStorage.
10. Mobile and touch polish, invalid-state handling, presets.

## 12. Acceptance criteria

- A user can load the page on a phone, see a moving bike, drag a pivot, and watch
  the leverage curve change, with no instructions.
- The solver stays on the correct assembly branch through a full travel sweep on
  all presets and does not silently produce garbage when a linkage binds.
- Anti-squat for a validation bike matches a published figure within a stated
  tolerance, and that tolerance is documented.
- A shared URL reproduces an identical design on another device.
- Total deployed bundle is small enough to load fast on mobile data.
- Every metric has a one-line plain-English explanation in the UI.

## 13. Notes for the build

- Keep the kinematics module pure and tested. If the solver is right, the rest is
  a normal React app. If it is wrong, nothing downstream can be trusted.
- Favour clarity and instant feedback over feature count. A small tool that feels
  alive beats a comprehensive one that feels like data entry.
- Write the README so a curious rider understands what the tool is for, and a
  developer can run it locally and deploy it in a couple of commands.
