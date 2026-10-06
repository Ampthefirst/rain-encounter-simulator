# Rain Encounter Simulator — build spec

## What this is

A single-page web app that answers "how many raindrops hit a person crossing a set distance in the rain?" two independent ways, side by side:

1. **Analytic panel** — closed-form equations drawn as live charts that redraw as parameters change.
2. **3D visualizer** — a particle simulation of the same scenario that the user can play, with a live hit counter.

The point of the app is that the two agree. The simulation must never read the analytic answer; it counts real collisions, and its count should land on the analytic prediction within statistical noise. That agreement is the main acceptance test, so treat it as the hardest and most important part of the build. It was started as a friendly argument between two people, so it should be fun to play with and easy to share as a link.

## Physical model

Rain is a uniform random (Poisson) field of identical drops with number density `n` (drops/m³), all moving at the same constant velocity. The person is an upright box moving in a straight line at constant speed. No splashing, no drop-drop interaction, no gusts.

Coordinates: +x is the person's direction of travel, +z is up, y is sideways.

### Inputs

| Group | Parameter | Symbol | Default | Range |
|---|---|---|---|---|
| Trip | Distance | `D` | 100 m | 5 – 1000 |
| Trip | Speed | `s` | 3 m/s | 0.3 – 12 |
| Trip | Time to destination | `T = D/s` | derived | editable; editing it sets `s` |
| Rain | Rainfall rate | `R` | 10 mm/h | 0.5 – 100 |
| Rain | Drop diameter | `d` | 2 mm | 0.5 – 5 |
| Rain | Fall speed (vertical) | `v_t` | auto from `d` | 1 – 10 m/s when overridden |
| Wind | Rain angle from vertical | `θ` | 0° | −60° … +60° |
| Wind | Crosswind heading | `φ` | 0° | 0° – 90° (advanced, collapsed) |
| Person | Height, width, depth | `H, W, P` | 1.75, 0.5, 0.25 m | sensible human-ish ranges |

Speed presets: walk 1.4, jog 3, run 6, sprint 9 m/s. Rain presets: drizzle 1, moderate 5, heavy 20, downpour 50 mm/h. Show speeds in m/s with a km/h and mph readout.

Sign convention for `θ`: **positive = tailwind** (rain drifting the same way the person is moving, hitting their back if they are slow), **negative = headwind**. Label the slider ends "into the rain" and "rain at your back" so nobody has to remember the sign.

### Derived quantities

- Auto fall speed (Atlas et al. 1973 fit to the Gunn–Kinzer data, `d` in mm): `v_t = 9.65 − 10.3·exp(−0.6·d)` m/s. A toggle lets the user override it.
- Drop volume: `V_d = π·d³/6`.
- Number density from rainfall rate: `n = R / (V_d · v_t)` with `R` in m/s. Also display mean drop spacing `n^(−1/3)`, since that is the intuitive "how sparse is the rain" number.
- Wind adds horizontal drift without changing vertical speed: horizontal drift speed `w = v_t·tan θ`, split into `w_x = w·cos φ` (along travel) and `w_y = w·sin φ` (sideways).
- Face areas: `A_top = W·P`, `A_front = W·H`, `A_side = P·H`.

### Equations

Work in the person's frame, where rain moves at `v_rel = (w_x − s, w_y, −v_t)`. The hit rate on each face is density × face area × the relative speed normal to that face:

```
rate_top   = n · A_top   · v_t
rate_front = n · A_front · max(0, s − w_x)     (rain meets the chest)
rate_back  = n · A_front · max(0, w_x − s)     (rain catches the back)
rate_side  = n · A_side  · |w_y|
N = (rate_top + rate_front + rate_back + rate_side) · D / s
```

Also report: standard deviation `√N` (hits are Poisson), water collected `N·V_d` in mL, and the optimum speed:

