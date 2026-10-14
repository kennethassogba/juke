import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const COLORS = ['#86cfff', '#ff9566', '#f28cc6'];
const SURFACE = 1.35;
const WORLD = 10;

function material(color, properties = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .38, metalness: .35, ...properties });
}

function box(parent, dimensions, position, mat, radius = .08) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(...dimensions, 3, radius), mat);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, radius, height, y, mat, topRadius = radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(topRadius, radius, height, 48), mat);
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function ring(parent, radius, thickness, y, color) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 8, 64),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = y;
  parent.add(mesh);
  return mesh;
}

function paddle(scene, color) {
  const group = new THREE.Group();
  const polymer = new THREE.MeshPhysicalMaterial({ color, roughness: .4, metalness: .08, clearcoat: .3, clearcoatRoughness: .35 });
  const chrome = material('#b5c0d3', { roughness: .34, metalness: .65 });
  cylinder(group, .69, .16, .10, chrome);
  cylinder(group, .63, .18, .19, polymer, .59);
  cylinder(group, .24, .34, .42, polymer, .20);
  cylinder(group, .31, .13, .62, polymer, .28);
  ring(group, .60, .016, .29, color);
  const cap = new THREE.Mesh(new THREE.CircleGeometry(.20, 32), material('#242937', { metalness: .1, roughness: .8 }));
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = .69;
  group.add(cap);
  group.position.y = SURFACE;
  scene.add(group);
  return group;
}

function surfaceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#16223b';
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.fillStyle = 'rgba(177,201,236,.13)';
  for (let x = 20; x < 1024; x += 22) for (let y = 20; y < 1024; y += 22) {
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(168,196,240,.32)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 512); ctx.lineTo(1024, 512); ctx.stroke();
  ctx.beginPath(); ctx.arc(512, 512, 138, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(168,196,240,.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, 976, 976);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function environment() {
  const faces = Array.from({ length: 6 }, (_, index) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#192034'; ctx.fillRect(0, 0, 128, 128);
    const light = ctx.createLinearGradient(0, 0, 128, 128);
    light.addColorStop(0, index === 2 ? '#ffffff' : '#7089b7');
    light.addColorStop(.35, '#344463'); light.addColorStop(1, '#090b14');
    ctx.fillStyle = light; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#e8eeff'; ctx.fillRect(18, 10, 14, 96);
    ctx.fillRect(91, 30, 8, 65);
    return canvas;
  });
  const map = new THREE.CubeTexture(faces);
  map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true;
  return map;
}

