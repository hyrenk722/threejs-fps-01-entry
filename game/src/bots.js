// PORTFALL bots: 5v5 squads with roles, a five-state machine, waypoint routes,
// hearing, burst discipline and a real objective. They never shoot through
// walls (every shot is a rayBox test), never stay stuck more than 2 s (waypoint
// recovery: sidestep + repath), and they finish full rounds with no human input.
// Roles: Leader (carries the charge on attack / calls the site on defence),
// Entry x2, Support (utility, trades fights), Anchor (holds a site / lurks).
import * as THREE from 'three';
import { clamp, dist2, logEvent, rayBox } from './state.js';
import { WEAPONS, computeSpread, hasLineOfSight, updateAgentHitboxes } from './weapons.js';
import { buyItem } from './economy.js';
import { PALETTE } from './palette.js';

export const BOT_NAMES = {
  breakers: ['Rook', 'Tide', 'Sable', 'Vex', 'Harrow'],
  harborwatch: ['Warden', 'Beacon', 'Pike', 'Sentry', 'Gull'],
};
export const ROLES = ['Leader', 'Entry', 'Entry', 'Support', 'Anchor'];
const REACTION_DELAY = 0.45; // seconds after line-of-sight before the first shot
const HEAR_RADIUS = 25; // metres: gunfire heard this far rotates a bot
const AIM_START_ERROR = 0.07; // radians when a target is first seen
const AIM_FULL_ERROR = 0.014; // radians after 0.3 s of continuous sight
const BOT_RADIUS = 0.34;

function teamColor(team) {
  return team === 'breakers' ? PALETTE.breaker : PALETTE.harborwatch;
}

// Walkability tests for hold spots: a spot inside a container (or one whose
// final leg crosses a container) would grind a bot against a wall forever.
function pointClear(world, x, z) {
  for (const c of world.colliders) {
    if (c.max.y < 0.2) continue;
    if (x > c.min.x - 0.4 && x < c.max.x + 0.4 && z > c.min.z - 0.4 && z < c.max.z + 0.4) return false;
  }
  return true;
}
function segmentClear(world, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return true;
  for (const c of world.colliders) {
    if (c.max.y < 0.2) continue;
    if (rayBox(ax, 0.9, az, dx / len, 0, dz / len, c, len) >= 0) return false;
  }
  return true;
}

// May the charge carrier arm right now? On the pad, and either no defender
// is close AND watching the carrier, or 2+ teammates are alive on the site.
function canArm(state, world, bot) {
  if (state.charge.state !== 'carried' || state.charge.carrier !== bot.id) return false;
  const site = world.sites[bot.controller.assignedSite];
  if (dist2(bot.pos.x, bot.pos.z, site.x, site.z) >= site.r * site.r) return false;
  // Teammates on the site, counted without allocating (runs every step).
  let teammatesOnSite = 0;
  for (const a of state.agents) {
    if (a.alive && a.team === bot.team && dist2(a.pos.x, a.pos.z, site.x, site.z) < 144) teammatesOnSite += 1;
  }
  const enemiesNear = state.agents.some((a) => a.alive && a.team !== bot.team
    && dist2(a.pos.x, a.pos.z, site.x, site.z) < 64
    && hasLineOfSight(world, a.pos.x, a.pos.y + 1.2, a.pos.z, bot.pos.x, bot.pos.y + 1.2, bot.pos.z, state.smokes));
  return !enemiesNear || teammatesOnSite >= 2;
}

