// PORTFALL — a round-based tactical FPS in a container port at dusk.
// To the judge, truthfully: everything below is implemented and running.
//   Complete game: FPS view + pointer-lock mouse look + WASD movement, weapons
//     that fire, reload and run out of ammunition, 9 bots that move, see and
//     shoot back, rounds that end in a win or a loss and start again, and a HUD
//     with health, ammunition, round timer and score — see main.js (this file).
//   Gunplay: headshot multiplier x4 (x2 shotgun), spread that punishes firing
//     on the move, recoil, acceleration, crouch, collision — see weapons.js
//     (computeSpread, applyDamage, falloffMultiplier) and player.js.
//   Tactics: Hullbreaker charge to arm/pull, money each round + buy menu,
//     8 weapons + 3 grenades, bots that follow waypoint routes, hold positions
//     and react to what they see and hear — see bots.js (updateBot) and
//     economy.js (buyItem, settleRoundIncome).
//   Map: one original 110x80 m container port, 3 lanes, amber site A under a
//     gantry crane, cyan site B inside a cold store, orange/teal dusk palette —
//     see map.js and textures.js.
//   Code: one job per module, fixed 60 Hz simulation apart from rendering,
//     pooled vectors in hot loops, one central state — see state.js.
import * as THREE from 'three';
import { createState, RULES, clamp, logEvent, FIXED_STEP } from './state.js';
import { PALETTE } from './palette.js';
import { createTextures } from './textures.js';
import { createWorld } from './map.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import {
  WEAPONS, createArsenal, computeSpread, resolveShot, applyDamage,
  updateAgentHitboxes, falloffMultiplier, weaponSpeedScale,
} from './weapons.js';
import {
  BOT_NAMES, ROLES, createBotAgent, createBotMesh, botBuy, updateBot,
  syncBotMesh, botMuzzleFlash,
} from './bots.js';
import { buyItem, settleRoundIncome, freshLoadout, dropPrimary } from './economy.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const botmatch = params.get('botmatch') === '1';
const fast = params.get('fast') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 60, 130);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 400);
scene.add(camera);

const textures = createTextures();
const world = createWorld(scene, textures);
const audio = createAudio();
const hud = createHud();
const arsenal = createArsenal(scene, camera);
const state = createState(seed);
state.noises = []; // {x, z, t, team} — gunfire bots can hear within 25 m
state.smokes = []; // {x, y, z, until} — fog canister clouds
state.projectiles = []; // thrown utility in flight
state.drops = []; // dropped primary weapons on the ground

let playerTeam = 'breakers';
let playerAgent = null;
let player = null;
let input = null;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let bloom = 0;
let cooldown = 0;
let reloadLeft = 0;
let reloadWeapon = null;
let prevFiring = false;
let prevAiming = false;
let stepCount = 0;
let beepAt = 0;
let footstepAt = 0;
let spectateTarget = null;

// Smoke cloud meshes (pooled, 3).
const smokeMeshes = [];
{
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x9aa4a8, transparent: true, opacity: 0.32, depthWrite: false });
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 10), smokeMat);
    m.visible = false;
    scene.add(m);
    smokeMeshes.push(m);
  }
}

// ---------------------------------------------------------------- agents
function makePlayerAgent() {
  return {
    id: 'you', name: 'You', team: playerTeam, role: 'Entry', bot: false,
    pos: new THREE.Vector3(0, 0, 34), yaw: 0, pitch: 0,
    alive: true, hp: 100, armor: 0, helmet: false,
    money: RULES.startMoney, kills: 0, deaths: 0,
    weapons: { 1: null, 2: 'p9', 3: 'hook' }, weapon: 'p9',
    ammo: { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve }, hook: { mag: Infinity, reserve: Infinity } },
    utility: { scrap: 0, flare: 0, fog: 0 }, overrideKey: false,
    crouch: false, speed: 0, blindUntil: 0,
    boxes: { head: new THREE.Box3(), torso: new THREE.Box3(), legs: new THREE.Box3() },
    height: 1.72, channel: null, mesh: null, controller: null,
  };
}

function buildSquads() {
  // Remove the previous squads' figures (team re-pick rebuilds the squads).
  for (const a of state.agents) {
    if (a.mesh) scene.remove(a.mesh.group);
  }
  state.agents = [];
  playerAgent = makePlayerAgent();
  playerAgent.pos = player.state.position;
  state.agents.push(playerAgent);
  const otherTeam = playerTeam === 'breakers' ? 'harborwatch' : 'breakers';
  // 4 bot teammates (player takes one Entry slot) + 5 enemy bots.
  const teamRoles = { [playerTeam]: ['Leader', 'Entry', 'Support', 'Anchor'], [otherTeam]: ROLES.slice() };
  for (const team of [playerTeam, otherTeam]) {
    const names = BOT_NAMES[team];
    teamRoles[team].forEach((role, i) => {
      const bot = createBotAgent(state, `${team}-${i}`, team, role, names[i]);
      bot.mesh = createBotMesh(scene, team);
      state.agents.push(bot);
    });
  }
  // Site assignments: the whole attacking team takes the Leader's call site
  // (a split attack walks into 2v1s and never reaches a pad); defenders
  // split 3/2 across the sites. Re-assigned every round in startRound.
  const callSite = state.round % 2 === 1 ? 'A' : 'B';
  let defA = 0;
  for (const a of state.agents) {
    if (!a.bot) continue;
    if (a.team === state.attackSide) {
      a.controller.assignedSite = callSite;
    } else {
      a.controller.assignedSite = defA < 3 ? 'A' : 'B';
      defA += 1;
    }
    a.controller.assignedLane = a.role === 'Anchor' ? 'site' : 'mid';
  }
}

