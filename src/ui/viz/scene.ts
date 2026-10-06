// Three.js rendering of the simulation. Everything here is drawing only: it
// reads drop positions and hit events from the simulation and never feeds
// anything back.
//
// The scene uses the simulation's own frame and axes: the person stands at
// the origin, +x is the direction of travel, +z is up. The ground, the start
// and finish gates and the rain outside the simulated volume are cosmetic.

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Params } from '../../physics/physics';
import { FACE_IDS, type Simulation } from '../../sim/simulation';
import { readTheme, type ChartTheme } from '../charts/theme';

/** Region filled with decorative rain around the simulated volume, m. */
const AMBIENT = { minX: -14, maxX: 14, minY: -3.5, maxY: 3.5, minZ: 0, maxZ: 5 };
const AMBIENT_VOLUME =
  (AMBIENT.maxX - AMBIENT.minX) * (AMBIENT.maxY - AMBIENT.minY) * (AMBIENT.maxZ - AMBIENT.minZ);
const AMBIENT_MAX_DROPS = 12_000;
/**
 * The decorative rain is drawn at this fraction of the real density. A streak
 * on screen is far larger than a real drop, so the true density over the whole
 * view would hide the person behind a wall of lines.
 */
const AMBIENT_DENSITY_FRACTION = 0.1;
const SIM_MAX_RENDERED = 30_000;
const MAX_FLASHES = 1024;
/**
 * A drop is drawn as the path it covered over the ground in this many seconds.
 * The streak follows the drop's velocity relative to the ground, not relative
 * to the person, so rain set to fall vertically looks vertical at any walking
 * speed and the streaks lean exactly as the rain-angle control says. The drops
 * themselves still move in the person's frame, drifting back with the ground.
 */
const STREAK_SECONDS = 0.02;
const FLASH_SECONDS = 0.4;
const STRIPE_SPACING = 2;

const FACE_NORMALS: readonly (readonly [number, number, number])[] = [
  [0, 0, 1],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
];

const AMBIENT_VERTEX = /* glsl */ `
  uniform vec3 uOffset;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxSize;
  uniform vec3 uStreak;
  uniform vec3 uSimMin;
  uniform vec3 uSimMax;
  attribute float tail;
  void main() {
    vec3 head = uBoxMin + mod(position + uOffset, uBoxSize);
    // Inside the simulated volume the real drops are drawn instead.
    bool inside = all(greaterThan(head, uSimMin)) && all(lessThan(head, uSimMax));
    vec3 p = head - tail * uStreak;
    gl_Position = inside ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const AMBIENT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

const FLASH_VERTEX = /* glsl */ `
  uniform float uNow;
  uniform float uSize;
  attribute float birth;
  attribute vec3 tint;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float age = (uNow - birth) / ${FLASH_SECONDS.toFixed(2)};
    vTint = tint;
    vAlpha = 1.0 - age;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = age < 0.0 || age > 1.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
    gl_PointSize = uSize * (0.5 + age) / -mv.z;
  }
`;

const FLASH_FRAGMENT = /* glsl */ `
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vTint, vAlpha * 0.9);
  }