// Merge coloured boxes into one vertex-coloured geometry (one draw call).
function mergeColored(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let base = 0;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  for (const [w, h, d, x, y, z, hex] of parts) {
    const g = unit.clone();
    m.makeTranslation(x, y, z);
    m.scale(new THREE.Vector3(w, h, d));
    g.applyMatrix4(m);
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const idx = g.index.array;
    const color = new THREE.Color(hex);
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < n.length; i++) normals.push(n[i]);
    for (let i = 0; i < p.length / 3; i++) colors.push(color.r, color.g, color.b);
    for (let i = 0; i < idx.length; i++) indices.push(idx[i] + base);
    base += p.length / 3;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

// ---- soldier figure ---------------------------------------------------------
// Three meshes: one vertex-coloured body (torso in team colour, head, helmet,
// gun) plus two legs that swing while walking. Readable at a glance in
// screenshots; cheap (3 draw calls per bot).
export function createBotMesh(scene, team) {
  const group = new THREE.Group();
  const teamHex = teamColor(team);
  const bodyGeo = mergeColored([
    [0.56, 0.78, 0.32, 0, 1.18, 0, teamHex], // torso / vest
    [0.32, 0.3, 0.32, 0, 1.72, 0, 0x8a6a52], // head
    [0.36, 0.12, 0.36, 0, 1.9, 0, teamHex], // helmet
    [0.07, 0.1, 0.6, 0.22, 1.25, -0.25, 0x23262b], // gun
  ]);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.22), dark);
  legL.position.set(-0.14, 0.4, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.22, 1.28, -0.62);
  flash.visible = false;
  group.add(body, legL, legR, flash);
  group.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  scene.add(group);
  return { group, torso: body, head: body, legL, legR, gun: body, flash, flashLeft: 0 };
}

export function createBotAgent(state, id, team, role, name) {
  return {
    id, name, team, role, bot: true,
    pos: new THREE.Vector3(0, 0, 0),
    yaw: 0, pitch: 0,
    alive: true, hp: 100, armor: 0, helmet: false,
    money: 800, kills: 0, deaths: 0,
    weapons: { 1: null, 2: 'p9', 3: 'hook' },
    weapon: 'p9',
    ammo: { p9: { mag: 12, reserve: 96 }, hook: { mag: Infinity, reserve: Infinity } },
    utility: { scrap: 0, flare: 0, fog: 0 },
    overrideKey: false,
    crouch: false,
    speed: 0,
    boxes: {
      head: new THREE.Box3(), torso: new THREE.Box3(), legs: new THREE.Box3(),
    },
    height: 1.72,
    channel: null, // 'arm' | 'pull' | null (processed by main.js)
    mesh: null,
    controller: {
      state: 'buy', // buy | rollout | hold | engage | objective | retake
      path: [], pathIdx: 0,
      targetId: null, target: null,
      assignedSite: 'A',
      assignedLane: 'mid',
      holdPos: null, holdYaw: 0,
      reactionAt: 0, aimTime: 0, aimError: AIM_START_ERROR,
      burstLeft: 0, burstTimer: 0, pauseTimer: 0,
      strafeDir: 1, strafeUntil: 0,
      lastX: 0, lastZ: 0, stuckAt: 0,
      perceiveAt: 0,
      hearPos: null, hearAt: -99,
      lostAt: 0,
      walkPhase: 0,
      siteCommitted: false,
    },
  };
}

// ---- buy AI ------------------------------------------------------------------
export function botBuy(state, bot) {
  const teamMoney = state.agents.filter((a) => a.team === bot.team).reduce((s, a) => s + a.money, 0) / 5;
  const eco = teamMoney < 2000 && state.lossStreak[bot.team] > 0;
  const tryBuy = (id) => buyItem(bot, id);
  if (bot.role === 'Support') {
    if (!eco) tryBuy('sparrow');
    tryBuy('fog');
    tryBuy('flare');
  } else if (bot.role === 'Anchor') {
    if (!eco && bot.money >= 3100 + 650) tryBuy('gullwing');
    else if (!eco) tryBuy('kestrel');
    else tryBuy('sparrow');
  } else if (bot.role === 'Leader') {
    if (!eco) tryBuy('kestrel');
    else tryBuy('sparrow');
    if (bot.team !== state.attackSide) tryBuy('overrideKey');
  } else {
    if (!eco) tryBuy('kestrel');
    else tryBuy('sparrow');
  }
  if (bot.money >= 650) tryBuy(bot.money >= 1000 && bot.role === 'Anchor' ? 'vestCap' : 'vest');
  if (bot.weapon && bot.weapons[1]) bot.weapon = bot.weapons[1];
  else if (bot.weapons[2]) bot.weapon = bot.weapons[2];
}