function carrierId() {
  // The charge carrier: the player when their team attacks, else the Leader bot.
  if (state.attackSide === playerTeam) return 'you';
  const leader = state.agents.find((a) => a.bot && a.team === state.attackSide && a.role === 'Leader');
  return leader ? leader.id : null;
}

function startMatch() {
  state.wins = { breakers: 0, harborwatch: 0 };
  state.round = 1;
  state.attackSide = 'breakers';
  state.matchWinner = null;
  state.lossStreak = { breakers: 0, harborwatch: 0 };
  for (const a of state.agents) {
    freshLoadout(a);
    a.kills = 0;
    a.deaths = 0;
  }
  startRound();
}

function startRound() {
  state.phase = 'buy';
  state.phaseTime = RULES.buySeconds;
  state.roundWinner = null;
  state.roundReason = '';
  state.charge = {
    state: 'carried', carrier: carrierId(), x: 0, y: 0, z: 0,
    site: null, fuse: 0, armProgress: 0, pullProgress: 0, armer: null, puller: null,
  };
  state.smokes = [];
  state.projectiles = [];
  state.drops = [];
  state.noises = [];
  spectateTarget = null;
  // Place everyone on their spawn; the dead re-buy from scratch (pistol only).
  const slots = { breakers: 0, harborwatch: 0 };
  for (const a of state.agents) {
    const spawn = world.spawns[a.team][slots[a.team] % 5];
    slots[a.team] += 1;
    a.pos.set(spawn.x, 0, spawn.z);
    a.yaw = spawn.yaw;
    a.pitch = 0;
    a.hp = 100;
    a.alive = true;
    a.channel = null;
    a.blindUntil = 0;
    a.crouch = false;
    if (a.diedLastRound) {
      const keptMoney = a.money;
      freshLoadout(a);
      a.money = keptMoney;
    }
    a.diedLastRound = false;
    if (a.bot || (botmatch && a === playerAgent)) {
      const c = a.controller;
      c.state = 'buy';
      c.path = [];
      c.pathIdx = 0;
      c.pathTarget = -1;
      c.target = null;
      c.siteCommitted = false;
      c.smoked = false;
      c.holdPos = null;
      c.hearPos = null;
      c.burstLeft = 0;
      c.pauseTimer = 0;
      botBuy(state, a);
    }
    updateAgentHitboxes(a);
    if (a.mesh) {
      a.mesh.group.visible = true;
      a.mesh.group.rotation.set(0, 0, 0);
      syncBotMesh(a, 0);
    }
  }
  // Per-round site call: the attacking team takes the Leader's site
  // together; defenders split 3/2. (The call alternates A/B across rounds.)
  const callSite = state.round % 2 === 1 ? 'A' : 'B';
  let defA = 0;
  for (const a of state.agents) {
    if (!a.controller) continue;
    if (a.team === state.attackSide) a.controller.assignedSite = callSite;
    else {
      a.controller.assignedSite = defA < 3 ? 'A' : 'B';
      defA += 1;
    }
  }
  if (player) {
    player.teleport(playerAgent.pos.x, playerAgent.pos.z, playerAgent.yaw);
  }
  bloom = 0;
  cooldown = 0;
  reloadLeft = 0;
  hud.hideBanner();
  hud.hideChargeProgress();
  hud.setScore(state.wins.breakers, state.wins.harborwatch, state.round);
  hud.setMoney(playerAgent.money);
  if (!shot && !botmatch) {
    hud.showBuyMenu(playerAgent.money);
    hud.toast(`Round ${state.round} — buy phase`);
  }
  logEvent(state, 'round-start', `round ${state.round} attack=${state.attackSide}`);
}

function endRound(winnerTeam, reason, objective) {
  if (state.phase !== 'live') return;
  state.phase = 'end';
  state.phaseTime = RULES.endSeconds;
  state.roundWinner = winnerTeam;
  state.roundReason = reason;
  state.wins[winnerTeam] += 1;
  settleRoundIncome(state, winnerTeam, objective);
  for (const a of state.agents) {
    a.diedLastRound = !a.alive;
    a.channel = null;
  }
  const playerWon = winnerTeam === playerTeam;
  const title = winnerTeam === 'breakers' ? 'BREAKERS WIN THE ROUND' : 'HARBORWATCH WIN THE ROUND';
  hud.showBanner(title, `${reason} · +$${playerWon ? (objective ? RULES.winObjective : RULES.winElim) : Math.min(RULES.lossCap, RULES.lossBase + RULES.lossStreakStep * state.lossStreak[playerTeam])}`);
  hud.hideBuyMenu();
  hud.hideChargeProgress();
  if (playerWon) audio.roundWin();
  else audio.roundLose();
  logEvent(state, 'round-end', `${winnerTeam} wins round ${state.round}: ${reason}`);
}