`;

const wrap = (value: number, size: number) => ((value % size) + size) % size;

function labelTexture(text: string, theme: ChartTheme): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = theme.text;
  ctx.beginPath();
  ctx.roundRect(4, 6, 248, 52, 10);
  ctx.fill();
  ctx.fillStyle = theme.surface;
  ctx.font = '600 32px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  return new CanvasTexture(canvas);
}

interface Gate {
  group: Group;
  label: string;
  sprite: Sprite;
}

export class RainScene {
  /** How many real drops each drawn drop stands for; 1 when every drop is drawn. */
  shownOneIn = 1;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(38, 2, 0.1, 400);
  private readonly controls: OrbitControls;

  private readonly ground: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly stripes: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly gates: Gate[] = [];
  private readonly poleMaterial = new MeshLambertMaterial();

  private readonly person: Mesh<BoxGeometry, MeshLambertMaterial>;
  private readonly personEdges: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private readonly glow: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly glowRate = new Float32Array(FACE_IDS.length);
  private readonly hitsThisFrame = new Float32Array(FACE_IDS.length);
  private readonly domainEdges: LineSegments<EdgesGeometry, LineBasicMaterial>;

  private readonly drops: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly dropPositions = new Float32Array(SIM_MAX_RENDERED * 6);
  private readonly ambient: LineSegments<BufferGeometry, ShaderMaterial>;

  private readonly flashes: Points<BufferGeometry, ShaderMaterial>;
  private readonly flashPosition = new Float32Array(MAX_FLASHES * 3);
  private readonly flashTint = new Float32Array(MAX_FLASHES * 3);
  private readonly flashBirth = new Float32Array(MAX_FLASHES).fill(-1e9);
  private flashCursor = 0;
  private flashesDirty = false;
  private readonly faceTints: Color[] = FACE_IDS.map(() => new Color());

  private clock = 0;
  private renderFraction = 1;
  private streak: readonly [number, number, number] = [0, 0, 0];
  private trip = { D: 100, s: 3 };

  /** Throws if WebGL is not available. */
  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.append(this.renderer.domElement);

    // The simulation is z-up; tell the camera before the controls read it.
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(3.4, -6, 2.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 1);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 30;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;

    // Sky light from +z (the hemisphere's axis follows its position).
    const sky = new HemisphereLight(0xffffff, 0x999999, 2.4);
    sky.position.set(0, 0, 1);
    this.scene.add(sky);
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, -4, 6);
    this.scene.add(sun);

    this.ground = new Mesh(new PlaneGeometry(600, 600), new MeshBasicMaterial());
    this.ground.position.z = -0.01;
    this.scene.add(this.ground);

    // Path markings that scroll backwards as the person advances.
    const marks: number[] = [];
    for (let x = -60; x <= 60; x += STRIPE_SPACING) marks.push(x, -1, 0, x, 1, 0);
    marks.push(-62, -1, 0, 62, -1, 0, -62, 1, 0, 62, 1, 0);
    const markGeometry = new BufferGeometry();
    markGeometry.setAttribute('position', new BufferAttribute(new Float32Array(marks), 3));
    this.stripes = new LineSegments(markGeometry, new LineBasicMaterial());
    this.scene.add(this.stripes);

    this.gates.push(this.buildGate('START'), this.buildGate('FINISH'));

    const unitBox = new BoxGeometry(1, 1, 1);
    this.person = new Mesh(unitBox, new MeshLambertMaterial());
    this.personEdges = new LineSegments(new EdgesGeometry(unitBox), new LineBasicMaterial());
    this.scene.add(this.person, this.personEdges);

    const unitPlane = new PlaneGeometry(1, 1);
    for (let i = 0; i < FACE_IDS.length; i++) {
      const plane = new Mesh(
        unitPlane,
        new MeshBasicMaterial({ transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }),
      );
      this.glow.push(plane);
      this.scene.add(plane);
    }

    this.domainEdges = new LineSegments(
      new EdgesGeometry(unitBox),
      new LineBasicMaterial({ transparent: true, opacity: 0.45 }),
    );
    this.scene.add(this.domainEdges);

    const dropGeometry = new BufferGeometry();
    const dropAttribute = new BufferAttribute(this.dropPositions, 3);
    dropAttribute.setUsage(DynamicDrawUsage);
    dropGeometry.setAttribute('position', dropAttribute);
    this.drops = new LineSegments(dropGeometry, new LineBasicMaterial({ transparent: true, opacity: 0.85 }));
    this.drops.frustumCulled = false;
    this.scene.add(this.drops);

    // Decorative rain: fixed random offsets, moved and wrapped in the shader.
    const base = new Float32Array(AMBIENT_MAX_DROPS * 6);
    const tail = new Float32Array(AMBIENT_MAX_DROPS * 2);
    for (let i = 0; i < AMBIENT_MAX_DROPS; i++) {
      const x = Math.random() * (AMBIENT.maxX - AMBIENT.minX);
      const y = Math.random() * (AMBIENT.maxY - AMBIENT.minY);
      const z = Math.random() * (AMBIENT.maxZ - AMBIENT.minZ);
      base.set([x, y, z, x, y, z], i * 6);
      tail[i * 2 + 1] = 1;
    }
    const ambientGeometry = new BufferGeometry();
    ambientGeometry.setAttribute('position', new BufferAttribute(base, 3));
    ambientGeometry.setAttribute('tail', new BufferAttribute(tail, 1));
    this.ambient = new LineSegments(
      ambientGeometry,
      new ShaderMaterial({
        vertexShader: AMBIENT_VERTEX,
        fragmentShader: AMBIENT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uOffset: { value: new Vector3() },
          uBoxMin: { value: new Vector3(AMBIENT.minX, AMBIENT.minY, AMBIENT.minZ) },
          uBoxSize: {
            value: new Vector3(
              AMBIENT.maxX - AMBIENT.minX,
              AMBIENT.maxY - AMBIENT.minY,
              AMBIENT.maxZ - AMBIENT.minZ,
            ),
          },
          uStreak: { value: new Vector3() },
          uSimMin: { value: new Vector3() },
          uSimMax: { value: new Vector3() },
          uColor: { value: new Color() },
          uOpacity: { value: 0.3 },
        },
      }),
    );
    this.ambient.frustumCulled = false;
    this.scene.add(this.ambient);

    const flashGeometry = new BufferGeometry();
    for (const [name, array, size] of [
      ['position', this.flashPosition, 3],
      ['tint', this.flashTint, 3],
      ['birth', this.flashBirth, 1],
    ] as const) {
      const attribute = new BufferAttribute(array, size);
      attribute.setUsage(DynamicDrawUsage);
      flashGeometry.setAttribute(name, attribute);
    }
    this.flashes = new Points(
      flashGeometry,
      new ShaderMaterial({
        vertexShader: FLASH_VERTEX,
        fragmentShader: FLASH_FRAGMENT,
        transparent: true,
        depthWrite: false,
        uniforms: { uNow: { value: 0 }, uSize: { value: 1 } },
      }),
    );
    this.flashes.frustumCulled = false;
    this.scene.add(this.flashes);

    this.applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    new MutationObserver(() => this.applyTheme()).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** Fit the scene to a new simulation: person size, simulated volume, rain velocity and density. */
  configure(sim: Simulation, p: Params, realDensity: number): void {
    const { box, domain } = sim;
    this.trip = { D: p.D, s: p.s };

    this.person.scale.set(p.P, p.W, p.H);
    this.person.position.set(0, 0, p.H / 2);
    this.personEdges.scale.copy(this.person.scale);
    this.personEdges.position.copy(this.person.position);

    const gap = 0.004;
    const top = this.glow[0]!;
    const front = this.glow[1]!;
    const back = this.glow[2]!;
    const left = this.glow[3]!;
    const right = this.glow[4]!;
    top.scale.set(p.P, p.W, 1);
    top.position.set(0, 0, p.H + gap);
    front.rotation.y = Math.PI / 2;
    front.scale.set(p.H, p.W, 1);
    front.position.set(p.P / 2 + gap, 0, p.H / 2);
    back.rotation.y = -Math.PI / 2;
    back.scale.set(p.H, p.W, 1);
    back.position.set(-p.P / 2 - gap, 0, p.H / 2);
    left.rotation.x = -Math.PI / 2;
    left.scale.set(p.P, p.H, 1);
    left.position.set(0, p.W / 2 + gap, p.H / 2);
    right.rotation.x = Math.PI / 2;
    right.scale.set(p.P, p.H, 1);
    right.position.set(0, -p.W / 2 - gap, p.H / 2);

    const domainVolume = (domain.maxX - domain.minX) * (domain.maxY - domain.minY) * (domain.maxZ - domain.minZ);
    this.domainEdges.scale.set(domain.maxX - domain.minX, domain.maxY - domain.minY, domain.maxZ - domain.minZ);
    this.domainEdges.position.set(
      (domain.minX + domain.maxX) / 2,
      (domain.minY + domain.maxY) / 2,
      (domain.minZ + domain.maxZ) / 2,
    );
    this.controls.target.set(0, 0, Math.min(1.2, box.maxZ * 0.6));

    // Every simulated drop is drawn unless there are too many to be useful.
    const expected = sim.density * domainVolume;
    this.renderFraction = Math.min(1, SIM_MAX_RENDERED / expected);
    this.shownOneIn = sim.weight / this.renderFraction;
    const ambientDrops = Math.min(AMBIENT_MAX_DROPS, realDensity * AMBIENT_DENSITY_FRACTION * AMBIENT_VOLUME);
    this.ambient.geometry.setDrawRange(0, 2 * Math.round(ambientDrops));

    const [vx, vy, vz] = sim.vRel;
    this.streak = [(vx + p.s) * STREAK_SECONDS, vy * STREAK_SECONDS, vz * STREAK_SECONDS];
    const u = this.ambient.material.uniforms;
    (u.uStreak!.value as Vector3).set(...this.streak);
    (u.uSimMin!.value as Vector3).set(domain.minX, domain.minY, domain.minZ);
    (u.uSimMax!.value as Vector3).set(domain.maxX, domain.maxY, domain.maxZ);

    this.glowRate.fill(0);
    this.flashBirth.fill(-1e9);
    this.flashesDirty = true;
  }

  /** Mark a hit on a face at the given point. */
  flash(face: number, x: number, y: number, z: number): void {
    this.hitsThisFrame[face]!++;
    const normal = FACE_NORMALS[face]!;
    const tint = this.faceTints[face]!;
    const i = this.flashCursor;
    this.flashCursor = (i + 1) % MAX_FLASHES;
    this.flashPosition.set([x + normal[0] * 0.012, y + normal[1] * 0.012, z + normal[2] * 0.012], 3 * i);
    this.flashTint.set([tint.r, tint.g, tint.b], 3 * i);
    this.flashBirth[i] = this.clock;
    this.flashesDirty = true;
  }

  /** Draw one frame. `realDt` is wall-clock seconds since the last frame. */
  render(sim: Simulation, realDt: number): void {
    this.clock += realDt;
    const t = sim.time;

    // Simulated drops, each a short streak along its motion.
    const shown = Math.min(SIM_MAX_RENDERED, Math.round(sim.count * this.renderFraction));
    const source = sim.positions;
    const out = this.dropPositions;
    const [sx, sy, sz] = this.streak;
    for (let i = 0; i < shown; i++) {
      const x = source[3 * i]!;
      const y = source[3 * i + 1]!;
      const z = source[3 * i + 2]!;
      const o = 6 * i;
      out[o] = x;
      out[o + 1] = y;
      out[o + 2] = z;
      out[o + 3] = x - sx;
      out[o + 4] = y - sy;
      out[o + 5] = z - sz;
    }
    this.drops.geometry.setDrawRange(0, 2 * shown);
    this.drops.geometry.attributes.position!.needsUpdate = true;

    const [vx, vy, vz] = sim.vRel;
    (this.ambient.material.uniforms.uOffset!.value as Vector3).set(
      wrap(vx * t, AMBIENT.maxX - AMBIENT.minX),
      wrap(vy * t, AMBIENT.maxY - AMBIENT.minY),
      wrap(vz * t, AMBIENT.maxZ - AMBIENT.minZ),
    );

    // World motion: the ground and gates slide back as the person advances.
    const travelled = this.trip.s * t;
    this.stripes.position.x = -wrap(travelled, STRIPE_SPACING);
    this.gates[0]!.group.position.x = -travelled;
    this.gates[1]!.group.position.x = this.trip.D - travelled;
    for (const gate of this.gates) gate.group.visible = Math.abs(gate.group.position.x) < 200;

    // Each face glows with its recent hit rate.
    const decay = Math.exp(-realDt / 0.2);
    for (let f = 0; f < FACE_IDS.length; f++) {
      this.glowRate[f] = this.glowRate[f]! * decay + this.hitsThisFrame[f]! / 0.2;
      this.hitsThisFrame[f] = 0;
      this.glow[f]!.material.opacity = 0.7 * (1 - Math.exp(-this.glowRate[f]! / 60));
    }

    if (this.flashesDirty) {
      for (const attribute of Object.values(this.flashes.geometry.attributes)) attribute.needsUpdate = true;
      this.flashesDirty = false;
    }
    this.flashes.material.uniforms.uNow!.value = this.clock;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private buildGate(label: string): Gate {
    const group = new Group();
    const pole = new BoxGeometry(0.06, 0.06, 2.4);
    for (const y of [-1.1, 1.1]) {
      const mesh = new Mesh(pole, this.poleMaterial);
      mesh.position.set(0, y, 1.2);
      group.add(mesh);
    }
    const line = new Mesh(new PlaneGeometry(0.25, 2.2), this.poleMaterial);
    line.position.z = 0.005;
    group.add(line);
    const sprite = new Sprite(new SpriteMaterial({ depthWrite: false }));
    sprite.scale.set(1.8, 0.45, 1);
    sprite.position.z = 2.75;
    group.add(sprite);
    this.scene.add(group);
    return { group, label, sprite };
  }

  private applyTheme(): void {
    const theme = readTheme();
    const surface = new Color(theme.surface);
    this.scene.background = surface;
    this.ground.material.color.copy(surface).lerp(new Color(theme.text), theme.dark ? 0.05 : 0.04);
    this.stripes.material.color.set(theme.axis);
    this.poleMaterial.color.set(theme.muted);
    this.person.material.color.set(theme.dark ? '#77766f' : '#c9c8c1');
    this.personEdges.material.color.set(theme.textSecondary);
    this.domainEdges.material.color.set(theme.muted);

    const rain = new Color(theme.dark ? '#9ec5f4' : '#1c5cab');
    this.drops.material.color.copy(rain);
    (this.ambient.material.uniforms.uColor!.value as Color).copy(rain);

    FACE_IDS.forEach((id, f) => {
      const color = new Color(theme.faces[id === 'left' || id === 'right' ? 'side' : id]);
      this.glow[f]!.material.color.copy(color);
      // Impact marks are a lighter tint so they show against the glowing face.
      this.faceTints[f]!.copy(color).lerp(new Color('#ffffff'), 0.55);
    });

    for (const gate of this.gates) {
      gate.sprite.material.map?.dispose();
      gate.sprite.material.map = labelTexture(gate.label, theme);
      gate.sprite.material.needsUpdate = true;
    }
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Impact marks are about 9 cm across at any distance.
    const pixels = height * this.renderer.getPixelRatio();
    this.flashes.material.uniforms.uSize!.value = (0.09 * pixels) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }
}