- If `w_x > 0` and `A_front·w_x > A_top·v_t + A_side·|w_y|`: the best speed is exactly `s* = w_x` (match the rain's drift so nothing hits front or back); going faster than that makes it worse.
- Otherwise: faster is always better, with diminishing returns toward a floor of `n·D·A_front` as `s → ∞` (at infinite speed only the front face sweeps up drops).

Reference values for unit tests (defaults, `θ = 0` unless noted): `v_t ≈ 6.55 m/s`, `n ≈ 101.3 /m³`, spacing ≈ 0.215 m. `N` at s = 1.4 / 3 / 6 / 10 m/s ≈ 14,783 / 11,625 / 10,243 / 9,691. With `θ = +20°`: 12,144 / 4,585 / 6,724 / 7,579, and the optimum is `s* ≈ 2.383 m/s` with `N ≈ 3,478`. With `θ = −20°`: 29,868 / 18,665 / 13,763 / 11,803.

## Analytic panel

Four 2D charts in a 2×2 grid. No 3D surface plots: a heatmap carries the two-variable picture more legibly, and the 3D budget belongs to the visualizer. Every chart marks the current parameter state and redraws live as sliders move.

1. **Total hits vs speed** (the headline chart). Stacked areas for top / front / back / side so the user sees which face dominates, a marker at the current speed, a marker at the optimum if one exists, and a dashed line at the floor value. Completed simulation runs are plotted on this chart as points with ±√N bars.
2. **Hit rate (drops per second) vs speed.** The counterpoint: running raises the rate while lowering the total.
3. **Total hits vs rain angle** at the current speed, across the full angle range.
4. **Heatmap of total hits over speed × angle**, with the optimum-speed ridge drawn on it and a crosshair at the current state.

Above the charts, a row of readout tiles: predicted hits ± σ, simulated hits (live), water collected, trip time, optimum speed, and "vs walking" (ratio of `N` at the current speed to `N` at 1.4 m/s). Distance scales everything linearly, so it gets a tile and no chart.

## 3D visualizer

Three.js. The camera follows the person, the ground scrolls beneath them, and start and finish markers show progress. Drops render as short streaks aligned with their motion. A hit produces a brief flash on the face that was struck, coloured by face to match the chart's stack colours. Controls: play / pause / reset, a time-scale slider (0.1× – 10×), and orbit/zoom. Show the live total and per-face counts alongside the prediction as the run progresses.

A **"Run 100 trials"** button runs the same simulation headless (no rendering, as fast as possible) and reports the mean ± standard deviation next to the analytic value. This is the most convincing thing the app can show, so make it prominent.

### Simulation correctness

These are the places a rain simulation usually goes quietly wrong. The exact scheme is your call as long as the acceptance tests pass.

- **One physics module.** A pure, DOM-free module holds the parameters, derived quantities and equations. Charts and simulation both import it. The simulation uses the derived inputs (`n`, `v_rel`, box dimensions) and nothing from the analytic totals.
- **Simulate in the person's frame.** The person box is fixed at the origin and every drop moves at the constant `v_rel`. The rendered world motion is cosmetic.
- **Swept collision.** Drops move ~10 cm per frame at 60 fps, enough to tunnel through box edges. Test each drop's movement segment for the step against the box (slab test), and record which face it entered.
- **Fixed timestep.** Step the simulation on a fixed `dt` accumulator so the count does not depend on frame rate or the time-scale slider.
- **Keep the density uniform.** Simulate a domain box around the person with a margin. One workable scheme: when a drop leaves through a face, re-enter it on the opposite face with the two transverse coordinates re-randomised. A drop that hits the person is deactivated until its next re-entry rather than respawned in place; otherwise the "shadow" behind the person either refills instantly (overcount) or wraps around depleted (undercount). Drops that start inside the person box are discarded, not counted.
- **Initial state is random.** Seed drops uniformly through the domain with a Poisson-distributed count, and use a seedable RNG so tests are reproducible.
- **Extreme densities.** Small drops at high rainfall rates give hundreds of thousands of drops per m³. Set a drop budget; above it, simulate a thinned sample where each simulated drop counts as `k` real ones, and say so in the UI. Rendering may show fewer drops than are simulated, but counting always uses all simulated drops.

## Layout

One screen at 1080p without scrolling: parameter sliders in a left sidebar grouped as Trip / Rain / Wind / Person; the visualizer top-right with the readout tiles; the 2×2 charts beneath it. On narrow screens the sections stack. Light and dark themes.

## Stack

Vite + TypeScript, Three.js, Vitest. Chart library is your choice; prefer something light, and a plain canvas is fine for the heatmap. The build output must be a static site that can go on GitHub Pages.

## Milestones

Stop after each milestone, summarise what was built and what the tests show, and wait for review.

1. **Physics module + tests.** Equations and derived quantities, with unit tests against the reference values above.
2. **Headless simulation + agreement tests.** No UI. For at least six scenarios (vertical rain; headwind; tailwind with the person slower than the drift, at the drift speed, and faster; a crosswind case), the mean of 200+ seeded trials must be within 2% of the analytic `N`, per face as well as in total. Add a test that halving `dt` does not change the mean. Use short distances or lower densities to keep tests fast. Do not move on until these pass.
3. **Controls, readout tiles and charts.**
4. **3D visualizer** wired to the same simulation core, plus the batch-trials button and the simulated points on chart 1.
5. **Polish**: presets, units, themes, responsive layout, GitHub Pages build.

## Out of scope for now

Non-box body shapes, forward lean while running, a distribution of drop sizes, gusting or time-varying wind, splashes, umbrellas. Keep the physics module shaped so body shape could be swapped later, but do not build these.