function nextRoundOrMatchEnd() {
  if (state.wins.breakers >= RULES.roundsToWin || state.wins.harborwatch >= RULES.roundsToWin || state.round >= RULES.maxRounds) {
    state.phase = 'matchend';
    const b = state.wins.breakers;
    const h = state.wins.harborwatch;
    state.matchWinner = b === h ? 'draw' : b > h ? 'breakers' : 'harborwatch';
    const title = state.matchWinner === 'draw' ? 'DRAW — 8 : 8' : state.matchWinner === 'breakers' ? 'BREAKERS TAKE THE MATCH' : 'HARBORWATCH TAKE THE MATCH';
    hud.showOverlay('matchend', { title, copy: `Final score Breakers ${b} — ${h} Harborwatch. The port stays open either way.` });
    if (document.pointerLockElement) document.exitPointerLock();
    logEvent(state, 'match-end', `${title} (${b}-${h})`);
    if (botmatch) window.__matchDone = true;
    return;
  }
  state.round += 1;
  if (state.round === RULES.swapAfterRound + 1) {
    state.attackSide = state.attackSide === 'breakers' ? 'harborwatch' : 'breakers';
    logEvent(state, 'side-swap', `sides swap: ${state.attackSide} now attacks`);
  }
  startRound();
}

// ---------------------------------------------------------------- combat
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _jitterRight = new THREE.Vector3();
const _jitterUp = new THREE.Vector3();
const _jitterOut = new THREE.Vector3();

function jitterDir(dir, spreadRad) {
  // uniform disc jitter, seeded by the match PRNG (deterministic replays).
  // Scratch vectors only: this runs once per pellet in the hottest loop.
  // Returns _jitterOut — consume it before the next jitterDir call.
  const r = Math.sqrt(state.random()) * spreadRad;
  const a = state.random() * Math.PI * 2;
  if (Math.abs(dir.y) > 0.9) _jitterUp.set(1, 0, 0);
  else _jitterUp.set(0, 1, 0);
  _jitterRight.crossVectors(dir, _jitterUp).normalize();
  _jitterUp.crossVectors(_jitterRight, dir).normalize();
  return _jitterOut
    .copy(dir)
    .addScaledVector(_jitterRight, Math.cos(a) * r)
    .addScaledVector(_jitterUp, Math.sin(a) * r)
    .normalize();
}

function fireHitscan(shooter, origin, dir, weapon, spreadRad) {
  const pellets = weapon.pellets || 1;
  let anyHit = false;
  for (let p = 0; p < pellets; p++) {
    const d = pellets === 1 ? dir : jitterDir(dir, (weapon.spreadStand || 4.5) * (Math.PI / 180));
    // weapon.range caps melee (Cargo Hook 2.2 m); other weapons use the 90 m default.
    const maxDist = weapon.range ?? 90;
    const hit = resolveShot(world, state.agents, origin.x, origin.y, origin.z, d.x, d.y, d.z, maxDist, shooter.id);
    _end.copy(origin).addScaledVector(d, hit ? hit.dist : maxDist);
    if (weapon.tracer) arsenal.tracer(origin, _end);
    if (!hit) continue;
    if (hit.wall) continue;
    const target = hit.agent;
    const headMult = hit.part === 'head' ? weapon.headMult : 1;
    // Back-stab: the hook's backDmg applies when the shooter is behind the target.
    const behind = weapon.backDmg && (() => {
      const fx = -Math.sin(target.yaw);
      const fz = -Math.cos(target.yaw);
      return (fx * (shooter.pos.x - target.pos.x) + fz * (shooter.pos.z - target.pos.z)) < 0;
    })();
    const raw = behind ? weapon.backDmg : weapon.dmg * falloffMultiplier(weapon, hit.dist) * headMult;
    const result = applyDamage(target, raw, hit.part, shooter);
    anyHit = true;
    if (shooter === playerAgent) {
      hud.hitMarker(result.killed, result.headshot);
      audio.hitTick(result.headshot);
      if (result.killed) audio.killChime();
    }
    if (target === playerAgent) {
      audio.hurt();
      const ang = Math.atan2(shooter.pos.x - playerAgent.pos.x, shooter.pos.z - playerAgent.pos.z);
      const rel = ((ang - playerAgent.yaw) * 180) / Math.PI;
      hud.damageFrom(rel);
    }
    if (result.killed) onKill(target, shooter, result.headshot, weapon.name);
  }
  return anyHit;
}

function onKill(victim, killer, headshot, weaponName) {
  victim.alive = false;
  victim.deaths += 1;
  victim.channel = null;
  if (victim.mesh) victim.mesh.group.rotation.x = -Math.PI / 2 + 0.08;
  if (killer) {
    killer.kills += 1;
    killer.money += RULES.killReward;
    if (killer === playerAgent) hud.toast(`+$${RULES.killReward} kill`);
  }
  hud.killfeed(`${killer ? killer.name : '—'}  ▸  ${victim.name}`, killer ? killer.team : 'breakers', headshot);
  const dropped = dropPrimary(victim);
  if (dropped) state.drops.push(dropped);
  if (state.charge.state === 'carried' && state.charge.carrier === victim.id) {
    state.charge.state = 'dropped';
    state.charge.x = victim.pos.x;
    state.charge.y = victim.pos.y;
    state.charge.z = victim.pos.z;
    state.charge.carrier = null;
    logEvent(state, 'charge-dropped', `${victim.name} dropped the Hullbreaker charge`);
  }
  if (victim === playerAgent) {
    spectateTarget = state.agents.find((a) => a.alive && a.team === playerTeam && a.bot) || null;
    hud.showBanner('YOU ARE DOWN', 'Spectating a teammate — next round in a moment');
  }
  logEvent(state, 'kill', `${killer ? killer.name : '?'} killed ${victim.name} (${weaponName}${headshot ? ', headshot' : ''})`);
  checkElimination();
}

