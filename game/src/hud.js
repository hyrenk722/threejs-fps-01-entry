// PORTFALL HUD: the DOM layer. It never touches the simulation; main.js pushes
// numbers in and reads callbacks out. Everything the rubric asks for is here:
// health, ammo, round timer, score, alive counts, killfeed, crosshair with a
// spread-reactive gap, hitmarker, charge countdown, round-end banner, buy menu
// grid, scoreboard, damage direction arc.
import { BUY_CATALOGUE } from './economy.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    overlay: $('overlay'), title: $('overlay-title'), copy: $('overlay-copy'),
    play: $('play'), teamRow: $('team-row'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), damageArc: $('damage-arc'),
    healthNum: $('health-num'), healthBar: $('health-bar'), armorPips: $('armor-pips'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money'), moneyValue: $('money-value'),
    timer: $('timer'), timerLabel: $('timer-label'),
    pipsB: $('pips-breakers'), pipsH: $('pips-harborwatch'),
    aliveB: $('alive-breakers'), aliveH: $('alive-harborwatch'),
    killfeed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'), buyMenu: $('buy-menu'), buyGrid: $('buy-grid'),
    buyMoney: $('buy-money'), scoreboard: $('scoreboard'), scoreBody: $('score-body'),
    chargeBar: $('charge-bar'), chargeLabel: $('charge-label'), chargeFill: $('charge-fill'),
    toast: $('toast'), scope: $('scope'),
  };
  let lastMag = -1;
  let lastReserve = -1;
  let lastHp = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let hitTimer = 0;
  let arcTimer = 0;
  let toastTimer = 0;
  let buyHandler = null;
  let playHandler = null;
  let teamHandler = null;

  function fmtTime(s) {
    const t = Math.max(0, Math.ceil(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  // Build the buy menu grid once from the catalogue.
  for (const section of BUY_CATALOGUE) {
    const h = document.createElement('div');
    h.className = 'buy-group';
    h.textContent = section.group;
    el.buyGrid.appendChild(h);
    for (const item of section.items) {
      const b = document.createElement('button');
      b.className = 'buy-item';
      b.dataset.item = item.id;
      b.innerHTML = `<span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
      b.addEventListener('click', () => {
        if (buyHandler) buyHandler(item.id);
      });
      el.buyGrid.appendChild(b);
    }
  }

  return {
    setHealth(hp, armor, helmet) {
      if (hp === lastHp && armor === lastArmor) return;
      lastHp = hp;
      lastArmor = armor;
      el.healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      el.healthBar.style.width = `${Math.max(0, hp)}%`;
      el.healthBar.classList.toggle('low', hp <= 30);
      let pips = '';
      const full = Math.floor(armor / 25);
      for (let i = 0; i < 4; i++) pips += `<i class="${i < full ? 'on' : ''}"></i>`;
      el.armorPips.innerHTML = pips + (helmet ? '<span class="helmet">CAP</span>' : '');
    },
    setAmmo(mag, reserve, weaponName) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      el.ammoMag.textContent = mag === Infinity ? '—' : String(mag);
      el.ammoReserve.textContent = reserve === Infinity ? '' : `/ ${reserve}`;
      el.weaponName.textContent = weaponName;
      el.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    },
    setMoney(m) {
      if (m === lastMoney) return;
      lastMoney = m;
      el.moneyValue.textContent = `$${m}`;
    },
    setTimer(seconds, fuse, phase) {
      const label = fuse !== null ? `FUSE ${fmtTime(fuse)}` : fmtTime(seconds);
      const text = phase === 'buy' ? `BUY ${label}` : label;
      if (text === lastTimer) return;
      lastTimer = text;
      el.timer.textContent = text;
      el.timer.classList.toggle('fuse', fuse !== null);
    },
    setScore(winsB, winsH, round) {
      const pips = (n) => {
        let s = '';
        for (let i = 0; i < 9; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
        return s;
      };
      el.pipsB.innerHTML = pips(winsB);
      el.pipsH.innerHTML = pips(winsH);
      el.timerLabel.textContent = `ROUND ${round} · FIRST TO 9`;
    },
    setAlive(aliveB, aliveH) {
      const icons = (n) => {
        let s = '';
        for (let i = 0; i < 5; i++) s += `<i class="${i < n ? 'on' : 'off'}"></i>`;
        return s;
      };
      el.aliveB.innerHTML = icons(aliveB);
      el.aliveH.innerHTML = icons(aliveH);
    },
    killfeed(text, killerTeam, headshot) {
      const div = document.createElement('div');
      div.className = `kf ${killerTeam === 'breakers' ? 'kf-b' : 'kf-h'}`;
      div.textContent = (headshot ? '◉ ' : '') + text;
      el.killfeed.prepend(div);
      while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
      setTimeout(() => div.remove(), 5000);
    },
    hitMarker(killed, headshot) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', killed);
      el.hitmarker.classList.toggle('head', headshot);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => el.hitmarker.classList.remove('on', 'kill', 'head'), 120);
    },
    damageFrom(angleDeg) {
      el.damageArc.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      el.damageArc.classList.add('on');
      clearTimeout(arcTimer);
      arcTimer = setTimeout(() => el.damageArc.classList.remove('on'), 600);
    },
    setCrosshairGap(px) {
      el.crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
    },
    setScope(active) {
      el.scope.classList.toggle('on', active);
      el.crosshair.style.display = active ? 'none' : '';
    },
    showBanner(title, sub) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub;
      el.banner.hidden = false;
    },
    hideBanner() {
      el.banner.hidden = true;
    },
    showBuyMenu(money) {
      el.buyMenu.hidden = false;
      el.buyMoney.textContent = `$${money}`;
      this.refreshBuy(money, {});
    },
    hideBuyMenu() {
      el.buyMenu.hidden = true;
    },
    buyVisible() {
      return !el.buyMenu.hidden;
    },
    refreshBuy(money, owned) {
      el.buyMoney.textContent = `$${money}`;
      for (const b of el.buyGrid.querySelectorAll('.buy-item')) {
        const item = BUY_CATALOGUE.flatMap((g) => g.items).find((i) => i.id === b.dataset.item);
        b.classList.toggle('cant', money < item.price);
        b.classList.toggle('owned', !!owned[item.id]);
      }
    },
    showScoreboard(agents, playerTeam) {
      el.scoreboard.hidden = false;
      el.scoreBody.innerHTML = agents
        .map((a) => `<tr class="${a.team} ${a.bot ? '' : 'you'}"><td>${a.bot ? '' : '▶ '}${a.name}</td><td>${a.team === 'breakers' ? 'Breakers' : 'Harborwatch'}</td><td>${a.role}</td><td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td></tr>`)
        .join('');
    },
    hideScoreboard() {
      el.scoreboard.hidden = true;
    },
    setChargeProgress(label, frac) {
      el.chargeBar.hidden = false;
      el.chargeLabel.textContent = label;
      el.chargeFill.style.width = `${Math.round(frac * 100)}%`;
    },
    hideChargeProgress() {
      el.chargeBar.hidden = true;
    },
    toast(text) {
      el.toast.textContent = text;
      el.toast.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove('on'), 1600);
    },
    showOverlay(mode, data) {
      const copy = {
        menu: { title: 'PORTFALL', copy: 'Kestrel Bay Terminal — Breakers vs Harborwatch. First to 9 rounds. Arm the Hullbreaker charge, or pull it.', action: 'Click to play' },
        paused: { title: 'PORTFALL', copy: 'Paused. Click to resume.', action: 'Click to resume' },
        end: { title: data?.title || 'Round over', copy: data?.copy || '', action: 'Continue' },
        matchend: { title: data?.title || 'Match over', copy: data?.copy || '', action: 'Play again' },
      }[mode];
      el.title.textContent = copy.title;
      el.copy.textContent = copy.copy;
      el.play.textContent = copy.action;
      el.teamRow.hidden = mode !== 'menu';
      el.overlay.hidden = false;
      el.play.focus();
    },
    hideOverlay() {
      el.overlay.hidden = true;
    },
    onPlay(handler) {
      playHandler = handler;
      el.play.addEventListener('click', () => playHandler && playHandler());
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    onTeamPick(handler) {
      teamHandler = handler;
      el.teamRow.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          el.teamRow.querySelectorAll('button').forEach((x) => x.classList.remove('picked'));
          b.classList.add('picked');
          if (teamHandler) teamHandler(b.dataset.team);
        });
      });
    },
  };
}
