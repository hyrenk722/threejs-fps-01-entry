// PORTFALL central state: ONE object holds the whole match. Every module reads and
// writes through it; nothing keeps a second copy of round, phase or money.
// Also: the fixed-seed PRNG (mulberry32), shared math helpers, and the ray-vs-AABB
// shooter the whole game uses (fast slab test against invisible box proxies, never
// triangle raycasts against merged render geometry).

export const FIXED_STEP = 1 / 60;

// Match rules, locked by the design brief.
export const RULES = {
  roundsToWin: 9,
  maxRounds: 16,
  swapAfterRound: 8,
  buySeconds: 15,
  liveSeconds: 105,
  fuseSeconds: 40,
  armSeconds: 4,
  pullSeconds: 6,
  pullSecondsKey: 3,
  endSeconds: 5,
  startMoney: 800,
  winElim: 1900,
  winObjective: 2100,
  lossBase: 1400,
  lossStreakStep: 500,
  lossCap: 2900,
  killReward: 300,
  armReward: 300,
  pullReward: 300,
};

// Teams. The player picks one on the menu; default Breakers (attack first).
export const TEAMS = {
  breakers: { id: 'breakers', name: 'Breakers', color: '#d95f2b', attack: true },
  harborwatch: { id: 'harborwatch', name: 'Harborwatch', color: '#3fa7c4', attack: false },
};

export function mulberry32(initial) {
  let a = initial >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

// Ray vs axis-aligned box (slab test). Returns the distance along the ray, or -1.
// Used for every shot and every line-of-sight check: the world keeps one flat list
// of AABB proxies, so a shot never walks merged render triangles. Scalar-only:
// the hot loop calls this once per collider per pellet, so it must not allocate.
export function rayBox(ox, oy, oz, dx, dy, dz, box, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (ox < box.min.x || ox > box.max.x) return -1;
  } else {
    let t1 = (box.min.x - ox) / dx;
    let t2 = (box.max.x - ox) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y slab
  if (Math.abs(dy) < 1e-9) {
    if (oy < box.min.y || oy > box.max.y) return -1;
  } else {
    let t1 = (box.min.y - oy) / dy;
    let t2 = (box.max.y - oy) / dy;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (oz < box.min.z || oz > box.max.z) return -1;
  } else {
    let t1 = (box.min.z - oz) / dz;
    let t2 = (box.max.z - oz) / dz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// The one match object. `agents` holds the player (index 0 of their team) plus 9
// bots; each agent is {id, name, team, role, bot, alive, hp, armor, helmet, money,
// weapon, pos: Vector3-like {x,y,z}, yaw, pitch, crouch, kills, deaths, ...}.
export function createState(seed) {
  return {
    seed,
    random: mulberry32(seed),
    time: 0, // match clock, seconds of fixed steps
    phase: 'menu', // menu | buy | live | end | matchend
    phaseTime: 0, // seconds left in the current phase
    round: 1,
    wins: { breakers: 0, harborwatch: 0 },
    // Sides swap after round 8: attackSide names the team currently attacking.
    attackSide: 'breakers',
    charge: {
      state: 'carried', // carried | dropped | armed | pulled | detonated
      carrier: null, // agent id carrying it
      x: 0, y: 0, z: 0, // dropped position
      site: null, // 'A' | 'B' when armed
      fuse: 0,
      armProgress: 0,
      pullProgress: 0,
      armer: null,
      puller: null,
    },
    agents: [],
    killfeed: [], // {text, t, killer, victim, headshot}
    events: [], // plain log for tests: {t, kind, text}
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    lossStreak: { breakers: 0, harborwatch: 0 },
    started: false,
    frozen: false, // screenshot freeze
    shotMode: null,
  };
}

export function logEvent(state, kind, text) {
  state.events.push({ t: +state.time.toFixed(2), kind, text });
  if (state.events.length > 400) state.events.shift();
}