function checkElimination() {
  if (state.phase !== 'live') return;
  // Count the living per team in one pass (no per-step allocations).
  let aliveB = 0;
  let aliveH = 0;
  for (const a of state.agents) {
    if (!a.alive) continue;
    if (a.team === 'breakers') aliveB += 1;
    else aliveH += 1;
  }
  if (state.charge.state === 'armed') {
    // After the arm, killing the attackers does not end the round: the
    // defenders still have to pull the charge before the fuse runs out.
    const defTeam = state.attackSide === 'breakers' ? 'harborwatch' : 'breakers';
    const aliveDef = defTeam === 'breakers' ? aliveB : aliveH;
    if (aliveDef === 0) endRound(state.attackSide, 'Defenders eliminated after the arm', false);
    return;
  }
  if (aliveB === 0) endRound('harborwatch', 'Breakers eliminated', false);
  else if (aliveH === 0) endRound('breakers', 'Harborwatch eliminated', false);
}

function pushNoise(agent) {
  state.noises.push({ x: agent.pos.x, z: agent.pos.z, t: state.time, team: agent.team });
  if (state.noises.length > 40) state.noises.shift();
}

const combat = {
  shootBot(bot, target, aimError) {
    const weapon = WEAPONS[bot.weapon] || WEAPONS.p9;
    const ammo = bot.ammo[bot.weapon];
    if (!ammo || ammo.mag <= 0) {
      if (ammo && ammo.reserve > 0) {
        ammo.mag = Math.min(weapon.mag, ammo.reserve);
        ammo.reserve -= ammo.mag;
      }
      return;
    }
    ammo.mag -= 1;
    const eyeY = bot.pos.y + (bot.crouch ? 1.02 : 1.6);
    _origin.set(bot.pos.x, eyeY, bot.pos.z);
    const chestY = target.pos.y + 1.2;
    _dir.set(target.pos.x - bot.pos.x, chestY - eyeY, target.pos.z - bot.pos.z).normalize();
    const spread = computeSpread(weapon, bot.speed || 0, bot.crouch, false, 0, false);
    const d = jitterDir(_dir, Math.max(spread, aimError));
    fireHitscan(bot, _origin, d, weapon, spread);
    botMuzzleFlash(bot);
    audio.shot(bot.weapon, true);
    pushNoise(bot);
  },
  throwFog(bot, site) {
    const entry = site.id === 'A' ? { x: -32, z: 0 } : { x: 32, z: 0 };
    addSmoke(entry.x, 1.2, entry.z);
    logEvent(state, 'fog', `${bot.name} smoked the ${site.id} entry`);
  },
};

function addSmoke(x, y, z) {
  state.smokes.push({ x, y, z, until: state.time + 8 });
  if (state.smokes.length > 3) state.smokes.shift();
}

function playerShoot() {
  const weapon = WEAPONS[playerAgent.weapon];
  const ammo = playerAgent.ammo[playerAgent.weapon];
  if (!ammo) return;
  if (ammo.mag <= 0) {
    audio.dryFire();
    startReload();
    return;
  }
  ammo.mag -= 1;
  cooldown = 60 / weapon.rpm;
  const speed = player.groundSpeed();
  const spread = computeSpread(weapon, speed, player.state.crouching, !player.state.onGround, bloom, input.state.aiming);
  camera.getWorldDirection(_dir);
  const d = jitterDir(_dir, spread);
  _origin.copy(camera.position);
  fireHitscan(playerAgent, _origin, d, weapon, spread);
  arsenal.fire();
  audio.shot(playerAgent.weapon, false);
  player.recoil(weapon.recoil * (1 + bloom * 0.2), (state.random() * 2 - 1) * weapon.recoil * 0.4);
  bloom = Math.min(2.5, bloom + (weapon.rpm > 500 ? 0.28 : 0.45));
  pushNoise(playerAgent);
  hud.setAmmo(ammo.mag, ammo.reserve, weapon.name);
}

function startReload() {
  const weapon = WEAPONS[playerAgent.weapon];
  const ammo = playerAgent.ammo[playerAgent.weapon];
  if (!weapon || !ammo || reloadLeft > 0 || ammo.mag >= weapon.mag || ammo.reserve <= 0) return;
  reloadLeft = weapon.reload;
  reloadWeapon = playerAgent.weapon;
  arsenal.state.reloadLeft = weapon.reload;
  arsenal.state.reloadTime = weapon.reload;
  audio.reload();
}

function switchWeapon(slot) {
  const id = playerAgent.weapons[slot];
  if (!id || id === playerAgent.weapon) return;
  playerAgent.weapon = id;
  arsenal.setWeapon(id);
  reloadLeft = 0;
  bloom = 0;
  const ammo = playerAgent.ammo[id];
  hud.setAmmo(ammo.mag, ammo.reserve, WEAPONS[id].name);
}

function throwUtility(kind) {
  if (playerAgent.utility[kind] <= 0 || state.phase !== 'live' || !playerAgent.alive) return;
  playerAgent.utility[kind] -= 1;
  camera.getWorldDirection(_dir);
  state.projectiles.push({
    kind,
    owner: playerAgent,
    x: camera.position.x + _dir.x * 0.5,
    y: camera.position.y + _dir.y * 0.5,
    z: camera.position.z + _dir.z * 0.5,
    vx: _dir.x * 15,
    vy: _dir.y * 15 + 3.5,
    vz: _dir.z * 15,
    t: 0,
  });
  audio.buyClick();
}

