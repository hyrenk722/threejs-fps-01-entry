// PORTFALL economy: wallets, round income, and the buy menu catalogue.
// Prices and income are the design brief's table, verbatim. One function buys
// (shared by the player and the bot buy AI); another settles a round's income.
import { RULES } from './state.js';
import { WEAPONS } from './weapons.js';

export const PRICES = {
  mule: 700, sparrow: 1250, breakwater: 1100, kestrel: 2700,
  gullwing: 3100, harpoon: 4350, vest: 650, vestCap: 1000,
  overrideKey: 400, scrap: 300, flare: 200, fog: 300,
};

// Buy menu catalogue: rows the HUD renders, in display order.
export const BUY_CATALOGUE = [
  { group: 'Primary', items: [
    { id: 'sparrow', name: 'Sparrow-9', desc: 'SMG · 800 RPM', price: PRICES.sparrow },
    { id: 'breakwater', name: 'Breakwater 12', desc: 'Shotgun · 8 pellets', price: PRICES.breakwater },
    { id: 'kestrel', name: 'Kestrel AR', desc: 'Rifle · 660 RPM', price: PRICES.kestrel },
    { id: 'gullwing', name: 'Gullwing DMR', desc: 'Marksman · 200 RPM', price: PRICES.gullwing },
    { id: 'harpoon', name: 'Harpoon-7', desc: 'Bolt sniper · scoped', price: PRICES.harpoon },
  ] },
  { group: 'Sidearm', items: [
    { id: 'mule', name: 'Mule .50', desc: 'Heavy pistol', price: PRICES.mule },
  ] },
  { group: 'Armour', items: [
    { id: 'vest', name: 'Weave Vest', desc: 'Armour 100 · absorbs 50%', price: PRICES.vest },
    { id: 'vestCap', name: 'Weave + Cap', desc: 'Armour 100 + helmet', price: PRICES.vestCap },
  ] },
  { group: 'Utility', items: [
    { id: 'overrideKey', name: 'Override Key', desc: 'Pull the charge in 3 s', price: PRICES.overrideKey },
    { id: 'scrap', name: 'Scrap Grenade', desc: 'Frag · 85 dmg', price: PRICES.scrap },
    { id: 'flare', name: 'Flare Pop', desc: 'Flash · blinds 2.5 s', price: PRICES.flare },
    { id: 'fog', name: 'Fog Canister', desc: 'Smoke · blocks sight 8 s', price: PRICES.fog },
  ] },
];

// Buy one item. Returns a short reason string, or null on success.
export function buyItem(agent, itemId) {
  const price = PRICES[itemId];
  if (price === undefined) return 'no such item';
  if (agent.money < price) return 'not enough money';
  if (itemId === 'vest' || itemId === 'vestCap') {
    if (agent.armor >= 100) return 'armour already full';
    agent.money -= price;
    agent.armor = 100;
    agent.helmet = itemId === 'vestCap' ? true : agent.helmet;
    return null;
  }
  if (itemId === 'overrideKey') {
    if (agent.overrideKey) return 'already carrying one';
    agent.money -= price;
    agent.overrideKey = true;
    return null;
  }
  if (itemId === 'scrap' || itemId === 'flare' || itemId === 'fog') {
    agent.money -= price;
    agent.utility[itemId] = (agent.utility[itemId] || 0) + 1;
    return null;
  }
  const weapon = WEAPONS[itemId];
  if (!weapon) return 'no such item';
  if (agent.weapons[weapon.slot] === itemId) return 'already owned';
  agent.money -= price;
  agent.weapons[weapon.slot] = itemId;
  agent.ammo[itemId] = { mag: weapon.mag, reserve: weapon.reserve };
  if (weapon.slot === 1) agent.weapon = itemId;
  return null;
}

// Round income, settled at round end. `objective` = won by detonation/pull.
// Losers keep their loss bonus even when dead (the else branch pays it
// regardless of `alive`).
export function settleRoundIncome(state, winnerTeam, objective) {
  for (const a of state.agents) {
    if (a.team === winnerTeam) {
      a.money += objective ? RULES.winObjective : RULES.winElim;
    } else {
      const streak = state.lossStreak[a.team];
      a.money += Math.min(RULES.lossCap, RULES.lossBase + RULES.lossStreakStep * streak);
    }
  }
  if (winnerTeam) {
    state.lossStreak[winnerTeam] = 0;
    state.lossStreak[winnerTeam === 'breakers' ? 'harborwatch' : 'breakers'] += 1;
  }
}

// Starting loadout: P9 Dockhand sidearm + Cargo Hook, $800.
export function freshLoadout(agent) {
  agent.weapons = { 1: null, 2: 'p9', 3: 'hook' };
  agent.weapon = 'p9';
  agent.ammo = {
    p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve },
    hook: { mag: Infinity, reserve: Infinity },
  };
  agent.utility = { scrap: 0, flare: 0, fog: 0 };
  agent.armor = 0;
  agent.helmet = false;
  agent.overrideKey = false;
  agent.money = RULES.startMoney;
}

// On death the player drops their primary weapon (pickup-able marker).
export function dropPrimary(agent) {
  const primary = agent.weapons[1];
  if (!primary) return null;
  agent.weapons[1] = null;
  if (agent.weapon === primary) agent.weapon = 'p9';
  return { weapon: primary, x: agent.pos.x, y: agent.pos.y, z: agent.pos.z };
}