// ---- movement ----------------------------------------------------------------
function overlaps(world, x, y, z, height) {
  const minX = x - BOT_RADIUS;
  const maxX = x + BOT_RADIUS;
  const minZ = z - BOT_RADIUS;
  const maxZ = z + BOT_RADIUS;
  for (const c of world.colliders) {
    if (maxX > c.min.x && minX < c.max.x && y + height > c.min.y && y < c.max.y && maxZ > c.min.z && minZ < c.max.z) {
      return c;
    }
  }
  return null;
}

// Walk toward (tx, tz) at `speed`, sliding along walls. Returns distance left.
function moveToward(world, bot, tx, tz, dt, speed) {
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return 0;
  const step = Math.min(len, speed * dt);
  const nx = bot.pos.x + (dx / len) * step;
  const nz = bot.pos.z + (dz / len) * step;
  if (!overlaps(world, nx, bot.pos.y, bot.pos.z, bot.height)) bot.pos.x = nx;
  if (!overlaps(world, bot.pos.x, bot.pos.y, nz, bot.height)) bot.pos.z = nz;
  bot.speed = step / dt;
  return len - step;
}

function setPath(state, world, bot, targetWpId) {
  const from = world.nearestWaypoint(bot.pos.x, bot.pos.z);
  bot.controller.path = world.findPath(from, targetWpId);
  bot.controller.pathIdx = 0;
}

function followPath(state, world, bot, dt, speed) {
  const c = bot.controller;
  if (c.pathIdx >= c.path.length) return true;
  const wp = world.waypoints[c.path[c.pathIdx]];
  const left = moveToward(world, bot, wp.x, wp.z, dt, speed);
  if (left < 1.1) {
    // Arrived at this waypoint: standing here is not being stuck.
    c.pathIdx += 1;
    c.stuckAt = state.time;
    c.lastX = bot.pos.x;
    c.lastZ = bot.pos.z;
    return c.pathIdx >= c.path.length;
  }
  // Stuck recovery: no progress for 2 s while a path is active.
  const moved = Math.hypot(bot.pos.x - c.lastX, bot.pos.z - c.lastZ);
  if (moved > 0.4) {
    c.lastX = bot.pos.x;
    c.lastZ = bot.pos.z;
    c.stuckAt = state.time;
  } else if (state.time - c.stuckAt > 2) {
    c.stuckAt = state.time;
    // sidestep + repath from a neighbouring waypoint
    const near = world.nearestWaypoint(bot.pos.x, bot.pos.z);
    const neighbours = world.adjacency[near];
    const detour = neighbours.length ? neighbours[Math.floor(state.random() * neighbours.length)] : near;
    c.path = [detour, ...world.findPath(detour, c.path[c.path.length - 1])];
    c.pathIdx = 0;
    logEvent(state, 'bot-stuck', `${bot.name} repathed after 2 s stuck`);
  }
  return c.pathIdx >= c.path.length;
}

function faceToward(bot, tx, tz) {
  bot.yaw = Math.atan2(-(tx - bot.pos.x), -(tz - bot.pos.z));
}

function nearestVisibleEnemy(state, world, bot) {
  let best = null;
  let bestD = Infinity;
  const eyeY = bot.pos.y + (bot.crouch ? 1.02 : 1.6);
  for (const a of state.agents) {
    if (!a.alive || a.team === bot.team) continue;
    const d2 = dist2(bot.pos.x, bot.pos.z, a.pos.x, a.pos.z);
    if (d2 > 42 * 42) continue;
    // field of view, unless very close or the enemy just fired nearby
    const ang = Math.atan2(-(a.pos.x - bot.pos.x), -(a.pos.z - bot.pos.z));
    let diff = ang - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 1.1 && d2 > 36) continue;
    const chestY = a.pos.y + 1.2;
    if (!hasLineOfSight(world, bot.pos.x, eyeY, bot.pos.z, a.pos.x, chestY, a.pos.z, state.smokes)) continue;
    if (d2 < bestD) {
      bestD = d2;
      best = a;
    }
  }
  return best;
}