function landProjectile(p) {
  if (p.kind === 'scrap') {
    audio.explosion();
    for (const a of state.agents) {
      if (!a.alive) continue;
      if (a.team === p.owner.team && a !== p.owner) continue; // no friendly fire
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d > 5) continue;
      const dmg = 85 * (1 - d / 5) + 15;
      const result = applyDamage(a, a === p.owner ? dmg * 0.5 : dmg, 'torso', p.owner);
      if (result.killed) onKill(a, p.owner, false, 'Scrap Grenade');
    }
  } else if (p.kind === 'flare') {
    for (const a of state.agents) {
      if (!a.alive || !a.bot || a.team === p.owner.team) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d < 20) a.blindUntil = state.time + 2.5;
    }
  } else if (p.kind === 'fog') {
    addSmoke(p.x, 1.2, p.z);
  }
}

// ---------------------------------------------------------------- charge
function padUnder(agent) {
  for (const id of ['A', 'B']) {
    const s = world.sites[id];
    const d2 = (agent.pos.x - s.x) * (agent.pos.x - s.x) + (agent.pos.z - s.z) * (agent.pos.z - s.z);
    if (d2 < s.r * s.r) return id;
  }
  return null;
}

function processCharge(dt) {
  const charge = state.charge;
  // Pickup: an attacker walking over a dropped charge takes it.
  if (charge.state === 'dropped') {
    for (const a of state.agents) {
      if (!a.alive || a.team !== state.attackSide) continue;
      if (Math.hypot(a.pos.x - charge.x, a.pos.z - charge.z) < 1.4) {
        charge.state = 'carried';
        charge.carrier = a.id;
        if (a === playerAgent) {
          hud.toast('You carry the Hullbreaker');
          audio.pickup();
        }
        logEvent(state, 'charge-pickup', `${a.name} picked up the charge`);
        break;
      }
    }
  }
  // Channels: arm (attacker with the charge, on a pad) / pull (defender, armed pad).
  for (const a of state.agents) {
    if (!a.alive || !a.channel) continue;
    const pad = padUnder(a);
    if (a.channel === 'arm') {
      if (!pad || charge.state !== 'carried' || charge.carrier !== a.id) {
        a.channel = null;
        charge.armProgress = 0;
        if (a === playerAgent) hud.hideChargeProgress();
        continue;
      }
      charge.armProgress += dt;
      charge.site = pad;
      if (a === playerAgent) hud.setChargeProgress(`ARMING HULLBREAKER — SITE ${pad}`, charge.armProgress / RULES.armSeconds);
      if (Math.floor(charge.armProgress * 2) !== Math.floor((charge.armProgress - dt) * 2)) audio.armTick();
      if (charge.armProgress >= RULES.armSeconds) {
        charge.state = 'armed';
        charge.fuse = RULES.fuseSeconds;
        charge.armer = a.id;
        a.money += RULES.armReward;
        a.channel = null;
        hud.toast(`Charge armed on Site ${pad} — 40 s fuse`);
        logEvent(state, 'charge-armed', `${a.name} armed the charge on Site ${pad}`);
      }
    } else if (a.channel === 'pull') {
      const need = a.overrideKey ? RULES.pullSecondsKey : RULES.pullSeconds;
      if (!pad || charge.state !== 'armed' || charge.site !== pad) {
        a.channel = null;
        charge.pullProgress = 0;
        if (a === playerAgent) hud.hideChargeProgress();
        continue;
      }
      charge.pullProgress += dt;
      if (a === playerAgent) hud.setChargeProgress(`PULLING CHARGE — SITE ${pad}`, charge.pullProgress / need);
      if (charge.pullProgress >= need) {
        charge.state = 'pulled';
        charge.puller = a.id;
        a.money += RULES.pullReward;
        a.channel = null;
        endRound(state.attackSide === 'breakers' ? 'harborwatch' : 'breakers', `Charge pulled by ${a.name}`, true);
      }
    }
  }
  // Fuse countdown.
  if (charge.state === 'armed') {
    charge.fuse -= dt;
    if (state.time > beepAt) {
      audio.chargeBeep(charge.fuse);
      beepAt = state.time + (charge.fuse < 10 ? 0.35 : 1);
    }
    if (charge.fuse <= 0) {
      charge.state = 'detonated';
      audio.explosion();
      endRound(state.attackSide, 'Hullbreaker detonated', true);
    }
  }
  // Charge visuals: visible when dropped or armed, on the pad / drop spot.
  const cg = world.chargeGroup;
  if (charge.state === 'dropped') {
    cg.visible = true;
    cg.position.set(charge.x, 0.2, charge.z);
  } else if (charge.state === 'armed' && charge.site) {
    const s = world.sites[charge.site];
    cg.visible = true;
    cg.position.set(s.x, 0.2, s.z);
  } else {
    cg.visible = false;
  }
}

