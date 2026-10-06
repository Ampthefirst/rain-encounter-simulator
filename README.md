# Rain Encounter Simulator

How many raindrops hit a person crossing a set distance in the rain, and does running help?

The app answers it two independent ways, side by side:

- **Analytic model** — closed-form equations drawn as live charts.
- **3D simulation** — a particle simulation that counts real collisions and never reads the analytic answer.

The point is that the two agree. The full specification is in [rain-sim-spec.md](rain-sim-spec.md).

## Run it

```bash
npm install
```

```bash
npm run dev
```

## Test and build

```bash
npm test
```

```bash
npm run build
```

`npm run build` writes a static site to `dist/`. It uses relative asset paths, so it works from any folder or sub-path.

## Publish to GitHub Pages

1. Push the repository to GitHub with `main` as the default branch.
2. In **Settings > Pages**, set **Source** to **GitHub Actions**.
3. Every push to `main` then runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which tests, builds and publishes the site.

## Sharing a scenario

The address bar always holds the current parameters (for example `#s=6&theta=20`), and **Copy link** copies it. Opening the link restores the scenario.

## Layout of the code

| Path | What it holds |
|---|---|
| `src/physics/` | Parameters, derived quantities and equations. Pure and DOM-free; charts and simulation both import it. |
| `src/sim/` | The particle simulation, its random generator, and the batch-trial planner and worker. |
| `src/ui/` | Controls, readout tiles, canvas charts and the Three.js visualizer. |