// ---- the state machine ---------------------------------------------------------
export function updateBot(state, world, bot, dt, combat) {
  const c = bot.controller;
  if (!bot.alive) return;
  if (bot.blindUntil && state.time < bot.blindUntil) {
    // Flare Pop: blinded bots stand still and cannot see or shoot.
    bot.crouch = false;
    c.target = null;
    return;
  }
  const weapon = WEAPONS[bot.weapon] || WEAPONS.p9;
  const speed = (weapon.speed || 5) * (bot.crouch ? 0.45 : 1);
  const isAttacker = bot.team === state.attackSide;

  // Perception, staggered per bot (every 0.12 s).
  if (state.time >= c.perceiveAt) {
    c.perceiveAt = state.time + 0.12;
    const seen = nearestVisibleEnemy(state, world, bot);
    if (seen) {
      if (c.target !== seen) {
        c.target = seen;
        c.reactionAt = state.time + REACTION_DELAY;
        c.aimTime = 0;
        c.aimError = AIM_START_ERROR;
      }
      c.lostAt = state.time;
    } else if (c.target && state.time - c.lostAt > 1.2) {
      c.target = null;
    }
    // Hearing: a recent gunshot within 25 m pulls a bot to investigate.
    for (let i = state.noises.length - 1; i >= 0; i--) {
      const n = state.noises[i];
      if (state.time - n.t > 3) break;
      if (n.team !== bot.team && dist2(bot.pos.x, bot.pos.z, n.x, n.z) < HEAR_RADIUS * HEAR_RADIUS) {
        c.hearPos = { x: n.x, z: n.z };
        c.hearAt = state.time;
        break;
      }
    }
  }

  const charge = state.charge;
  const mySite = c.assignedSite;
  const site = world.sites[mySite];
  const siteWp = mySite === 'A' ? 14 : 20;
  const engaging = c.target !== null && state.time >= c.reactionAt && state.phase === 'live';

  if (engaging) {
    const target = c.target;
    c.aimTime += dt;
    c.aimError = clamp(AIM_START_ERROR - (c.aimTime / 0.3) * (AIM_START_ERROR - AIM_FULL_ERROR), AIM_FULL_ERROR, AIM_START_ERROR);
    const range = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
    bot.crouch = range > 18 && state.random() < 0.5;
    faceToward(bot, target.pos.x, target.pos.z);
    // The objective outranks the strafe: a carrier on the pad plants, and a
    // defender on the pad pulls, while still shooting — standing still keeps
    // the channel on the pad instead of strafing off it. A carrier close to
    // the pad PUSHES the last metres while shooting: strafing in a doorway
    // duel pinned the carrier 5 m short of the pad for a whole round.
    // Otherwise the bot fights and strafes, and any arm attempt pauses
    // (progress is kept).
    if (canArm(state, world, bot)) {
      bot.channel = 'arm';
    } else if (bot.channel === 'pull') {
      // keep pulling: stand still on the pad
    } else if (charge.state === 'carried' && charge.carrier === bot.id
      && dist2(bot.pos.x, bot.pos.z, site.x, site.z) < 144) {
      bot.channel = null;
      moveToward(world, bot, site.x, site.z, dt, speed * 0.8);
    } else {
      bot.channel = null;
      // strafe perpendicular to the target
      if (state.time > c.strafeUntil) {
        c.strafeDir = state.random() < 0.5 ? -1 : 1;
        c.strafeUntil = state.time + 0.7 + state.random() * 0.7;
      }
      const px = -Math.cos(bot.yaw) * c.strafeDir;
      const pz = Math.sin(bot.yaw) * c.strafeDir;
      moveToward(world, bot, bot.pos.x + px, bot.pos.z + pz, dt, speed * 0.55);
    }
    // burst discipline: 3-5 rounds, then a pause
    if (c.burstLeft <= 0 && c.pauseTimer <= 0) {
      c.burstLeft = 3 + Math.floor(state.random() * 3);
      c.pauseTimer = 0.5 + state.random() * 0.4;
    }
    if (c.burstLeft > 0) {
      c.burstTimer -= dt;
      if (c.burstTimer <= 0) {
        c.burstTimer = 60 / weapon.rpm;
        c.burstLeft -= 1;
        combat.shootBot(bot, target, c.aimError);
      }
    } else {
      c.pauseTimer -= dt;
    }
    return;
  }

  // Not engaging: role behaviour by phase.
  bot.crouch = false;
  if (state.phase === 'buy') {
    c.state = 'buy';
    return;
  }
  if (state.phase !== 'live') return;

  if (charge.state === 'armed') {
    // Defence after the arm: nearest 2 rotate to retake, one pulls, one covers.
    if (!isAttacker) {
      // Two nearest defenders, found without allocating (runs every step).
      let puller = null;
      let cover = null;
      let pullerD = Infinity;
      let coverD = Infinity;
      for (const a of state.agents) {
        if (!a.alive || a.team !== bot.team || !a.bot) continue;
        const d = dist2(a.pos.x, a.pos.z, site.x, site.z);
        if (d < pullerD) {
          cover = puller;
          coverD = pullerD;
          puller = a;
          pullerD = d;
        } else if (d < coverD) {
          cover = a;
          coverD = d;
        }
      }
      const isPuller = puller === bot;
      const isCover = cover === bot;
      if (isPuller) {
        c.state = 'retake';
        if (dist2(bot.pos.x, bot.pos.z, site.x, site.z) < site.r * site.r) {
          bot.channel = 'pull';
          faceToward(bot, site.x, site.z);
        } else {
          bot.channel = null;
          setPathIfNeeded(state, world, bot, siteWp);
          followPath(state, world, bot, dt, speed);
          facePath(world, bot);
        }
      } else if (isCover) {
        c.state = 'retake';
        setPathIfNeeded(state, world, bot, siteWp);
        const arrived = followPath(state, world, bot, dt, speed);
        if (arrived) faceToward(bot, site.x + 6, site.z);
        else facePath(world, bot);
      } else {
        holdAngle(state, world, bot, dt, site, speed);
      }
      return;
    }
    // Attackers after the arm: hold the site.
    holdAngle(state, world, bot, dt, site, speed);
    return;
  }

  if (isAttacker) {
    // Attack: rollout, then commit to the Leader's site at ~55 s or on first pick.
    const firstPick = state.agents.some((a) => a.team === bot.team && a.kills > 0);
    const commitAt = state.phaseTime < 50 || firstPick;
    if (!c.siteCommitted && commitAt) c.siteCommitted = true;
    const targetWp = c.siteCommitted ? siteWp : (c.assignedLane === 'mid' ? 6 : siteWp);
    if (charge.state === 'carried' && charge.carrier === bot.id) {
      // Whoever carries the charge goes to the pad; arms when the site is
      // clear or 2+ teammates are alive on the site.
      if (canArm(state, world, bot)) {
        bot.channel = 'arm';
        faceToward(bot, site.x, site.z);
        return;
      }
      bot.channel = null;
      setPathIfNeeded(state, world, bot, siteWp);
      followPath(state, world, bot, dt, speed);
      facePath(world, bot);
      return;
    }
    if (bot.role === 'Support' && c.siteCommitted && dist2(bot.pos.x, bot.pos.z, site.x, site.z) < 400) {
      // Support smokes the site entry first (one fog canister, once per round).
      if (bot.utility.fog > 0 && !c.smoked) {
        c.smoked = true;
        bot.utility.fog -= 1;
        combat.throwFog(bot, site);
      }
    }
    if (bot.role === 'Anchor') {
      // Attack anchor lurks the opposite site.
      const other = mySite === 'A' ? 'B' : 'A';
      const otherWp = other === 'A' ? 14 : 20;
      setPathIfNeeded(state, world, bot, otherWp);
      const arrived = followPath(state, world, bot, dt, speed);
      if (arrived) {
        const s2 = world.sites[other];
        faceToward(bot, s2.x, s2.z);
      } else facePath(world, bot);
      return;
    }
    setPathIfNeeded(state, world, bot, targetWp);
    const arrived = followPath(state, world, bot, dt, speed);
    if (arrived) {
      if (c.siteCommitted) faceToward(bot, site.x, site.z);
      else faceToward(bot, bot.pos.x, bot.pos.z - 10);
    } else facePath(world, bot);
    return;
  }

  // Defence before the arm: hold an assigned angle, peek-jiggle, rotate on noise.
  if (c.hearPos && state.time - c.hearAt < 4) {
    const wp = world.nearestWaypoint(c.hearPos.x, c.hearPos.z);
    setPathIfNeeded(state, world, bot, wp);
    const arrived = followPath(state, world, bot, dt, speed);
    if (arrived) c.hearPos = null;
    else facePath(world, bot);
    return;
  }
  holdAngle(state, world, bot, dt, site, speed);
}

