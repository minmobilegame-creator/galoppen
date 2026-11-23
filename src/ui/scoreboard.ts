import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Race } from '../game/race';

const SHIRTS = ['#ffd34d', '#4fc3ff', '#ff6b8b', '#b98cff'];
const COATS = ['#6b3a18', '#2a1d14', '#9a5a2c', '#e8dfcf'];

interface Lane {
  track: HTMLDivElement;
  score: HTMLSpanElement;
  lastScore: number;
  /** 0..1 af vejen fra start (højre) til mål (venstre). */
  target: number;
  shown: number;
  gallopUntil: number;
  horse?: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
}

/**
 * Scoretavlen: DOM til navne, point og græsbaner, og et lille WebGL-lærred
 * ovenpå med de animerede 3D-heste fra horse.glb.
 */
export class Scoreboard {
  private lanes: Lane[] = [];
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100, 100);
  private template: THREE.Object3D | null = null;
  private clip: THREE.AnimationClip | null = null;
  private clock = 0;

  constructor(
    private root: HTMLOListElement,
    private canvas: HTMLCanvasElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-2, 3, 4);
    this.scene.add(sun);
  }

  async loadHorse(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.template = gltf.scene;
    this.clip = gltf.animations[0] ?? null;
    this.lanes.forEach((l, i) => this.attachHorse(l, i));
  }

  build(race: Race): void {
    for (const l of this.lanes) if (l.horse) this.scene.remove(l.horse);
    this.root.innerHTML = '';
    this.lanes = race.racers.map((r, i) => {
      const li = document.createElement('li');
      li.className = 'lane' + (r.human ? ' human' : '');
      li.innerHTML = `
        <div class="tag" style="--shirt:${SHIRTS[i % SHIRTS.length]}"><span class="name">${r.name}</span><span class="score">0</span></div>
        <div class="track"></div>`;
      this.root.appendChild(li);
      const lane: Lane = {
        track: li.querySelector('.track')!,
        score: li.querySelector('.score')!,
        lastScore: 0,
        target: 0,
        shown: 0,
        gallopUntil: 0,
      };
      this.attachHorse(lane, i);
      return lane;
    });
    this.resize();
  }

  private attachHorse(lane: Lane, i: number): void {
    if (!this.template || lane.horse) return;
    const h = this.template.clone(true);
    // Hver bane får sin egen farve på rytterens trøje og hestens pels.
    h.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.name === 'Rider_Shirt') {
        m.material = mat.clone();
        (m.material as THREE.MeshStandardMaterial).color.set(SHIRTS[i % SHIRTS.length]);
      } else if (mat.name === 'Horse_Coat') {
        m.material = mat.clone();
        (m.material as THREE.MeshStandardMaterial).color.set(COATS[i % COATS.length]);
      }
    });
    h.rotation.y = -0.35; // lidt skrå, så hesten ser tredimensionel ud
    this.scene.add(h);
    lane.horse = h;
    if (this.clip) {
      lane.mixer = new THREE.AnimationMixer(h);
      const action = lane.mixer.clipAction(this.clip);
      action.play();
      // Start benene forskudt, så hestene ikke galopperer i takt.
      action.time = (i * 0.13) % this.clip.duration;
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.right = w;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  /** Kaldes når scoren ændrer sig (og ved hver frame; det er billigt). */
  update(race: Race): void {
    race.racers.forEach((r, i) => {
      const lane = this.lanes[i];
      if (!lane) return;
      lane.target = Math.min(1, r.score / race.target);
      if (r.score !== lane.lastScore) {
        lane.score.textContent = String(r.score);
        lane.score.classList.remove('bump');
        void lane.score.offsetWidth; // genstart animationen
        lane.score.classList.add('bump');
        lane.gallopUntil = this.clock + 0.4;
        lane.lastScore = r.score;
      }
    });
  }

  /** Flyt og animer hestene, og tegn lærredet. */
  frame(dt: number): void {
    this.clock += dt;
    const box = this.canvas.getBoundingClientRect();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const lane of this.lanes) {
      if (!lane.horse) continue;
      const r = lane.track.getBoundingClientRect();
      const scale = r.height * 0.46; // hesten er ca. 1,8 enheder høj
      const len = 1.85 * scale;
      const startX = r.right - box.left - len * 0.5 - 6;
      const finishX = r.left - box.left + len * 0.5 + 8;
      // Glid hen mod målet; galopér mens den bevæger sig.
      const diff = lane.target - lane.shown;
      lane.shown += reduced ? diff : diff * Math.min(1, dt * 2.2);
      const moving = Math.abs(diff) > 0.002 || this.clock < lane.gallopUntil;
      const x = startX + (finishX - startX) * lane.shown;
      const y = -(r.bottom - box.top) + 3;
      lane.horse.position.set(x, y, 0);
      lane.horse.scale.setScalar(scale);
      lane.mixer?.update(moving && !reduced ? dt * 1.1 : 0);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