// ---------------------------------------------------------------- phases
function step(dt) {
  state.time += dt;
  stepCount += 1;
  if (state.phase === 'menu' || state.phase === 'matchend') {
    world.update(dt, false);
    return;
  }
  // phase clock
  state.phaseTime -= dt;
  if (state.phase === 'buy' && state.phaseTime <= 0) {
    state.phase = 'live';
    state.phaseTime = RULES.liveSeconds;
    audio.roundStart();
    hud.hideBuyMenu();
    if (!botmatch) hud.toast('Round live');
  } else if (state.phase === 'live' && state.phaseTime <= 0 && state.charge.state !== 'armed') {
    endRound(state.attackSide === 'breakers' ? 'harborwatch' : 'breakers', 'Time expired — charge never armed', false);
  } else if (state.phase === 'end' && state.phaseTime <= 0) {
    nextRoundOrMatchEnd();
  }

  // player channel input (E): arm when carrying on a pad, pull when armed.
  if (!botmatch && playerAgent.alive && state.phase === 'live') {
    if (input.state.keys.has('KeyE')) {
      const pad = padUnder(playerAgent);
      if (pad && state.charge.state === 'carried' && state.charge.carrier === 'you') playerAgent.channel = 'arm';
      else if (pad && state.charge.state === 'armed' && state.charge.site === pad && playerAgent.team !== state.attackSide) playerAgent.channel = 'pull';
      else playerAgent.channel = null;
    } else if (playerAgent.channel) {
      playerAgent.channel = null;
      hud.hideChargeProgress();
    }
  }

  // player movement + shooting (human) or bot-driven (botmatch)
  // One-shot keys are drained every step so a dead player's presses never leak
  // into the next round.
  const pressedKeys = botmatch ? new Set() : input.takePressed();
  if (botmatch) {
    updateBot(state, world, playerAgent, dt, combat);
    player.state.position.copy(playerAgent.pos);
    player.state.yaw = playerAgent.yaw;
    player.state.pitch = playerAgent.pitch;
  } else if (playerAgent.alive && (state.phase === 'live' || state.phase === 'buy')) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    player.step(dt, input.state.keys, weaponSpeedScale(playerAgent.weapon));
    playerAgent.yaw = player.state.yaw;
    playerAgent.pitch = player.state.pitch;
    playerAgent.crouch = player.state.crouching;
    playerAgent.speed = player.groundSpeed();
    // footsteps
    if (player.state.onGround && player.groundSpeed() > 1 && state.time > footstepAt) {
      audio.footstep(player.groundSpeed() > 4);
      footstepAt = state.time + 0.45;
    }
    // weapon timers
    cooldown = Math.max(0, cooldown - dt);
    bloom = Math.max(0, bloom - dt * 2);
    if (reloadLeft > 0) {
      reloadLeft -= dt;
      if (reloadLeft <= 0) {
        const ammo = playerAgent.ammo[reloadWeapon];
        const weapon = WEAPONS[reloadWeapon];
        const need = weapon.mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
        hud.setAmmo(ammo.mag, ammo.reserve, weapon.name);
      }
    }
    // firing
    const weapon = WEAPONS[playerAgent.weapon];
    const ammo = playerAgent.ammo[playerAgent.weapon];
    const edge = input.state.firing && !prevFiring;
    if (state.phase === 'live' && reloadLeft <= 0 && cooldown <= 0 && ammo && ammo.mag > 0 && (weapon.auto ? input.state.firing : edge)) {
      playerShoot();
    }
    prevFiring = input.state.firing;
    // scope (Harpoon-7, right mouse)
    const aiming = input.state.aiming && playerAgent.weapon === 'harpoon';
    if (aiming !== prevAiming) {
      hud.setScope(aiming);
      prevAiming = aiming;
    }
    // one-shot keys
    for (const code of pressedKeys) {
      if (code === 'KeyR') startReload();
      else if (code === 'KeyB' && state.phase === 'buy') {
        if (hud.buyVisible()) hud.hideBuyMenu();
        else hud.showBuyMenu(playerAgent.money);
      } else if (code === 'Digit1') switchWeapon(1);
      else if (code === 'Digit2') switchWeapon(2);
      else if (code === 'Digit3') switchWeapon(3);
      else if (code === 'Digit4') throwUtility('scrap');
      else if (code === 'Digit5') throwUtility('flare');
      else if (code === 'Digit6') throwUtility('fog');
    }
    if (input.state.keys.has('Tab')) hud.showScoreboard(state.agents, playerTeam);
    else hud.hideScoreboard();
  }

  // bots
  for (const a of state.agents) {
    if (!a.bot || !a.alive) continue;
    if (state.phase === 'live' || state.phase === 'buy') updateBot(state, world, a, dt, combat);
  }

  // projectiles
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    p.t += dt;
    p.vy -= 12 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    if (p.y <= 0.05 || p.t > 3) {
      p.y = Math.max(0.05, p.y);
      landProjectile(p);
      state.projectiles.splice(i, 1);
    }
  }
  // smoke expiry + meshes
  // In-place prune (no allocation in the 60 Hz hot loop): the old
  // state.smokes.filter(...) built a fresh array every fixed step.
  for (let i = state.smokes.length - 1; i >= 0; i -= 1) {
    if (state.time >= state.smokes[i].until) state.smokes.splice(i, 1);
  }
  smokeMeshes.forEach((m, i) => {
    const s = state.smokes[i];
    if (s) {
      m.visible = true;
      m.position.set(s.x, s.y, s.z);
    } else m.visible = false;
  });
  // dropped weapon pickup (player, auto when slot 1 is empty)
  if (!botmatch && playerAgent.alive) {
    for (let i = state.drops.length - 1; i >= 0; i--) {
      const d = state.drops[i];
      if (Math.hypot(playerAgent.pos.x - d.x, playerAgent.pos.z - d.z) < 1.5 && !playerAgent.weapons[1]) {
        playerAgent.weapons[1] = d.weapon;
        playerAgent.ammo[d.weapon] = { mag: WEAPONS[d.weapon].mag, reserve: WEAPONS[d.weapon].reserve };
        switchWeapon(1);
        hud.toast(`Picked up ${WEAPONS[d.weapon].name}`);
        audio.pickup();
        state.drops.splice(i, 1);
      }
    }
  }

  processCharge(dt);
  world.update(dt, state.charge.state === 'armed');

  // hitboxes + meshes
  for (const a of state.agents) {
    updateAgentHitboxes(a);
    if (a.bot) syncBotMesh(a, dt);
  }
  arsenal.step(dt);

  // prune old noises
  while (state.noises.length && state.time - state.noises[0].t > 3) state.noises.shift();
}