function setPathIfNeeded(state, world, bot, targetWp) {
  const c = bot.controller;
  if (c.pathTarget !== targetWp || c.pathIdx >= c.path.length) {
    c.pathTarget = targetWp;
    setPath(state, world, bot, targetWp);
  }
}

// Face the next waypoint on the active path (bots look where they walk).
function facePath(world, bot) {
  const c = bot.controller;
  if (c.pathIdx < c.path.length) {
    const wp = world.waypoints[c.path[c.pathIdx]];
    if (wp) faceToward(bot, wp.x, wp.z);
  }
}

// Defence hold: stand at the assigned hold position, small peek jiggles.
function holdAngle(state, world, bot, dt, site, speed) {
  const c = bot.controller;
  if (!c.holdPos) {
    // Try angles until the spot is walkable and its final leg from the
    // nearest waypoint is clear — a spot behind a container would grind
    // the bot against a wall forever. Pad centre is the fallback.
    for (let i = 0; i < 8; i++) {
      const angle = state.random() * Math.PI * 2;
      const r = site.r + 4 + state.random() * 4;
      const hx = site.x + Math.cos(angle) * r;
      const hz = site.z + Math.sin(angle) * r;
      const w = world.waypoints[world.nearestWaypoint(hx, hz)];
      if (!pointClear(world, hx, hz)) continue;
      if (!segmentClear(world, w.x, w.z, hx, hz)) continue;
      c.holdPos = { x: hx, z: hz };
      c.holdYaw = Math.atan2(-(site.x - hx), -(site.z - hz));
      break;
    }
    if (!c.holdPos) {
      c.holdPos = { x: site.x, z: site.z };
      c.holdYaw = 0;
    }
  }
  // Walk the waypoint graph to the hold spot's waypoint, then the final leg
  // (a straight walk across the whole map would cross container rows).
  const wp = world.nearestWaypoint(c.holdPos.x, c.holdPos.z);
  if (world.nearestWaypoint(bot.pos.x, bot.pos.z) !== wp) {
    setPathIfNeeded(state, world, bot, wp);
    followPath(state, world, bot, dt, speed);
    facePath(world, bot);
    return;
  }
  const arrived = moveToward(world, bot, c.holdPos.x, c.holdPos.z, dt, speed) < 0.5;
  if (arrived) {
    // peek jiggle: strafe a little, look at the site
    const jiggle = Math.sin(state.time * 0.9 + bot.id.charCodeAt(0)) * 0.8;
    moveToward(world, bot, c.holdPos.x + jiggle, c.holdPos.z, dt, speed * 0.3);
    bot.yaw = c.holdYaw;
  } else {
    faceToward(bot, c.holdPos.x, c.holdPos.z);
  }
}

// Sync the 3D figure with the agent: position, yaw, walk swing, muzzle flash.
export function syncBotMesh(bot, dt) {
  if (!bot.mesh) return;
  const m = bot.mesh;
  m.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
  m.group.rotation.y = bot.yaw;
  if (!bot.alive) {
    m.group.rotation.x = -Math.PI / 2 + 0.08;
    m.group.position.y = 0.15;
    return;
  }
  m.group.rotation.x = 0;
  const c = bot.controller;
  if (bot.speed > 0.5) {
    c.walkPhase += dt * bot.speed * 1.6;
    const swing = Math.sin(c.walkPhase) * 0.5;
    m.legL.rotation.x = swing;
    m.legR.rotation.x = -swing;
  } else {
    m.legL.rotation.x = 0;
    m.legR.rotation.x = 0;
  }
  m.group.position.y = bot.crouch ? -0.35 : 0;
  if (m.flashLeft > 0) {
    m.flashLeft -= dt;
    if (m.flashLeft <= 0) m.flash.visible = false;
  }
}

export function botMuzzleFlash(bot, seconds = 0.06) {
  if (!bot.mesh) return;
  bot.mesh.flash.visible = true;
  bot.mesh.flashLeft = seconds;
}
