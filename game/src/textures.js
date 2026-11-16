// PORTFALL textures: every surface is a canvas texture generated at boot.
// Zero external assets, zero network. One texture per container colour, shared by
// every container of that colour; stencils ("KESTREL", "BERTH 9", site letters)
// are painted into the canvas so they read in screenshots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function speckle(ctx, w, h, n, color, alpha) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.3 + Math.random() * 0.7);
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  ctx.globalAlpha = 1;
}

function makeAsphalt() {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = PALETTE.asphalt;
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 2600, '#3a3e45', 0.5);
  speckle(ctx, 512, 512, 900, '#17191d', 0.6);
  // wet sheen streaks
  ctx.fillStyle = '#4a5560';
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.08;
    const y = Math.random() * 512;
    ctx.fillRect(0, y, 512, 2 + Math.random() * 8);
  }
  ctx.globalAlpha = 1;
  // faded yard line
  ctx.fillStyle = PALETTE.asphaltLine;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, 248, 512, 10);
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeContainer(color, label, sub) {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 256);
  // corrugation: vertical ribs
  for (let x = 0; x < 512; x += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x, 0, 5, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x + 8, 0, 4, 256);
  }
  // rust streaks from the top edge
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = 'rgba(30,16,8,0.25)';
    const x = Math.random() * 512;
    ctx.fillRect(x, 0, 2 + Math.random() * 5, 20 + Math.random() * 70);
  }
  speckle(ctx, 512, 256, 500, '#000000', 0.25);
  // stencil
  ctx.fillStyle = 'rgba(240,235,220,0.88)';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, 256, 118);
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(240,235,220,0.6)';
  ctx.fillText(sub, 256, 168);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeHazard() {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = PALETTE.hazard;
  for (let x = -64; x < 256; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 32, 0);
    ctx.lineTo(x + 64, 0);
    ctx.lineTo(x + 32, 64);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWarehouse() {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = PALETTE.warehouse;
  ctx.fillRect(0, 0, 512, 256);
  // insulated panel seams
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < 512; x += 64) ctx.fillRect(x, 0, 2, 256);
  ctx.fillRect(0, 120, 512, 2);
  // frost near the floor
  const grad = ctx.createLinearGradient(0, 180, 0, 256);
  grad.addColorStop(0, 'rgba(180,220,230,0)');
  grad.addColorStop(1, 'rgba(180,220,230,0.5)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 180, 512, 76);
  speckle(ctx, 512, 256, 300, '#9fb4b8', 0.3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSky() {
  const [c, ctx] = canvas(64, 512);
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(0.55, '#3d5a63');
  grad.addColorStop(0.78, PALETTE.skyMid);
  grad.addColorStop(1, PALETTE.skyLow);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 512);
  // low sun glow
  const glow = ctx.createRadialGradient(32, 430, 4, 32, 430, 90);
  glow.addColorStop(0, 'rgba(255,200,110,0.9)');
  glow.addColorStop(1, 'rgba(255,200,110,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 300, 64, 212);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCrate() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#7a5c38';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < 128; y += 32) ctx.fillRect(0, y, 128, 3);
  for (let x = 0; x < 128; x += 32) ctx.fillRect(x, 0, 3, 128);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 120, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCurtain() {
  const [c, ctx] = canvas(128, 256);
  ctx.clearRect(0, 0, 128, 256);
  for (let x = 0; x < 128; x += 16) {
    const grad = ctx.createLinearGradient(x, 0, x + 16, 0);
    grad.addColorStop(0, 'rgba(200,220,225,0.10)');
    grad.addColorStop(0.5, 'rgba(200,220,225,0.42)');
    grad.addColorStop(1, 'rgba(200,220,225,0.10)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 16, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createTextures() {
  return {
    asphalt: makeAsphalt(),
    rust: makeContainer(PALETTE.rust, 'KESTREL', 'BERTH 9 · KST-2210'),
    harbor: makeContainer(PALETTE.harbor, 'KESTREL', 'BERTH 9 · KST-1187'),
    mustard: makeContainer(PALETTE.mustard, 'BERTH 9', 'KESTREL BAY TERMINAL'),
    dockGreen: makeContainer(PALETTE.dockGreen, 'KESTREL', 'BERTH 9 · KST-9044'),
    hazard: makeHazard(),
    warehouse: makeWarehouse(),
    sky: makeSky(),
    crate: makeCrate(),
    curtain: makeCurtain(),
  };
}
