// PORTFALL input: keyboard + mouse + pointer lock. Plain browser APIs only.
// Keys: WASD move, mouse look, click fire, R reload, B buy menu, E arm/pull,
// 1/2/3 weapon slots, Tab scoreboard, Shift sneak, Ctrl/C crouch, Space jump,
// right mouse aims (sniper scope). Also tracks pressed edges for one-shot keys.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered keys, consumed by takePressed()
  const state = { keys, locked: false, firing: false, aiming: false, lookX: 0, lookY: 0 };

  function setKey(event, down) {
    if (event.code === 'Tab') event.preventDefault();
    if (event.code === 'Space') event.preventDefault();
    if (down) {
      if (!keys.has(event.code)) pressed.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    state.aiming = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(state.locked);
  });

  const lookOut = { x: 0, y: 0 }; // reused: takeLook runs every frame
  const pressedOut = []; // reused: takePressed runs every step, no new Set per step
  return {
    state,
    requestLock() {
      try {
        canvas.requestPointerLock();
      } catch {
        // headless / denied: the game still runs, keys still work
      }
    },
    takeLook() {
      lookOut.x = state.lookX;
      lookOut.y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return lookOut;
    },
    takePressed() {
      // Copy first into the reused array: returning the live set and clearing
      // it empties the caller's copy too, which killed every one-shot key
      // (R/B/1-2-3/4-5-6). The caller only iterates the result within its step.
      pressedOut.length = 0;
      for (const code of pressed) pressedOut.push(code);
      pressed.clear();
      return pressedOut;
    },
  };
}
