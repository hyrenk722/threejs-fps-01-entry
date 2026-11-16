// PORTFALL player movement: acceleration, friction, gravity, jump, crouch and
// collision with the map, resolved as a box against the world's AABBs one axis
// at a time. A step-up assist (0.55 m) lets the player climb the catwalk stairs
// and low crates without a jump. Pooled vectors only — no allocation per step.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const SNEAK_SPEED = 2.9; // Shift: slow, quiet, accurate
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;
const STEP_UP = 0.55;

export function createPlayer(colliders, startX, startZ, yaw) {
  const player = {
    position: new THREE.Vector3(startX, 0, startZ),
    velocity: new THREE.Vector3(),
    yaw,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    sneaking: false,
    height: STAND_HEIGHT,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  // Try to move horizontally; if a low obstacle blocks, step up onto it.
  function moveAxis(axis, delta) {
    if (delta === 0) return;
    const pos = player.position;
    const nx = axis === 'x' ? pos.x + delta : pos.x;
    const nz = axis === 'z' ? pos.z + delta : pos.z;
    if (!overlaps(nx, pos.y, nz, player.height, 0.04)) {
      if (axis === 'x') pos.x = nx;
      else pos.z = nz;
      return;
    }
    // step-up: raise the feet by the obstacle's top if it is low enough
    const hit = overlaps(nx, pos.y, nz, player.height, 0.04);
    if (hit && hit.max.y - pos.y <= STEP_UP && hit.max.y - pos.y > 0) {
      const lift = hit.max.y - pos.y + 0.02;
      if (!overlaps(nx, pos.y + lift, nz, player.height, 0.04)) {
        pos.y += lift;
        if (axis === 'x') pos.x = nx;
        else pos.z = nz;
        player.onGround = true;
        player.velocity.y = 0;
        return;
      }
    }
    if (axis === 'x') player.velocity.x = 0;
    else player.velocity.z = 0;
  }

  function step(dt, keys, speedScale) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    player.sneaking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !overlaps(player.position.x, player.position.y, player.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    let speed = player.crouching ? CROUCH_SPEED : player.sneaking ? SNEAK_SPEED : WALK_SPEED;
    speed *= speedScale || 1;
    const blend = Math.min(1, ((player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt) / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = JUMP_SPEED;
      player.onGround = false;
    }
    player.velocity.y -= GRAVITY * dt;

    moveAxis('x', player.velocity.x * dt);
    moveAxis('z', player.velocity.z * dt);

    player.position.y += player.velocity.y * dt;
    player.onGround = false;
    const hit = overlaps(player.position.x, player.position.y, player.position.z, player.height, 0);
    if (hit && player.velocity.y <= 0) {
      player.position.y = hit.max.y;
      player.velocity.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - player.height;
      player.velocity.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
    player.velocity.y = Math.max(-30, player.velocity.y);
  }

  return {
    state: player,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
    teleport(x, z, yaw) {
      player.position.set(x, 0, z);
      player.velocity.set(0, 0, 0);
      player.yaw = yaw;
      player.pitch = 0;
    },
  };
}
