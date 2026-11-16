// PORTFALL map: Kestrel Bay Terminal, a 110 x 80 m container port at dusk.
// Three lanes (A / Mid / B), two ground connectors, one exposed catwalk, two
// cargo sites with colour-coded beacons (A amber, B cyan). All geometry is
// procedural boxes. Static geometry merges per material into ONE mesh each, so
// the whole map costs ~27 draw calls; every solid box also registers an
// invisible AABB proxy in `colliders`: movement and shooting both test those
// boxes, never render mesh.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { rayBox } from './state.js';

const CONTAINER = { w: 6.1, h: 2.6, d: 2.44 };

// Merge a list of axis-aligned (optionally yaw-rotated) boxes into one geometry.
function mergeBoxes(specs) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let base = 0;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const s of specs) {
    const g = unit.clone();
    e.set(0, s.ry || 0, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.w, s.h, s.d));
    g.applyMatrix4(m);
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const u = g.attributes.uv.array;
    const idx = g.index.array;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < n.length; i++) normals.push(n[i]);
    for (let i = 0; i < u.length; i++) uvs.push(u[i]);
    for (let i = 0; i < idx.length; i++) indices.push(idx[i] + base);
    base += p.length / 3;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function signTexture(text, sub) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#20242a';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = PALETTE.hazard;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 58);
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillStyle = PALETTE.hazard;
  ctx.fillText(sub, 256, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene, textures) {
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  function addCollider(x, y, z, w, h, d) {
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    ));
  }
  function mesh(geo, mat, x, y, z, shadow = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  // One spec list per material: every static box goes into its list, and each
  // list becomes a single merged mesh at the end of the build.
  const concreteSpecs = [];
  const warehouseSpecs = [];
  const steelSpecs = [];
  const darkSteelSpecs = [];
  const hazardSpecs = [];
  const lampSpecs = [];
  const rustSpecs = [];
  const harborSpecs = [];
  const mustardSpecs = [];
  const greenSpecs = [];
  function spec(list, w, h, d, x, y, z, ry) {
    list.push({ w, h, d, x, y, z, ry: ry || 0 });
    // the collider is the yaw-rotated box's axis-aligned bounding box
    const c = Math.abs(Math.cos(ry || 0));
    const s = Math.abs(Math.sin(ry || 0));
    addCollider(x, y, z, w * c + d * s, h, w * s + d * c);
  }
  function container(list, x, z, level, ry) {
    const y = 1.3 + (level - 1) * 2.6;
    list.push({ w: CONTAINER.w, h: CONTAINER.h, d: CONTAINER.d, x, y, z, ry: ry || 0 });
    addCollider(x, y, z, ry ? CONTAINER.d : CONTAINER.w, CONTAINER.h, ry ? CONTAINER.w : CONTAINER.d);
  }

  const matAsphalt = new THREE.MeshStandardMaterial({ map: textures.asphalt, roughness: 0.42, metalness: 0.12 });
  const matConcrete = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.9 });
  const matSteel = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.45, metalness: 0.6 });
  const matDarkSteel = new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.6, metalness: 0.4 });
  const matHazard = new THREE.MeshStandardMaterial({ map: textures.hazard, roughness: 0.7 });
  const matWarehouse = new THREE.MeshStandardMaterial({ map: textures.warehouse, roughness: 0.55, metalness: 0.15 });
  const matCrate = new THREE.MeshStandardMaterial({ map: textures.crate, roughness: 0.85 });
  const matRust = new THREE.MeshStandardMaterial({ map: textures.rust, roughness: 0.75, metalness: 0.1 });
  const matHarbor = new THREE.MeshStandardMaterial({ map: textures.harbor, roughness: 0.75, metalness: 0.1 });
  const matMustard = new THREE.MeshStandardMaterial({ map: textures.mustard, roughness: 0.75, metalness: 0.1 });
  const matGreen = new THREE.MeshStandardMaterial({ map: textures.dockGreen, roughness: 0.75, metalness: 0.1 });
  const matLamp = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 2.2 });
  const matAmber = new THREE.MeshStandardMaterial({ color: 0x3a2405, emissive: new THREE.Color(PALETTE.hazard), emissiveIntensity: 3.5 });
  const matCyan = new THREE.MeshStandardMaterial({ color: 0x062a30, emissive: new THREE.Color(PALETTE.cyan), emissiveIntensity: 3.5 });
  const matCurtain = new THREE.MeshStandardMaterial({
    map: textures.curtain, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    roughness: 0.4, depthWrite: false,
  });

  // ---- sky dome + ground -------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 24, 16),
    new THREE.MeshBasicMaterial({ map: textures.sky, side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  const ground = mesh(new THREE.PlaneGeometry(112, 82), matAsphalt, 0, 0, 0, false);
  ground.rotation.x = -Math.PI / 2;

  // ---- lights ------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(new THREE.Color('#7fa8b0'), new THREE.Color('#2a2118'), 0.85));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ff9a4d'), 2.6);
  sun.position.set(-70, 26, 30);
  sun.target.position.set(10, 0, -5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#4d7a8a'), 0.5);
  fill.position.set(40, 30, -40);
  scene.add(fill);

  // ---- perimeter walls ----------------------------------------------------
  spec(concreteSpecs, 112, 5, 0.6, 0, 2.5, -40.3);
  spec(concreteSpecs, 112, 5, 0.6, 0, 2.5, 40.3);
  spec(concreteSpecs, 0.6, 5, 82, -55.3, 2.5, 0);
  spec(concreteSpecs, 0.6, 5, 82, 55.3, 2.5, 0);

  // ---- containers ----------------------------------------------------------
  // MID — Customs Yard: three rows, two fighting lanes + gaps.
  container(rustSpecs, -16, -8, 1); container(harborSpecs, -6, -8, 1); container(harborSpecs, -6, -8, 2);
  container(mustardSpecs, 4, -8, 1); container(greenSpecs, 14, -8, 1);
  container(greenSpecs, -12, 0, 1); container(rustSpecs, 12, 0, 1);
  container(mustardSpecs, -16, 8, 1); container(rustSpecs, -4, 8, 1);
  container(harborSpecs, 8, 8, 1); container(harborSpecs, 8, 8, 2); container(greenSpecs, 16, 8, 1);
  // Flank stacks breaking the long sightlines.
  container(rustSpecs, -24, -12, 1, Math.PI / 2); container(harborSpecs, 24, 12, 1, Math.PI / 2);
  container(mustardSpecs, -24, 14, 1, Math.PI / 2); container(greenSpecs, 24, -14, 1, Math.PI / 2);
  // SITE A cover: container ends + low stack.
  container(rustSpecs, -36, -9, 1, Math.PI / 2); container(harborSpecs, -36, 9, 1, Math.PI / 2);
  container(mustardSpecs, -48, -9, 1); container(greenSpecs, -30, 11, 1);
  // SITE B approach cover.
  container(rustSpecs, 36, -9, 1, Math.PI / 2); container(harborSpecs, 36, 9, 1, Math.PI / 2);
  container(greenSpecs, 30, -11, 1);
  // The crane's hanging container, mid-air (y 7.2, not ground level).
  rustSpecs.push({ w: CONTAINER.w, h: CONTAINER.h, d: CONTAINER.d, x: -44, y: 7.2, z: 0, ry: 0 });
  addCollider(-44, 7.2, 0, CONTAINER.w, CONTAINER.h, CONTAINER.d);

  // ---- inspection arch (Mid landmark) -------------------------------------
  spec(darkSteelSpecs, 0.6, 5.2, 0.6, -3.4, 2.6, 0);
  spec(darkSteelSpecs, 0.6, 5.2, 0.6, 3.4, 2.6, 0);
  spec(darkSteelSpecs, 7.4, 0.7, 0.7, 0, 5.2, 0);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 1.6),
    new THREE.MeshBasicMaterial({ map: signTexture('KESTREL BAY', 'BERTH 9 — CUSTOMS'), side: THREE.DoubleSide }),
  );
  sign.position.set(0, 4.4, 0);
  group.add(sign);

  // ---- SITE A: gantry crane (hero silhouette) + pad ------------------------
  for (const [lx, lz] of [[-52, -10], [-52, 10], [-36, -10], [-36, 10]]) {
    spec(steelSpecs, 1.1, 14, 1.1, lx, 7, lz);
  }
  spec(steelSpecs, 17.5, 1.2, 1.4, -44, 14, -10);
  spec(steelSpecs, 17.5, 1.2, 1.4, -44, 14, 10);
  spec(steelSpecs, 1.4, 1.2, 21.5, -44, 14, 0);
  spec(darkSteelSpecs, 3.2, 1.6, 4.2, -44, 13.2, 0); // trolley
  // suspension cables (thin, no collider)
  for (const [cx, cz] of [[-46.5, -0.9], [-46.5, 0.9], [-41.5, -0.9], [-41.5, 0.9]]) {
    darkSteelSpecs.push({ w: 0.06, h: 5.4, d: 0.06, x: cx, y: 10.4, z: cz, ry: 0 });
  }
  // hazard-striped pad: a floor marking, NOT a collider — the 0.12 m pad
  // registered as a solid box blocked every bot (and the player) from
  // stepping onto the site, so the charge could never be armed.
  hazardSpecs.push({ w: 9, h: 0.12, d: 9, x: -44, y: 0.06, z: 0, ry: 0 });
  spec(darkSteelSpecs, 0.5, 3.4, 0.5, -49.5, 1.7, -6);
  const beaconA = mesh(new THREE.SphereGeometry(0.65, 16, 12), matAmber, -49.5, 3.7, -6, false);
  const beaconLightA = new THREE.PointLight(new THREE.Color(PALETTE.hazard), 26, 26, 1.6);
  beaconLightA.position.set(-49.5, 3.7, -6);
  scene.add(beaconLightA);

  // ---- SITE B: Cold Store warehouse (the only indoor zone) -----------------
  const wallH = 7;
  // west wall with a wide door (Service Run entry), z -3..3 open
  spec(warehouseSpecs, 0.5, wallH, 8.5, 30, 3.5, -9.75);
  spec(warehouseSpecs, 0.5, wallH, 8.5, 30, 3.5, 9.75);
  spec(warehouseSpecs, 0.5, 2.2, 6, 30, 5.9, 0); // lintel over the door
  // east (back) wall, solid
  spec(warehouseSpecs, 0.5, wallH, 28, 52, 3.5, 0);
  // south wall, door x 38..44
  spec(warehouseSpecs, 8, wallH, 0.5, 34, 3.5, 14);
  spec(warehouseSpecs, 8, wallH, 0.5, 48, 3.5, 14);
  spec(warehouseSpecs, 6, 2.2, 0.5, 41, 5.9, 14);
  // north wall, door x 38..44
  spec(warehouseSpecs, 8, wallH, 0.5, 34, 3.5, -14);
  spec(warehouseSpecs, 8, wallH, 0.5, 48, 3.5, -14);
  spec(warehouseSpecs, 6, 2.2, 0.5, 41, 5.9, -14);
  // roof
  spec(concreteSpecs, 22.5, 0.3, 28.5, 41, 7.15, 0);
  // pallet shelving lanes
  const shelfSpecs = [];
  for (const sx of [37, 45]) {
    shelfSpecs.push({ w: 1.1, h: 2.4, d: 9, x: sx, y: 1.2, z: -6 });
    shelfSpecs.push({ w: 1.1, h: 2.4, d: 9, x: sx, y: 1.2, z: 6 });
    addCollider(sx, 1.2, -6, 1.1, 2.4, 9);
    addCollider(sx, 1.2, 6, 1.1, 2.4, 9);
  }
  mesh(mergeBoxes(shelfSpecs), matCrate, 0, 0, 0);
  // refrigeration unit row at the back wall (arm zone)
  for (let i = 0; i < 3; i++) {
    spec(steelSpecs, 1.6, 3.4, 2.2, 50.6, 1.7, -5 + i * 5);
  }
  // strip curtains on the three doors
  const curtainGeo = new THREE.PlaneGeometry(6, 4.8);
  const curW = mesh(curtainGeo, matCurtain, 30, 2.4, 0, false);
  curW.rotation.y = Math.PI / 2;
  mesh(curtainGeo, matCurtain, 41, 2.4, 14, false);
  mesh(curtainGeo, matCurtain, 41, 2.4, -14, false);
  // frost vapour puffs at the doors (flat translucent planes, cheap)
  const vapourMat = new THREE.MeshBasicMaterial({ color: 0xbfe0e8, transparent: true, opacity: 0.16, depthWrite: false });
  for (const [vx, vz, ry] of [[30, 0, Math.PI / 2], [41, 14, 0], [41, -14, 0]]) {
    const v = mesh(new THREE.PlaneGeometry(5, 2.2), vapourMat, vx, 0.4, vz, false);
    v.rotation.y = ry;
  }
  // cyan pad: a floor marking, NOT a collider (see Site A).
  hazardSpecs.push({ w: 9, h: 0.12, d: 9, x: 44, y: 0.06, z: 0, ry: 0 });
  spec(darkSteelSpecs, 0.5, 3.4, 0.5, 49.5, 1.7, 6);
  const beaconB = mesh(new THREE.SphereGeometry(0.65, 16, 12), matCyan, 49.5, 3.7, 6, false);
  const beaconLightB = new THREE.PointLight(new THREE.Color(PALETTE.cyan), 26, 26, 1.6);
  beaconLightB.position.set(49.5, 3.7, 6);
  scene.add(beaconLightB);
  const coldLight = new THREE.PointLight(new THREE.Color('#9fd8e8'), 30, 30, 1.8);
  coldLight.position.set(41, 6, 0);
  scene.add(coldLight);

  // ---- catwalk: elevated steel walkway, z = -18, y = 3.4 -------------------
  spec(steelSpecs, 88, 0.3, 3, 0, 3.25, -18);
  for (const px of [-40, -20, 0, 20, 40]) {
    spec(darkSteelSpecs, 0.4, 3.4, 0.4, px, 1.7, -19.3);
  }
  // stairs (0.425 m steps) at A end, Mid, B end — step-up assist climbs them.
  for (const cx of [-42, 0, 42]) {
    for (let i = 0; i < 8; i++) {
      spec(steelSpecs, 2.4, 0.425, 0.85, cx, 0.2125 + i * 0.425, -16.2 + i * 0.85);
    }
  }

  // ---- spawns: forklift, gatehouse, barrier arms, floodlights --------------
  // Breaker spawn forklift (body yawed 0.5, cab on top)
  spec(mustardSpecs, 1.6, 0.9, 2.4, 8, 0.45, 32, 0.5);
  spec(darkSteelSpecs, 1.4, 1.1, 1.2, 8, 1.4, 32.4);
  // Harborwatch gatehouse + barrier arms (arms are visual only: a 0.18 m
  // chest-high arm across the spawn exit ground the defenders every round).
  spec(concreteSpecs, 7, 3.6, 4.5, -10, 1.8, -36);
  spec(darkSteelSpecs, 7.4, 0.3, 4.9, -10, 3.75, -36);
  hazardSpecs.push({ w: 0.18, h: 0.18, d: 7, x: 4, y: 1.05, z: -32, ry: 0 });
  hazardSpecs.push({ w: 0.18, h: 0.18, d: 7, x: -2, y: 1.05, z: -32, ry: 0 });
  // floodlight poles (emissive heads, no extra lights)
  for (const [px, pz] of [[-30, -24], [30, -24], [-30, 24], [30, 24]]) {
    spec(darkSteelSpecs, 0.35, 8, 0.35, px, 4, pz);
    spec(lampSpecs, 1.4, 0.5, 0.6, px, 8.1, pz);
  }

  // ---- build the merged meshes (one draw call per material) ----------------
  mesh(mergeBoxes(concreteSpecs), matConcrete, 0, 0, 0);
  mesh(mergeBoxes(warehouseSpecs), matWarehouse, 0, 0, 0);
  mesh(mergeBoxes(steelSpecs), matSteel, 0, 0, 0);
  mesh(mergeBoxes(darkSteelSpecs), matDarkSteel, 0, 0, 0);
  mesh(mergeBoxes(hazardSpecs), matHazard, 0, 0, 0);
  mesh(mergeBoxes(lampSpecs), matLamp, 0, 0, 0, false);
  mesh(mergeBoxes(rustSpecs), matRust, 0, 0, 0);
  mesh(mergeBoxes(harborSpecs), matHarbor, 0, 0, 0);
  mesh(mergeBoxes(mustardSpecs), matMustard, 0, 0, 0);
  mesh(mergeBoxes(greenSpecs), matGreen, 0, 0, 0);

  // ---- instanced props: pallets, barrels, crates ---------------------------
  const palletGeo = new THREE.BoxGeometry(1.3, 0.16, 1.1);
  const pallets = new THREE.InstancedMesh(palletGeo, matCrate, 26);
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12);
  const barrels = new THREE.InstancedMesh(barrelGeo, matSteel, 18);
  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  const crates = new THREE.InstancedMesh(crateGeo, matCrate, 22);
  const dummy = new THREE.Object3D();
  const palletSpots = [
    [-14, 20], [-11, 22], [12, 18], [16, 24], [-20, -20], [-16, -22], [20, -20], [24, -22],
    [-48, 12], [-40, -12], [48, 12], [40, -10], [-8, 30], [4, 28], [-6, -30], [8, -28],
    [-28, 6], [28, -6], [-2, -18], [6, -18], [-34, 16], [34, 16], [-18, 34], [18, -34],
    [-44, 20], [44, 20],
  ];
  palletSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 0.08, z);
    dummy.rotation.set(0, (i * 0.7) % Math.PI, 0);
    dummy.updateMatrix();
    pallets.setMatrixAt(i, dummy.matrix);
    if (i % 3 === 0) addCollider(x, 0.08, z, 1.3, 0.16, 1.1);
  });
  const barrelSpots = [
    [-18, 26], [-17, 27], [18, -26], [19, -27], [-50, -4], [-50, -2], [50, 4], [50, 2],
    [-12, -26], [14, 26], [-26, -16], [26, 16], [-38, 18], [38, -18], [-4, 36], [6, -36],
    [-52, 8], [52, -8],
  ];
  barrelSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 0.53, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    barrels.setMatrixAt(i, dummy.matrix);
    addCollider(x, 0.53, z, 0.84, 1.05, 0.84);
  });
  const crateSpots = [
    [-48, 6], [-47, 6], [-48, 7], [48, -6], [47, -6], [-20, 4], [20, -4], [-8, -14],
    [8, 14], [-14, -28], [14, 28], [-34, -6], [34, 6], [-2, 22], [2, -22], [-44, -14],
    [44, 14], [-26, 22], [26, -22], [-10, 6], [10, -6], [-40, 22],
  ];
  crateSpots.forEach(([x, z], i) => {
    const s = i % 4 === 0 ? 1.3 : 1;
    dummy.position.set(x, s / 2, z);
    dummy.rotation.set(0, (i * 0.9) % Math.PI, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    crates.setMatrixAt(i, dummy.matrix);
    dummy.scale.setScalar(1);
    addCollider(x, s / 2, z, s, s, s);
  });
  pallets.instanceMatrix.needsUpdate = true;
  barrels.instanceMatrix.needsUpdate = true;
  crates.instanceMatrix.needsUpdate = true;
  pallets.castShadow = true;
  barrels.castShadow = true;
  crates.castShadow = true;
  pallets.receiveShadow = true;
  barrels.receiveShadow = true;
  crates.receiveShadow = true;
  group.add(pallets, barrels, crates);

  // ---- charge device (Hullbreaker) -----------------------------------------
  const chargeGroup = new THREE.Group();
  const chargeBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.4, metalness: 0.5 }),
  );
  chargeBody.castShadow = true;
  const chargeLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x220505, emissive: 0xff2a1a, emissiveIntensity: 3 }),
  );
  chargeLamp.position.set(0, 0.2, 0);
  chargeGroup.add(chargeBody, chargeLamp);
  chargeGroup.visible = false;
  scene.add(chargeGroup);

  // ---- sites, spawns, waypoints --------------------------------------------
  const sites = {
    A: { id: 'A', x: -44, z: 0, r: 4.5, color: PALETTE.hazard, beacon: beaconA, light: beaconLightA },
    B: { id: 'B', x: 44, z: 0, r: 4.5, color: PALETTE.cyan, beacon: beaconB, light: beaconLightB },
  };
  const spawns = {
    breakers: [
      { x: 0, z: 34, yaw: 0 }, { x: -6, z: 32, yaw: 0 }, { x: -3, z: 35, yaw: 0 },
      { x: 3, z: 35, yaw: 0 }, { x: 6, z: 32, yaw: 0 },
    ],
    harborwatch: [
      { x: 0, z: -34, yaw: Math.PI }, { x: -6, z: -32, yaw: Math.PI }, { x: -3, z: -35, yaw: Math.PI },
      { x: 3, z: -35, yaw: Math.PI }, { x: 6, z: -32, yaw: Math.PI },
    ],
  };
  // Waypoint graph for bots (ground plane only; the catwalk is the player's route).
  const waypoints = [
    { id: 0, x: 0, z: 34 }, { id: 1, x: -10, z: 28 }, { id: 2, x: 10, z: 28 },
    { id: 3, x: 0, z: 16 }, { id: 4, x: -10, z: 10 }, { id: 5, x: 10, z: 10 },
    { id: 6, x: 0, z: 0 }, { id: 7, x: -10, z: -6 }, { id: 8, x: 10, z: -6 },
    { id: 9, x: 0, z: -16 }, { id: 10, x: -12, z: -14 }, { id: 11, x: 12, z: -14 },
    { id: 12, x: -25, z: 0 }, { id: 13, x: -36, z: 0 }, { id: 14, x: -44, z: 0 },
    { id: 15, x: -44, z: -8 }, { id: 16, x: -44, z: 8 }, { id: 17, x: -50, z: 0 },
    { id: 18, x: 25, z: 0 }, { id: 19, x: 36, z: 0 }, { id: 20, x: 44, z: 0 },
    { id: 21, x: 44, z: -8 }, { id: 22, x: 44, z: 8 }, { id: 23, x: 48, z: 0 },
    { id: 24, x: 0, z: -34 }, { id: 25, x: -10, z: -28 }, { id: 26, x: 10, z: -28 },
    { id: 27, x: -25, z: -10 }, { id: 28, x: 25, z: -10 }, { id: 29, x: -25, z: 10 },
    { id: 30, x: 25, z: 10 }, { id: 31, x: -16, z: -2 }, { id: 32, x: 16, z: -2 },
    // Gap waypoints threading the container rows (clear lanes between stacks).
    { id: 33, x: -10, z: 12 }, { id: 34, x: 2, z: 12 }, { id: 35, x: 12, z: 12 },
    { id: 36, x: -10, z: 4 }, { id: 37, x: 2, z: 4 }, { id: 38, x: 12, z: 4 },
    { id: 39, x: -11, z: -4 }, { id: 40, x: -1, z: -4 }, { id: 41, x: 9, z: -4 },
    { id: 42, x: -11, z: -12 }, { id: 43, x: -1, z: -12 }, { id: 44, x: 9, z: -12 },
  ];
  const edges = [
    [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [4, 6], [5, 6], [6, 7], [6, 8],
    [7, 9], [8, 9], [9, 10], [9, 11], [10, 24], [11, 24], [24, 25], [24, 26],
    [4, 12], [5, 18], [12, 13], [13, 14], [14, 15], [14, 16], [14, 17], [13, 27],
    [18, 19], [19, 20], [20, 21], [20, 22], [20, 23], [19, 28], [12, 29], [18, 30],
    [7, 31], [8, 32], [31, 12], [32, 18], [27, 13], [28, 19], [29, 13], [30, 19],
    [10, 25], [11, 26], [1, 29], [2, 30], [25, 27], [26, 28],
    // Gap grid: south / between / north of the container rows.
    [33, 36], [34, 37], [35, 38], [36, 39], [37, 40], [38, 41], [39, 42], [40, 43], [41, 44],
    [33, 34], [34, 35], [36, 37], [37, 38], [39, 40], [40, 41], [42, 43], [43, 44],
    [3, 33], [3, 34], [3, 35], [33, 1], [35, 2], [42, 10], [44, 11],
    [36, 12], [38, 18], [39, 31], [41, 32], [42, 27], [44, 28],
  ];
  // Edge validation: drop any edge whose straight segment a bot (radius 0.5 m)
  // cannot walk — the container rows sit between some waypoint pairs, and a
  // bot following a blocked edge would grind against a wall. Validated edges
  // are the only ones BFS may use.
  const expanded = colliders.map((c) => new THREE.Box3(
    new THREE.Vector3(c.min.x - 0.5, c.min.y, c.min.z - 0.5),
    new THREE.Vector3(c.max.x + 0.5, c.max.y, c.max.z + 0.5),
  ));
  function edgeClear(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    for (const c of expanded) {
      if (c.max.y < 0.2) continue;
      // Two ray heights: 0.5 m catches low walls, 1.0 m catches chest-high
      // obstacles (a ray at a single height missed the barrier arms).
      const t1 = rayBox(a.x, 0.5, a.z, dx / len, 0, dz / len, c, len);
      if (t1 >= 0) return false;
      const t2 = rayBox(a.x, 1.0, a.z, dx / len, 0, dz / len, c, len);
      if (t2 >= 0) return false;
    }
    return true;
  }
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  const validEdges = edges.filter(([a, b]) => edgeClear(byId.get(a), byId.get(b)));
  const adjacency = waypoints.map(() => []);
  for (const [a, b] of validEdges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  // Breadth-first path between waypoint ids.
  function findPath(fromId, toId) {
    if (fromId === toId) return [toId];
    const prev = new Array(waypoints.length).fill(-1);
    const queue = [fromId];
    prev[fromId] = fromId;
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of adjacency[cur]) {
        if (prev[nb] !== -1) continue;
        prev[nb] = cur;
        if (nb === toId) {
          const path = [toId];
          let p = cur;
          while (p !== fromId) {
            path.unshift(p);
            p = prev[p];
          }
          path.unshift(fromId);
          return path;
        }
        queue.push(nb);
      }
    }
    return [toId];
  }
  function nearestWaypoint(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (const w of waypoints) {
      const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
      if (d < bestD) {
        bestD = d;
        best = w.id;
      }
    }
    return best;
  }

  // Per-frame map animation: beacon pulse (faster when the charge is armed).
  let beaconPhase = 0;
  function update(dt, armed) {
    beaconPhase += dt * (armed ? 6 : 1.6);
    const pulse = 1.6 + Math.sin(beaconPhase) * (armed ? 1.6 : 0.6);
    matAmber.emissiveIntensity = pulse;
    matCyan.emissiveIntensity = pulse;
    beaconLightA.intensity = 20 + Math.sin(beaconPhase) * (armed ? 14 : 5);
    beaconLightB.intensity = 20 + Math.sin(beaconPhase) * (armed ? 14 : 5);
  }

  return {
    colliders, sites, spawns, waypoints, adjacency, findPath, nearestWaypoint,
    chargeGroup, chargeLamp, update,
  };
}
