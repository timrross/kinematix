# Kinematix — MTB Suspension Playground

A free, browser-based playground for designing and *understanding* mountain-bike
rear suspension. Drag a pivot, watch the leverage curve change in real time, and
start to feel why suspension behaves the way it does.

No account. No backend. Works on a phone. Works offline once loaded.

**▶ Live demo: <https://timrross.github.io/kinematix/>**

> **Who it's for:** curious riders, not engineers. You've heard "leverage ratio"
> and "anti-squat" but couldn't define them — that's exactly the point. Every
> number has a one-line plain-English explanation right next to it.

## What you can do

- **Drag any pivot** on a side-on view of the bike and watch the whole mechanism
  re-solve live — the leverage curve, axle path, anti-squat and friends all
  update in lockstep.
- **Play the travel animation** to watch the linkage move through its stroke and
  the axle trace its path.
- **See the instant centre** — the invisible point the rear end pivots about —
  move as the suspension cycles. This is the thing that makes four-bars click.
- **Start from a preset**: a single pivot, a Horst-link four-bar, and a
  short-link (VPP-style) four-bar — generic illustrations of layout *types* — plus
  one hand-digitised real bike (a 170 mm Horst-link enduro). The real one is a
  **reverse-engineered estimate** derived from a publicly-shared side-profile
  trace, not official manufacturer geometry; it's labelled as such in the app.
  Reassuringly, it converges across full travel and lands on realistic numbers
  (~170 mm travel, ~90% anti-squat at sag), which is a nice real-world check on
  the solver.
- **Tune precisely** with snap-to-grid and numeric coordinate entry.
- **Share your creation** with a link — the whole design rides along in the URL,
  no server involved — or save/load it as a JSON file. Your last session is
  auto-restored.