export class Arena3D {
  constructor(canvas, reducedMotion) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.renderer = this.makeRenderer(canvas);
    this.scene = new THREE.Scene();
    // Transparent outside the rink lets the mobile scores sit behind the table.
    this.scene.background = null;
    this.scene.fog = new THREE.Fog('#ffffff', 24, 65);
    this.scene.environment = environment();
    this.camera = new THREE.PerspectiveCamera(36, 1, .1, 100);
    this.replayCamera = new THREE.PerspectiveCamera(36, .8, .1, 100);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE);
    this.intersection = new THREE.Vector3();
    this.scene.add(new THREE.HemisphereLight('#d6e3ff', '#151520', 2.2));
    const key = new THREE.DirectionalLight('#ffffff', 4.1);
    key.position.set(-6, 14, 5); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 35 });
    key.shadow.bias = -.0006; key.shadow.normalBias = .035;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#91bfff', 2.5);
    rim.position.set(8, 6, -6); this.scene.add(rim);
    const warm = new THREE.DirectionalLight('#ffbba0', .65);
    warm.position.set(-8, 3, -3); this.scene.add(warm);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShadowMaterial({ opacity: .18 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const cabinet = material('#171b28', { roughness: .5, metalness: .35 });
    box(this.scene, [10.65, .82, 10.65], [0, .83, 0], cabinet, .22);
    box(this.scene, [10.3, .15, 10.3], [0, 1.29, 0], material('#2f3d58', { metalness: .8, roughness: .22 }), .09);
    for (const x of [-3.7, 3.7]) for (const z of [-3.7, 3.7]) {
      box(this.scene, [.85, .68, .85], [x, .32, z], material('#171a23', { metalness: .8 }), .1);
    }
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshPhysicalMaterial({
      map: surfaceTexture(), roughness: .6, metalness: .12, clearcoat: .25, clearcoatRoughness: .5,
    }));
    surface.rotation.x = -Math.PI / 2; surface.position.y = SURFACE;
    surface.receiveShadow = true; this.scene.add(surface);
    const rail = material('#a9b6cc', { roughness: .35, metalness: .6 });
    const trim = new THREE.MeshBasicMaterial({ color: '#d4e0ff', toneMapped: false });
    for (const side of [-1, 1]) for (const part of [-1, 1]) {
      box(this.scene, [.25, .36, 3.76], [side * 5.12, 1.55, part * 3.13], rail, .06);
      box(this.scene, [3.76, .36, .25], [part * 3.13, 1.55, side * 5.12], rail, .06);
      box(this.scene, [.026, .025, 3.72], [side * 5.00, 1.72, part * 3.13], trim, .008);
      box(this.scene, [3.72, .025, .026], [part * 3.13, 1.72, side * 5.00], trim, .008);
    }
    const goals = [
      { x: -5.12, z: 0, rotation: Math.PI / 2, color: COLORS[0] },
      { x: 0, z: -5.12, rotation: 0, color: COLORS[1] },
      { x: 5.12, z: 0, rotation: Math.PI / 2, color: COLORS[2] },
      { x: 0, z: 5.12, rotation: 0, color: '#edf2ff' },
    ];
    for (const goal of goals) {
      const group = new THREE.Group(); group.position.set(goal.x, 1.28, goal.z); group.rotation.y = goal.rotation;
      box(group, [2.47, .15, .54], [0, -.13, 0], material('#05060a', { roughness: 1 }), .03);
      box(group, [2.47, .08, .08], [0, .06, .18], new THREE.MeshBasicMaterial({ color: goal.color, toneMapped: false }), .02);
      box(group, [2.47, .17, .13], [0, -.27, .28], material(goal.color, { emissive: goal.color, emissiveIntensity: .45 }), .02);
      this.scene.add(group);
      const light = new THREE.PointLight(goal.color, 2, 5, 2);
      light.position.set(goal.x, 1.8, goal.z); this.scene.add(light);
    }
    this.player = paddle(this.scene, '#eaf1ff');
    this.bots = COLORS.map(color => paddle(this.scene, color));
    this.puck = new THREE.Group(); this.puck.position.y = SURFACE;
    cylinder(this.puck, .26, .13, .08, material('#141720', { metalness: .7, roughness: .19 }));
    ring(this.puck, .245, .018, .145, '#edf3ff'); this.scene.add(this.puck);
    this.bumpers = [[.34, .46], [.66, .54]].map(([x, y]) => {
      const group = new THREE.Group(); group.position.set((x - .5) * WORLD, SURFACE, (y - .5) * WORLD);
      cylinder(group, .46, .24, .12, material('#ffb36b', { roughness: .3, metalness: .5 }), .40);
      cylinder(group, .31, .16, .3, material('#242938', { metalness: .8, roughness: .15 }));
      ring(group, .415, .025, .26, '#ffbc81'); this.scene.add(group); return group;
    });
    const trailPositions = new Float32Array(60);
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#d5e7ff', transparent: true, opacity: .35 }));
    this.trail.geometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    this.scene.add(this.trail);
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(.8, .86, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.pulse.rotation.x = -Math.PI / 2; this.pulse.position.y = SURFACE + .01; this.scene.add(this.pulse);
    this.pulseTime = 0;
    this.setCamera(this.replayCamera, .8);
    this.resize();
  }

  makeRenderer(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    return renderer;
  }

  setCamera(camera, aspect) {
    const scale = Math.max(1, 1.2 / aspect);
    camera.aspect = aspect;
    camera.position.set(7.2 * scale, 12.8 * scale, 13.8 * scale);
    camera.lookAt(0, .8, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }

  resize() {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio || 1, 1.6);
    if (this.width === width && this.height === height && this.ratio === ratio) return;
    this.width = width; this.height = height; this.ratio = ratio;
    this.renderer.setPixelRatio(ratio); this.renderer.setSize(width, height, false);
    if (matchMedia('(max-width: 700px) and (orientation: portrait)').matches) this.fitMobileCamera(width, height);
    else { this.camera.clearViewOffset(); this.setCamera(this.camera, width / height); }
  }

  fitMobileCamera(width, height) {
    const camera = this.camera;
    camera.clearViewOffset();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const target = new THREE.Vector3(0, 1, 0);
    const elevation = THREE.MathUtils.clamp((height / width - .65) / .55, 0, 1);
    const direction = new THREE.Vector3(1.7, 8 + 18 * elevation, 19 - 9 * elevation).normalize();
    const corners = [];
    for (const x of [-5.35, 5.35]) for (const y of [.3, 1.8]) for (const z of [-5.35, 5.35]) corners.push(new THREE.Vector3(x, y, z));
    const boundsAt = distance => {
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target); camera.updateMatrixWorld();
      const points = corners.map(point => point.clone().project(camera));
      return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.max(...points.map(p => p.y)), bottom: Math.min(...points.map(p => p.y)) };
    };
    // Fit the entire playing area, including the near rail, with room for the clock.
    const topSpace = Math.min(74, height * .32), bottomSpace = 22;
    const availableHeight = Math.max(1, height - topSpace - bottomSpace) / height * 2;
    let near = 10, far = 80;
    for (let i = 0; i < 24; i++) {
      const distance = (near + far) / 2, bounds = boundsAt(distance);
      if (bounds.left < -.995 || bounds.right > .995 || bounds.top - bounds.bottom > availableHeight) near = distance;
      else far = distance;
    }
    const bounds = boundsAt(far);
    const center = (1 - (bounds.top + bounds.bottom) / 2) * height / 2;
    const desiredCenter = height - bottomSpace - (bounds.top - bounds.bottom) * height / 4;
    camera.setViewOffset(width, height, 0, center - desiredCenter, width, height);
    camera.updateProjectionMatrix();
  }

  pointerPosition(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.intersection)) return null;
    return { x: this.intersection.x / WORLD + .5, y: this.intersection.z / WORLD + .5 };
  }

  project(x, y, height = 2.1, replay = false) {
    const vector = new THREE.Vector3((x - .5) * WORLD, height, (y - .5) * WORLD);
    vector.project(replay ? this.replayCamera : this.camera);
    return { x: (vector.x + 1) / 2, y: (1 - vector.y) / 2 };
  }

  goal(x, y, color) {
    this.pulse.position.x = (x - .5) * WORLD; this.pulse.position.z = (y - .5) * WORLD;
    this.pulse.material.color.set(color); this.pulseTime = performance.now();
  }

  render(state, now) {
    this.resize();
    const move = (mesh, body) => { mesh.position.x = (body.x - .5) * WORLD; mesh.position.z = (body.y - .5) * WORLD; };
    move(this.player, state.player); move(this.puck, state.puck);
    state.bots.forEach((bot, index) => move(this.bots[index], bot.paddle));
    this.bumpers.forEach(mesh => { mesh.visible = state.bumpersOn; });
    const positions = this.trail.geometry.attributes.position;
    const trail = state.puck.trail.slice(-20);
    trail.forEach((point, index) => positions.setXYZ(index, (point.x - .5) * WORLD, SURFACE + .1, (point.y - .5) * WORLD));
    positions.needsUpdate = true; this.trail.geometry.setDrawRange(0, trail.length);
    this.trail.visible = !this.reducedMotion.matches && trail.length > 1;
    const age = (now - this.pulseTime) / 750;
    this.pulse.visible = Boolean(this.pulseTime && age < 1);
    this.pulse.material.opacity = this.pulseTime && age < 1 ? (1 - age) * .65 : 0;
    this.pulse.scale.setScalar(this.reducedMotion.matches ? 1 : 1 + age * 2);
    this.renderer.render(this.scene, this.camera);
  }

  startReplay() {
    if (!this.replayRenderer) {
      this.replayRenderer = this.makeRenderer(document.createElement('canvas'));
      this.replayRenderer.setSize(800, 1000, false);
      this.replayRenderer.shadowMap.enabled = false;
    }
  }

  replayFrame() {
    this.replayRenderer.render(this.scene, this.replayCamera);
    return this.replayRenderer.domElement;
  }
}