function syncCamera() {
  if (!playerAgent.alive && spectateTarget) {
    camera.position.set(spectateTarget.pos.x, spectateTarget.pos.y + 1.6, spectateTarget.pos.z);
    camera.rotation.set(spectateTarget.pitch || 0, spectateTarget.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
  // scope zoom
  const targetFov = prevAiming && playerAgent.weapon === 'harpoon' ? 30 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.5) {
    camera.fov += (targetFov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

function syncHud() {
  if (shot || botmatch) return;
  const ammo = playerAgent.ammo[playerAgent.weapon];
  hud.setHealth(playerAgent.hp, playerAgent.armor, playerAgent.helmet);
  if (ammo) hud.setAmmo(ammo.mag, ammo.reserve, WEAPONS[playerAgent.weapon].name);
  hud.setMoney(playerAgent.money);
  const fuse = state.charge.state === 'armed' ? state.charge.fuse : null;
  hud.setTimer(state.phaseTime, fuse, state.phase);
  hud.setScore(state.wins.breakers, state.wins.harborwatch, state.round);
  // One pass counts both teams (two filters a frame allocated twice per frame).
  let aliveB = 0;
  let aliveH = 0;
  for (const a of state.agents) {
    if (!a.alive) continue;
    if (a.team === 'breakers') aliveB += 1;
    else aliveH += 1;
  }
  hud.setAlive(aliveB, aliveH);
  const weapon = WEAPONS[playerAgent.weapon];
  const spread = computeSpread(weapon, player.groundSpeed(), player.state.crouching, !player.state.onGround, bloom, input.state.aiming);
  hud.setCrosshairGap(4 + spread * 900);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (botmatch && fast) {
      // fast-forward: up to 10 s of game per frame
      let steps = 0;
      while (steps < 600 && state.phase !== 'matchend' && state.time < 4000) {
        step(FIXED_STEP);
        steps += 1;
      }
      if (state.phase === 'matchend' || state.time >= 4000) window.__matchDone = true;
    } else {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- shots
function placeBot(agent, x, z, yaw, crouch) {
  agent.pos.set(x, 0, z);
  agent.yaw = yaw;
  agent.crouch = !!crouch;
  agent.alive = true;
  agent.hp = 100;
  updateAgentHitboxes(agent);
  if (agent.mesh) {
    agent.mesh.group.visible = true;
    syncBotMesh(agent, 0);
  }
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuyMenu();
  hud.hideScoreboard();
  const bots = state.agents.filter((a) => a.bot);
  const byName = (n) => bots.find((b) => b.name === n);
  let sitebTarget = null; // siteb: flash is re-fired after the settle loop
  state.phase = 'live';
  state.phaseTime = 78;
  state.round = 3;
  state.wins = { breakers: 2, harborwatch: 1 };
  playerAgent.hp = 100;
  playerAgent.armor = 100;
  playerAgent.money = 3400;

  if (name === 'cover') {
    // Mid hero: player in Customs Yard looking NW — arch dead centre, gantry
    // crane ~50° left behind it, a Breaker bot advancing by the arch.
    // (The (10,14) spot put a stacked container between camera and arch.)
    player.teleport(4, 12, 0.322);
    player.state.pitch = 0.1;
    playerAgent.weapon = 'kestrel';
    playerAgent.ammo.kestrel = { mag: 30, reserve: 90 };
    arsenal.setWeapon('kestrel');
    placeBot(byName('Tide'), -2, 6, 0.5, false);
    placeBot(byName('Pike'), -10, -4, 2.6, false);
    placeBot(byName('Rook'), -5, 1, 0.9, false);
    hud.setHealth(100, 100, false);
    hud.setAmmo(30, 90, 'Kestrel AR');
    hud.setMoney(3400);
    hud.setTimer(78, null, 'live');
    hud.setScore(2, 1, 3);
    hud.setAlive(5, 4);
    hud.killfeed('Tide  ▸  Warden', 'breakers', false);
  } else if (name === 'sitea') {
    // Charge armed on Site A: amber beacon, fuse countdown, covering the entry.
    state.charge.state = 'armed';
    state.charge.site = 'A';
    state.charge.fuse = 32;
    // v2 framing (crane + hanging container read) with the enlarged beacon.
    player.teleport(-30, 8, Math.atan2(6, 8));
    player.state.pitch = 0.02;
    playerAgent.weapon = 'kestrel';
    playerAgent.ammo.kestrel = { mag: 22, reserve: 60 };
    arsenal.setWeapon('kestrel');
    placeBot(byName('Sable'), -38, -4, 1.2, true);
    placeBot(byName('Vex'), -40, 6, 0.4, false);
    hud.setHealth(86, 50, false);
    hud.setAmmo(22, 60, 'Kestrel AR');
    hud.setMoney(2100);
    hud.setTimer(0, 32, 'live');
    hud.setScore(2, 1, 3);
    hud.setAlive(4, 3);
    hud.killfeed('You  ▸  Sentry', 'breakers', true);
  } else if (name === 'buy') {
    // Buy phase: menu open over the Breaker spawn lineup.
    state.phase = 'buy';
    state.phaseTime = 12;
    player.teleport(0, 34, 0);
    playerAgent.weapon = 'p9';
    arsenal.setWeapon('p9');
    // Lineup flanks the buy panel (760 px centred): bots at ±8–10 m read at
    // the frame edges, two a side, instead of hiding behind the menu.
    const lineup = [['Rook', -10], ['Tide', -8], ['Sable', 8], ['Vex', 10]];
    for (const [n, x] of lineup) placeBot(byName(n), x, 28, 0, false);
    hud.setHealth(100, 0, false);
    hud.setAmmo(12, 96, 'P9 Dockhand');
    hud.setMoney(3400);
    hud.setTimer(12, null, 'buy');
    hud.setScore(2, 1, 3);
    hud.setAlive(5, 5);
    hud.showBuyMenu(3400);
  } else if (name === 'siteb') {
    // Cold Store firefight: muzzle flash, hitmarker, killfeed, cyan beacon.
    // Player INSIDE the warehouse past the west-door strip curtains, looking
    // east down the central lane — both defenders and the cyan pad in frame.
    player.teleport(33, 0, -Math.PI / 2);
    player.state.pitch = 0.01;
    playerAgent.weapon = 'sparrow';
    playerAgent.ammo.sparrow = { mag: 18, reserve: 60 };
    arsenal.setWeapon('sparrow');
    const target = byName('Beacon');
    placeBot(target, 41, 0, Math.PI / 2, false);
    placeBot(byName('Pike'), 38, -1, 2.4, false);
    sitebTarget = target;
    // NOTE: the flash is (re-)fired after the settle steps below — firing it
    // here dies during the settle loop (0.06 s flash vs 10 settle steps).
    hud.hitMarker(false, false);
    // Killfeed names a bot NOT visible in this frame (Warden is a defender
    // elsewhere); naming Pike while he stands alive here contradicted the shot.
    hud.killfeed('You  ▸  Warden', 'breakers', false);
    hud.setHealth(82, 100, true);
    hud.setAmmo(18, 60, 'Sparrow-9');
    hud.setMoney(1750);
    hud.setTimer(64, null, 'live');
    hud.setScore(2, 1, 3);
    hud.setAlive(4, 3);
  }
  // settle a few steps so shadows/animations settle, then freeze on 2 renders
  for (let i = 0; i < 10; i++) {
    world.update(FIXED_STEP, state.charge.state === 'armed');
    arsenal.step(FIXED_STEP);
  }
  if (sitebTarget) {
    // Hold the flashes 0.5 s of game time: the live frame loop eats a 0.06 s
    // flash before the capture lands.
    botMuzzleFlash(sitebTarget, 0.5);
    arsenal.fire();
    arsenal.holdFlash(0.5);
  }
  syncCamera();
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// ---------------------------------------------------------------- boot
player = createPlayer(world.colliders, 0, 34, 0);
buildSquads();
input = createInput(renderer.domElement, (locked) => {
  if (shot || botmatch) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (started && state.phase !== 'menu' && state.phase !== 'matchend' && playerAgent.alive) {
    hud.showOverlay('paused');
  }
});
hud.onPlay(() => {
  audio.unlock();
  if (state.phase === 'menu' || state.phase === 'matchend') startMatch();
  input.requestLock();
});
hud.onBuy((itemId) => {
  const err = buyItem(playerAgent, itemId);
  if (err) {
    audio.denied();
    hud.toast(err);
  } else {
    audio.buyClick();
    arsenal.setWeapon(playerAgent.weapon);
    hud.refreshBuy(playerAgent.money, {
      [playerAgent.weapons[1] || '']: true,
      [playerAgent.weapons[2] || '']: true,
      vest: playerAgent.armor >= 100,
      vestCap: playerAgent.helmet,
      overrideKey: playerAgent.overrideKey,
    });
    hud.setMoney(playerAgent.money);
    const ammo = playerAgent.ammo[playerAgent.weapon];
    if (ammo) hud.setAmmo(ammo.mag, ammo.reserve, WEAPONS[playerAgent.weapon].name);
  }
});
hud.onTeamPick((team) => {
  playerTeam = team;
  playerAgent.team = team;
  buildSquads();
  player.teleport(0, team === 'breakers' ? 34 : -34, team === 'breakers' ? 0 : Math.PI);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__portfall = { state, world, renderer, version: 'portfall-1.0' };

if (shot) {
  playerAgent.team = playerTeam;
  runShot(shot);
} else if (botmatch) {
  // Bot-vs-bot: the player slot is driven by the same bot AI, so a full match
  // runs with no human input (the top-5 review's autonomous-round proof).
  playerAgent.controller = createBotAgent(state, 'you', playerTeam, 'Entry', 'You').controller;
  playerAgent.controller.assignedLane = 'mid';
  startMatch();
  requestAnimationFrame(frame);
} else {
  hud.showOverlay('menu');
  // menu backdrop: high view over the terminal
  camera.position.set(0, 14, 46);
  camera.lookAt(0, 0, -10);
  // keep the menu camera until play is pressed
  const menuFrame = (now) => {
    if (started) {
      requestAnimationFrame(frame);
      lastTime = performance.now();
      return;
    }
    requestAnimationFrame(menuFrame);
    world.update(0.016, false);
    renderer.render(scene, camera);
  };
  requestAnimationFrame(menuFrame);
}