- **Start fresh** with *New* (a clean single-pivot skeleton to shape from
  scratch), or **import a trace**: *Load* also accepts
  [BiKinematics](https://github.com/mark-bak/BiKinematics) side-profile traces
  and converts them automatically (units, axes, gearing and all), so any bike
  someone has digitised drops straight in as a — clearly-flagged — estimate.
- **Build a whole new linkage** in *Build* mode — a distinct, blueprint-styled
  topology editor. Add and link pivots, assign roles (axle, bottom bracket,
  shock), and watch a live degrees-of-freedom readout until you have a solvable
  1-DOF mechanism, at which point the metrics light up. You can also **load a
  bike photo and trace the pivots over it**, calibrating the scale against a
  known length (the result is an estimate — photos have perspective error).
  Undo/redo throughout (⌘/Ctrl-Z).

## The metrics, in plain English

| Metric | What it tells you |
| --- | --- |
| **Leverage ratio** | How far the wheel moves for each millimetre the shock moves. Higher feels softer; lower feels firmer. |
| **Progressivity** | How much firmer the suspension gets deep in its travel. More progressive resists bottoming out. |
| **Axle path** | The route the rear axle takes as it moves up. A rearward path soaks up square-edged bumps. |
| **Anti-squat** | How much the chain and linkage resist the bike squatting under power. ~100% stays level. |
| **Anti-rise** | How much the linkage resists the rear settling/lifting when you brake. |
| **Pedal kickback** | How much the pedals get tugged back as the suspension compresses and the chain has to stretch around the moving axle. |

## How it works (the honest version)

The heart of the tool is a small, pure kinematics module (`src/kinematics`, zero
React) that anyone can read and test:

- A rear suspension is modelled as a **2D set of points** joined by rigid links
  plus one shock. There is deliberately *no* notion of "this is a Horst link" in
  the code — single pivot, Horst link, VPP, DW-link, Maestro and split-pivot are
  all just different point and link placements through the **same solver**.
- The mechanism is driven by **prescribing the shock length** and solving the
  loop-closure constraints `F(q) = 0` with **Newton–Raphson** (analytic
  Jacobian, small dense linear solve). Each step of the travel sweep is seeded
  from the previous one (**continuation**) so the linkage stays on the correct
  assembly branch and doesn't flip over-centre.
- If a linkage **binds** or can't be solved, that's surfaced clearly rather than
  drawn as garbage — drawing a broken linkage while playing is normal.

Everything you see is derived from that solved sweep. The solver is unit-tested
(including an independent closed-form four-bar cross-check and a single-pivot
arc invariant), and **anti-squat is validated** against the documented
instant-force-centre construction — see *Accuracy* below.

## Accuracy & caveats

This is a **playground for intuition, not a professional engineering tool.**

- **Anti-squat / anti-rise** use the standard geometric *instant-force-centre*
  construction (the chain force line and the rear axle–instant-centre line; the
  anti-squat line from the rear contact patch, measured at the front-axle
  vertical, divided by centre-of-gravity height). The implementation is
  validated to floating-point precision against the canonical **100% definition**
  and the documented **inverse-CoG-height scaling law** in
  `src/kinematics/antisquat.test.ts`. We do *not* claim to reproduce a specific
  branded bike's published figure, because the pivot coordinates of real bikes
  aren't public — instead the construction itself is anchored to the published
  definition, and the presets are checked to fall in the plausible band real
  bikes occupy.
- **Anti-squat and anti-rise depend on rider/bike estimates** (centre-of-gravity
  height, wheelbase, gearing). Until you edit those inputs, the UI flags these
  two metrics as *estimates*.
- Presets are **generic educational examples**, deliberately not branded bikes.

## Run it locally

Requirements: Node 18+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test           # run the kinematics unit tests (Vitest)
npm run typecheck  # TypeScript, no emit
npm run build      # production build to dist/
npm run preview    # serve the production build locally
```

## Deploy (free static hosting)

The build is fully static and uses a relative base path, so it drops onto any
host with no per-host configuration. The whole app is a single small bundle
(well under 200 kB, ~60 kB gzipped) so it loads fast on mobile data and runs
offline once cached.

**GitHub Pages (automated, this repo).** A workflow at
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds the app and
publishes `dist/` to Pages on every push to `main` (and on manual *Run workflow*
dispatch). One-time setup in the repo: **Settings → Pages → Build and deployment
→ Source → GitHub Actions**. After that, pushing to `main` deploys to
<https://timrross.github.io/kinematix/>.

**Anywhere else.** Run `npm run build` and serve the resulting `dist/` folder:

- **Netlify / Vercel / Cloudflare Pages**: point them at the repo; build command
  `npm run build`, publish directory `dist`.
- **Any static server**: copy `dist/` to the document root.

Routing is hash-based (share links live in `location.hash`), so no SPA
rewrite/fallback rule is needed — a plain static server is enough.

## Project layout

```
src/
  kinematics/      Pure, framework-agnostic solver + metrics (unit-tested)
    model.ts         Data model (points, links, shock, design)
    linalg.ts        Tiny dense linear solver
    solver.ts        Newton–Raphson loop-closure solver
    sweep.ts         Travel sweep with continuation + binding detection
    metrics.ts       Travel, leverage, progressivity, axle path, kickback, IC
    antisquat.ts     Anti-squat / anti-rise instant-force-centre construction
    presets.ts       Single pivot, Horst-link, short-link starter designs
    *.test.ts        Vitest unit tests
  geometry/        World↔screen transform for the linkage view
  state/           Zustand store + derived (sweep/metrics) memo
  persistence/     JSON save/load, URL-hash share, localStorage
  components/      React + SVG UI (LinkageView, Plot, panels, controls)
```

The `kinematics` module imports nothing from React on purpose: if the solver is
right, the rest is a normal React app; if it were wrong, nothing downstream could
be trusted.

## Roadmap / out of scope for v1

Intentionally **not** built yet (and noted here so the scope stays honest):

- A shared online library of real bike models (needs a backend, accounts and
  moderation — the biggest ongoing maintenance burden).
- Six-bar and idler-pulley / high-pivot designs. The solver is general enough not
  to actively prevent these later, but they aren't v1 targets.

No ads, no tracking, no monetisation. Just a clean, free tool.

## Licence

MIT — see [LICENSE](LICENSE). Contributions welcome.
