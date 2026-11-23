import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BALL_HOMES, BALL_R, FIELD, HAND_LIMIT_Y, HOLES, type Hole } from '../game/layout';
import { stoppingDistance, type Ball, type World } from '../game/physics';

/** Bordets 2D-punkt (x, y) -> Three.js (x, højde, -y). glTF-eksporten er Y-op. */
export const toWorld = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

const HOLE_COLORS: Record<Hole['color'], number> = { yellow: 0xffd400, blue: 0x4060ff, red: 0xff1830 };
/** Hullerne gløder svagt hele tiden og blusser op ved point. */
const HOLE_GLOW = 0.35;

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

  private ballMeshes: THREE.Mesh[] = [];
  private ballShadows: THREE.Mesh[] = [];
  private aimLine: THREE.Line;
  private handZone: THREE.Mesh;
  private handEdge: THREE.Line;
  private cursor: THREE.Mesh;
  private holeFlash = new Map<string, { mat: THREE.MeshStandardMaterial; t: number }>();
  private raycaster = new THREE.Raycaster();
  private tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral tone mapping bevarer farverne fra Blender bedre end ACES.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;

    this.addLights();
    this.aimLine = this.makeAimLine();
    [this.handZone, this.handEdge] = this.makeHandZone();
    this.cursor = this.makeCursor();
  }

  /* ------------------------------------------------------------- opsætning */

  /** Indlæs bræt, huller og kugle (glTF fra Blender) fra mappen `base`. */
  async loadModels(base: string): Promise<void> {
    const loader = new GLTFLoader();
    const [board, holes, ball] = await Promise.all(
      ['board.glb', 'holes.glb', 'ball.glb'].map((f) => loader.loadAsync(base + f)),
    );

    board.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.receiveShadow = true;
      m.castShadow = m.name.startsWith('Rail');
    });

    holes.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.receiveShadow = true;
      m.castShadow = m.name.startsWith('Rim');
      const hole = HOLES.find((h) => h.id === m.name);
      if (hole) {
        // Egen materialekopi pr. hul, så det kan lyse op, når der scores.
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.emissive = new THREE.Color(HOLE_COLORS[hole.color]);
        mat.emissiveIntensity = HOLE_GLOW;
        m.material = mat;
        this.holeFlash.set(hole.id, { mat, t: 0 });
      }
    });

    this.scene.add(board.scene, holes.scene);

    let ballMesh: THREE.Mesh | null = null;
    ball.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) ballMesh = o as THREE.Mesh;
    });
    if (!ballMesh) throw new Error('ball.glb indeholder ingen mesh');
    this.addBalls(ballMesh);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a1440, 0.35));
    // Et varmt spotlys over pointfeltet giver dybde: lyst ved hullerne, mørkere ved spilleren.
    const spot = new THREE.SpotLight(0xfff0d0, 40, 14, 0.55, 0.9, 1.5);
    spot.position.set(0, 7, -1);
    spot.target.position.copy(toWorld(0, 2.6, 0));
    this.scene.add(spot, spot.target);
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(-3, 9, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -3;
    c.right = 3;
    c.top = 5;
    c.bottom = -5;
    c.near = 1;
    c.far = 25;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    // Varme lyspærer langs siderne, som i en tivoli-bod.
    for (const side of [-1, 1]) {
      const p = new THREE.PointLight(0xffb060, 3, 9, 2);
      p.position.set(side * 2.6, 1.6, -1.5);
      this.scene.add(p);
    }
  }

  /** To kugler ud fra modellen i ball.glb (radius 0,15 m som i fysikken). */
  private addBalls(template: THREE.Mesh): void {
    const geo = template.geometry;
    const mat = template.material as THREE.MeshStandardMaterial;
    if (mat.map) mat.map.anisotropy = 8;
    const shadowGeo = new THREE.CircleGeometry(BALL_R * 1.15, 32).rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
    BALL_HOMES.forEach((h) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.position.copy(toWorld(h.x, h.y, BALL_R));
      m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      this.scene.add(m);
      this.ballMeshes.push(m);
      const s = new THREE.Mesh(shadowGeo, shadowMat);
      s.position.y = 0.004;
      s.visible = false;
      this.scene.add(s);
      this.ballShadows.push(s);
    });
  }

  private makeAimLine(): THREE.Line {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const mat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.renderOrder = 5;
    this.scene.add(line);
    return line;
  }

  private makeHandZone(): [THREE.Mesh, THREE.Line] {
    const h = HAND_LIMIT_Y - FIELD.yMin;
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD.xMax - FIELD.xMin, h).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
    );
    zone.position.copy(toWorld(0, FIELD.yMin + h / 2, 0.006));
    this.scene.add(zone);
    const edge = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        toWorld(FIELD.xMin, HAND_LIMIT_Y, 0.008),
        toWorld(FIELD.xMax, HAND_LIMIT_Y, 0.008),
      ]),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.14, gapSize: 0.08, transparent: true, opacity: 0.5 }),
    );
    edge.computeLineDistances();
    this.scene.add(edge);
    return [zone, edge];
  }

  private makeCursor(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.2, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    ring.visible = false;
    this.scene.add(ring);
    return ring;
  }

  /* ------------------------------------------------------------- kamera */

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Skrå vinkel fra spillerens ende; find afstanden, så hele bordet er i billedet.
    const target = toWorld(0, 0.2, 0);
    const dir = new THREE.Vector3(0, 0.82, 0.57).normalize();
    const corners = [-1.62, 1.62].flatMap((x) => [-4.12, 4.12].map((y) => toWorld(x, y, 0.2)));
    let lo = 2;
    let hi = 40;
    for (let i = 0; i < 30; i++) {
      const d = (lo + hi) / 2;
      this.camera.position.copy(target).addScaledVector(dir, d);
      this.camera.lookAt(target);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
      const fits = corners.every((c) => {
        const p = c.clone().project(this.camera);
        return Math.abs(p.x) < 0.94 && Math.abs(p.y) < 0.94;
      });
      if (fits) hi = d;
      else lo = d;
    }
    this.camera.position.copy(target).addScaledVector(dir, hi);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  /** Skærmpunkt (clientX/Y) -> punkt på bordet i 2D, eller null. */
  pickTable(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.tablePlane, hit)) return null;
    return { x: hit.x, y: -hit.z };
  }

  /** Bordpunkt -> skærmpunkt i pixels relativt til lærredet. */
  toScreen(x: number, y: number, h = 0): { x: number; y: number } {
    const p = toWorld(x, y, h).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - p.y) / 2) * this.canvas.clientHeight };
  }

  /* ------------------------------------------------------------- opdatering */

  flashHole(id: string): void {
    const f = this.holeFlash.get(id);
    if (f) f.t = 1;
  }

  setCursor(p: { x: number; y: number } | null, active: boolean): void {
    this.cursor.visible = !!p;
    if (p) this.cursor.position.copy(toWorld(p.x, p.y, 0.01));
    (this.cursor.material as THREE.MeshBasicMaterial).opacity = active ? 0.9 : 0.45;
  }

  setAim(ball: Ball | null, vx: number, vy: number): void {
    const s = Math.hypot(vx, vy);
    if (!ball || s < 0.15 || vy <= 0) {
      this.aimLine.visible = false;
      return;
    }
    const len = Math.min(stoppingDistance(s), 7.5);
    const a = toWorld(ball.x, ball.y, 0.02);
    const b = toWorld(ball.x + (vx / s) * len, ball.y + (vy / s) * len, 0.02);
    this.aimLine.geometry.setFromPoints([a, b]);
    this.aimLine.computeLineDistances();
    this.aimLine.visible = true;
  }

  update(world: World, dt: number, holding: boolean): void {
    if (this.ballMeshes.length) {
      world.balls.forEach((b, i) => this.updateBall(b, this.ballMeshes[i], this.ballShadows[i], world));
    }

    // Hånd-zonen lyser svagt op, mens man holder en kugle.
    const zm = this.handZone.material as THREE.MeshBasicMaterial;
    zm.opacity += ((holding ? 0.1 : 0.03) - zm.opacity) * Math.min(1, dt * 8);
    const em = this.handEdge.material as THREE.LineDashedMaterial;
    em.opacity = holding ? 0.95 : 0.5;
    em.color.set(holding ? 0xffe27a : 0xffffff);

    for (const f of this.holeFlash.values()) {
      if (f.t > 0) f.t = Math.max(0, f.t - dt * 0.9);
      f.mat.emissiveIntensity = HOLE_GLOW + f.t * f.t * 3;
    }
  }

  private updateBall(b: Ball, m: THREE.Mesh, shadow: THREE.Mesh, world: World): void {
    const p = world.params;
    let x = b.x;
    let y = b.y;
    let h = BALL_R;
    m.visible = true;
    m.scale.setScalar(1);

    if (b.state === 'held') {
      h = BALL_R + 0.06; // løftet en smule i hånden
    } else if (b.state === 'sinking') {
      const k = Math.min(1, b.t / p.sinkTime);
      h = BALL_R - k * k * 0.3;
      m.scale.setScalar(1 - k * 0.35);
      m.visible = k < 0.98;
    } else if (b.state === 'returning') {
      // Usynlig under bordet, så ruller den ind fra siden til sin startplads.
      const k = b.t / p.returnTime;
      const home = BALL_HOMES[b.id % BALL_HOMES.length];
      if (k < 0.55) {
        m.visible = false;
      } else {
        const u = (k - 0.55) / 0.45;
        const e = 1 - (1 - u) * (1 - u);
        const fromX = home.x < 0 ? FIELD.xMin + BALL_R : FIELD.xMax - BALL_R;
        x = fromX + (home.x - fromX) * e;
        y = home.y;
      }
    }

    const prev = m.position.clone();
    m.position.copy(toWorld(x, y, h));

    // Rul: drej om aksen vinkelret på bevægelsen, vinkel = strækning / radius.
    const d = m.position.clone().sub(prev);
    d.y = 0;
    const dist = d.length();
    if (dist > 1e-5 && dist < 1) {
      const axis = new THREE.Vector3(d.z, 0, -d.x).normalize();
      m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / BALL_R));
    }

    shadow.visible = b.state === 'held';
    if (shadow.visible) shadow.position.set(m.position.x + 0.03, 0.004, m.position.z + 0.02);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
