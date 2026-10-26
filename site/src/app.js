// ============================================================
//  App entry: build level, bake probes, run the render loop
// ============================================================
import { Renderer } from './renderer.js';
import { buildLevel, WATER_Y, HALL } from './level.js';
import { V3, clamp } from './math.js';

const Q = new URLSearchParams(location.search);
const SCALE = parseFloat(Q.get('scale') || '1');
const SHOT = Q.get('shot') || '';
const num = (k, d) => { const v = Q.get(k); return v === null ? d : parseFloat(v); };
let FOCUS_OVERRIDE = false;

const SHOTS = {
  hero:    { pos: [0.0, 1.72, 20.5], tgt: [0.4, 2.4, -6.0], fov: 47 },
  water:   { pos: [-3.4, 0.55, 10.2], tgt: [1.2, 1.5, -3.0], fov: 42 },
  rings:   { pos: [1.8, 2.05, 12.6], tgt: [0.2, 1.15, 4.6], fov: 38 },
  colonn:  { pos: [7.2, 1.65, 14.0], tgt: [-2.0, 2.2, -8.0], fov: 52 },
  slide:   { pos: [-5.6, 1.9, 2.0], tgt: [4.6, 4.2, -6.4], fov: 55 },
  vault:   { pos: [-4.2, 1.35, 16.5], tgt: [0.0, 8.6, -4.0], fov: 62 },
  wide:    { pos: [0.0, 3.4, 22.0], tgt: [0.0, 2.6, -10.0], fov: 55 },
  edge:    { pos: [-1.0, 0.30, 8.4], tgt: [-2.6, -0.9, 3.2], fov: 44 },
  tile:    { pos: [6.4, 1.55, 6.0], tgt: [8.4, 1.30, 3.4], fov: 40 },
  deck:    { pos: [-8.6, 1.05, 13.0], tgt: [-9.6, 0.30, 4.0], fov: 46 },
  sun:     { pos: [-8.4, 1.55, -17.5], tgt: [1.6, 6.4, 8.0], fov: 54 },
  sun2:    { pos: [6.2, 1.30, -16.0], tgt: [-3.0, 5.6, 6.0], fov: 50 },
};

const canvas = document.getElementById('c');
let renderer = null, cam = null;
const t0 = performance.now();
let readyMs = 0;
const frames = [];

function fitCanvas() {
  // Must match the cap used by renderer.applyRenderSize, or the canvas backing
  // store and the render buffer disagree and the present pass rescales.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(2, Math.floor(window.innerWidth * dpr * SCALE));
  const h = Math.max(2, Math.floor(window.innerHeight * dpr * SCALE));
  canvas.width = w; canvas.height = h;
  return { w, h };
}

function setShot(name) {
  const s = SHOTS[name];
  if (!s) return;
  cam.pos = s.pos.slice();
  cam.target = s.tgt.slice();
  cam.fov = s.fov;
  syncLookFromCamera();
  if (renderer && !FOCUS_OVERRIDE) {
    const dx = s.tgt[0] - s.pos[0], dy = s.tgt[1] - s.pos[1], dz = s.tgt[2] - s.pos[2];
    renderer.focusDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

async function boot() {
  const { w, h } = fitCanvas();
  renderer = new Renderer(canvas);
  await renderer.ready;
  renderer.setSize(w, h);
  renderer.dynScale = 1.0;
  renderer._userScale = SCALE;
  // Supersampling factor. 1.25 is a good default; ?ss=1 disables it on weak GPUs,
  // ?ss=1.5 pushes it further on a strong one.
  renderer.ssaa = num('ss', 1.25);
  renderer.applyRenderSize();

  const level = buildLevel();
  const gpu = level.mesh.toGPU(renderer.gl);
  renderer.setGeometry(gpu);
  renderer.lights = level.lights.slice(0, 64);
  renderer.portals = (level.portals || []).slice(0, 10);

  cam = { pos: [0, 1.7, 20], target: [0, 2.2, -6], fov: 47 };
  setShot(SHOT || 'hero');

  renderer.bakeEnv(512);

  // live tuning hooks (?env=2&sun=1.2&exp=1.1&bloom=0.12&ssr=1)
  renderer.envIntensity = num('env', 0.16);
  renderer.sunScale = num('sun', 1.0);
  renderer.exposure = num('exp', 0.215);
  renderer.bloomStr = num('bloom', renderer.bloomStr);
  renderer.ssrOn = num('ssr', 1.0);
  renderer.shadowOn = num('sh', 1.0);
  renderer.fogAmount = num('fog', 0.58);
  renderer.lightScale = num('ls', renderer.lightScale);
  renderer.portalScale = num('ps', renderer.portalScale);
  renderer.sunColor = renderer.sunColor.map(c => c * renderer.sunScale);
  if (num('portal', 1) === 0) renderer.portals = [];

  renderer.giOn = num('gi', 1.0);
  renderer.volOn = num('vol', 1.0);
  renderer.giStrength = num('gis', 1.0);
  renderer.volStrength = num('vols', 1.0);
  renderer.volDensity = num('vold', 0.62);
  renderer.volAniso = num('vaniso', 0.72);
  renderer.volScatter = num('vscat', 1.5);
  renderer.volHazeY = num('vhaze', 0.30);
  renderer.volDebug = num('vdbg', 0.0);
  renderer.dofOn = num('dof', 1.0);
  renderer.aoRadius = num('aor', 0.75);
  renderer.debugView = num('dbg', 0.0);
  renderer.grain = num('grain', 0.010);
  renderer.waterCaustics = num('caus', 1.0);
  renderer.aperture = num('ap', 0.30);
  // White diffusion. Kept low by default: a little reads as soft glass, a lot
  // reads as a smeared lens.
  renderer.softAmt = num('soft', 0.22);
  if (Q.get('sundir') !== null) {
    const sd = Q.get('sundir').split(',').map(parseFloat);
    if (sd.length === 3 && sd.every(v => isFinite(v))) renderer.sunDir = V3.norm(sd);
  }
  renderer.volMaxDist = num('vmax', 46.0);
  // The hall is a closed white-tiled box: its upper hemisphere is a lit vault,
  // not open sky, so both lobes have to be tunable side by side.
  renderer.skyColor = (Q.get('sky') || '').split(',').map(parseFloat).filter(v => isFinite(v));
  if (renderer.skyColor.length !== 3) renderer.skyColor = [0.175, 0.160, 0.112];
  renderer.groundColor = (Q.get('gnd') || '').split(',').map(parseFloat).filter(v => isFinite(v));
  if (renderer.groundColor.length !== 3) renderer.groundColor = [0.470, 0.430, 0.335];
  if (Q.get('focus') !== null) { FOCUS_OVERRIDE = true; renderer.focusDist = num('focus', 9.0); }
  setShot(SHOT || 'hero');


  APP.tris = gpu.count / 3;
  APP.verts = gpu.verts;
  APP.lights = level.lights.length;

  window.addEventListener('resize', () => {
    const s = fitCanvas();
    renderer.setSize(s.w, s.h);
  });

  installInput();
  requestAnimationFrame(loop);
}

let hudAcc = 0;
const perfAcc = [];
const cpuFrames = [];
let lastFrameT = 0;
function loop(now) {
  const t = (performance.now() - t0) / 1000;
  renderer.time = t;
  // Real delta time. A hardcoded 1/60 made movement speed depend on the actual
  // frame rate: on a 45 fps frame the camera travelled 60/45 too far, which
  // reads as stutter rather than smooth travel.
  const prevFrameT = lastFrameT;
  const dt = prevFrameT ? Math.min((now - prevFrameT) / 1000, 0.1) : 1 / 60;
  lastFrameT = now;
  const t1 = performance.now();
  updateCamera(dt);
  renderer.render(cam);
  // CPU time spent issuing commands - NOT the frame rate. Kept as a diagnostic
  // because a large gap between this and the real frame time means the GPU is
  // the bottleneck.
  const cpuMs = performance.now() - t1;

  // Real frame interval, measured from the previous animation frame. This is
  // what the eye sees and what the adaptive-resolution logic must react to.
  const frameMs = prevFrameT ? (now - prevFrameT) : 16.7;
  frames.push(frameMs);
  if (frames.length > 60) frames.shift();
  cpuFrames.push(cpuMs);
  if (cpuFrames.length > 60) cpuFrames.shift();
  if (!readyMs && renderer.frame >= 2) {
    readyMs = performance.now() - t0;
    window.__READY__ = true;
  }
  // The readout only needs a few updates a second; touching the DOM every frame
  // forces layout work that shows up as jitter in the frame time itself.
  hudAcc += 1;
  if (hudAcc >= 10) { hudAcc = 0; HUD.update(APP.stats(), cam); }

  // ---- adaptive resolution ----
  // Average frame time over the last ~30 frames and step the internal buffer
  // down when it exceeds budget. Recovery is deliberately slower than the drop
  // (and uses a tighter threshold) so the scale cannot oscillate between two
  // sizes, which would read as a pulsing image.
  perfAcc.push(frameMs);
  if (perfAcc.length > 30) perfAcc.shift();
  if (perfAcc.length === 30) {
    const avg = perfAcc.reduce((x, y) => x + y, 0) / perfAcc.length;
    const cur = renderer.dynScale ?? 1.0;
    let next = cur;
    // Targets 60 fps. Drop as soon as the average frame exceeds ~19 ms (52 fps)
    // and only climb back below 14 ms (71 fps), so the scale settles instead of
    // oscillating between two sizes and pulsing.
    if (avg > 19 && cur > 0.5) next = cur - 0.08;
    else if (avg < 14 && cur < 1.0) next = cur + 0.04;
    if (next !== cur) { renderer.setDynamicScale(next); perfAcc.length = 0; }
  }
  requestAnimationFrame(loop);
}

const keys = Object.create(null);
let lastX = 0, lastY = 0;
let yaw = 0, pitch = 0, freeLook = false;

// ---- feel ----
const MOUSE_SENS = 0.0015;          // radians of view per pixel of mouse travel
const PITCH_LIMIT = Math.PI / 2 - 0.02;
const WALK_SPEED = 3.2;             // m/s
const RUN_SPEED = 9.0;
const ACCEL_TAU = 0.075;            // seconds to reach ~63% of target velocity
// Clamp on a single mouse event, in PIXELS. Drag deltas are bounded by the
// viewport, so this only needs to catch anomalies (a dropped frame, a stylus
// gesture, window re-entry) - not normal fast flicks. At 150 a quick drag across
// the window was being chopped into 150 px steps and lost most of its rotation.
const MAX_PIXELS = 4000;
const POOL_FLOOR_Y = -4.05;         // deepest point of the basin
let vel = [0, 0, 0];                // smoothed movement velocity

// Accumulated look delta. Mouse events arrive at the OS polling rate, not the
// frame rate, so applying them immediately makes the view frame-rate dependent
// and causes the one-frame overshoot that reads as jitter. Buffer the deltas and
// consume them once per frame instead.
let lookDX = 0, lookDY = 0;

// Derive yaw/pitch from the camera's current aim. Called on boot and by setShot,
// so switching shots while free-looking does not snap back to a stale angle.
function syncLookFromCamera() {
  const d = V3.norm(V3.sub(cam.target, cam.pos));
  yaw = Math.atan2(d[0], -d[2]);
  pitch = Math.asin(clamp(d[1], -1, 1));
}

function applyLook() {
  pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  const cp = Math.cos(pitch);
  cam.target = V3.add(cam.pos, [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]);
}

function installInput() {
  syncLookFromCamera();

  // ============================================================
  //  Look input: always attempt pointer lock, hide the cursor.
  // ============================================================
  //
  // Pointer Lock is the only mechanism that genuinely pins the cursor: the OS
  // pointer is captured, the browser stops reporting an absolute position, and
  // movementX/Y become raw device deltas. That is what allows unlimited
  // free-look with no edge and no jitter.
  //
  // An earlier revision gated the request behind window.isSecureContext, on the
  // assumption that a LAN address over plain http could never lock. That was
  // wrong, and it disabled a feature that was working: Chrome's "press Esc to
  // show the cursor" banner - which the user saw - only appears when the lock
  // has been GRANTED. Never pre-emptively refuse the request; ask for it and
  // handle the failure if it actually happens.
  const supportsLock = typeof canvas.requestPointerLock === 'function';
  let locked = false;
  let everLocked = false;

  function setLockState(on) {
    locked = on;
    if (on) everLocked = true;
    HUD.setLockState(on, supportsLock, everLocked);
  }

  function requestLock() {
    if (locked || !supportsLock) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => setLockState(false));
    } catch (e) { setLockState(false); }
  }

  // Any click captures the pointer; after Esc, clicking again re-captures.
  canvas.addEventListener('click', requestLock);
  canvas.addEventListener('mousedown', (ev) => {
    lastX = ev.clientX; lastY = ev.clientY;
    requestLock();
  });

  document.addEventListener('pointerlockchange', () => {
    const on = document.pointerLockElement === canvas;
    setLockState(on);
    if (on) {
      freeLook = true;
      // The lock swallows the pointer, so any pending absolute-position delta is
      // stale. Drop it or the view lurches on the first frame after capture.
      lookDX = 0; lookDY = 0;
    }
  });
  document.addEventListener('pointerlockerror', () => setLockState(false));

  canvas.addEventListener('mouseenter', (ev) => {
    lastX = ev.clientX; lastY = ev.clientY;
    freeLook = true;
  });

  window.addEventListener('mousemove', (ev) => {
    // movementX/Y are the raw device delta and are populated on EVERY mousemove,
    // locked or not - they are not exclusive to pointer lock. Using them in both
    // modes means there is never a reference point to fall out of sync with, so
    // no synthetic jump can be introduced.
    let dx = ev.movementX;
    let dy = ev.movementY;

    if (typeof dx !== 'number' || typeof dy !== 'number') {
      // Very old engines: fall back to absolute tracking.
      dx = ev.clientX - lastX;
      dy = ev.clientY - lastY;
    }
    lastX = ev.clientX; lastY = ev.clientY;

    // Guard only against absurd samples (dropped frame, stylus gesture).
    dx = Math.max(-MAX_PIXELS, Math.min(MAX_PIXELS, dx));
    dy = Math.max(-MAX_PIXELS, Math.min(MAX_PIXELS, dy));

    if (dx === 0 && dy === 0) return;
    lookDX += dx;
    lookDY += dy;
    freeLook = true;
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncLookFromCamera();
      lookDX = 0; lookDY = 0;
      lastX = 0; lastY = 0;
    }
  });

  const SHOT_KEYS = ['hero', 'water', 'rings', 'vault', 'wide', 'colonn', 'slide', 'tile', 'edge'];
  // Ctrl is a browser modifier: Ctrl+S opens Save, Ctrl+W closes the tab, and
  // some of those cannot be cancelled at all. Swallow the default only for the
  // keys this scene actually uses so Ctrl-as-descend does not trigger them.
  const SWALLOW = new Set(['KeyW','KeyA','KeyS','KeyD','KeyE','KeyQ','KeyC',
                           'Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && SWALLOW.has(ev.code)) ev.preventDefault();
    keys[ev.code] = true;
    if (ev.code === 'KeyH') { HUD.toggleHints(); return; }
    if (ev.code.startsWith('Digit')) {
      const n = parseInt(ev.code.slice(5), 10);
      if (n >= 1 && n <= SHOT_KEYS.length) { setShot(SHOT_KEYS[n - 1]); freeLook = true; }
    }
  });
  window.addEventListener('keyup', (ev) => { keys[ev.code] = false; });
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    lookDX = 0; lookDY = 0;
  });
  window.addEventListener('wheel', (ev) => { cam.fov = clamp(cam.fov + ev.deltaY * 0.02, 24, 78); }, { passive: true });

  setLockState(false);
}

function updateCamera(dt) {
  if (!freeLook) return;
  dt = Math.min(dt, 0.1);   // a stalled tab must not teleport the camera

  // ---- look: consume the buffered mouse delta exactly once per frame ----
  if (lookDX !== 0 || lookDY !== 0) {
    yaw += lookDX * MOUSE_SENS;
    pitch -= lookDY * MOUSE_SENS;
    lookDX = 0; lookDY = 0;
  }

  // Movement is horizontal and yaw-relative, like a walker, not a fly-by-wire
  // rig: pressing W while looking up used to launch you toward the vault.
  // Vertical travel lives on Q/E where it belongs.
  const fwd = [Math.sin(yaw), 0, -Math.cos(yaw)];
  const right = [Math.cos(yaw), 0, Math.sin(yaw)];
  let move = [0, 0, 0];
  if (keys['KeyW'] || keys['ArrowUp']) move = V3.add(move, fwd);
  if (keys['KeyS'] || keys['ArrowDown']) move = V3.sub(move, fwd);
  if (keys['KeyD'] || keys['ArrowRight']) move = V3.add(move, right);
  if (keys['KeyA'] || keys['ArrowLeft']) move = V3.sub(move, right);
  // Ctrl descends. Holding Ctrl used to be a modifier; browsers report it as
  // ControlLeft/ControlRight, and it must not be swallowed by the run key.
  if (keys['KeyE'] || keys['Space']) move = V3.add(move, [0, 1, 0]);
  if (keys['ControlLeft'] || keys['ControlRight'] || keys['KeyQ'] || keys['KeyC']) {
    move = V3.sub(move, [0, 1, 0]);
  }

  const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? RUN_SPEED : WALK_SPEED;
  const target = V3.len(move) > 0 ? V3.mul(V3.norm(move), speed) : [0, 0, 0];

  // Exponential approach: instant response, smooth stop. A hard snap reads as
  // stutter, and pure lerp never actually reaches the target speed.
  const k = 1 - Math.exp(-dt / ACCEL_TAU);
  vel = V3.lerp(vel, target, k);
  if (V3.len(vel) > 1e-4) cam.pos = V3.add(cam.pos, V3.mul(vel, dt));

  // Keep the eye inside the building. Free-fly without bounds lets you drift
  // through the tiled walls into the void, where every surface is backfacing and
  // the frame goes black - easy to mistake for a renderer bug.
  const PAD = 0.35;
  cam.pos[0] = clamp(cam.pos[0], HALL.x0 + PAD, HALL.x1 - PAD);
  cam.pos[2] = clamp(cam.pos[2], HALL.z0 + PAD, HALL.z1 - PAD);
  cam.pos[1] = clamp(cam.pos[1], POOL_FLOOR_Y + 0.25, HALL.y + HALL.vault - 0.4);

  applyLook();
}


// ============================================================
//  HUD: runtime readout + key hints
// ============================================================
const HUD = (() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    fps: $('rd-fps'), ms: $('rd-ms'), tris: $('rd-tris'),
    pos: $('rd-pos'), fov: $('rd-fov'), scale: $('rd-scale'),
    hints: $('hud-hints'), help: $('hud-help'), helpErr: $('hud-help-err'),
  };
  let hintsOn = true;

  function toggleHints() {
    hintsOn = !hintsOn;
    if (el.hints) el.hints.classList.toggle('hidden', !hintsOn);
  }

  function flashHelp(msg) {
    if (!el.help) return;
    if (el.helpErr) el.helpErr.textContent = msg || '';
    el.help.classList.add('show');
    clearTimeout(flashHelp._t);
    flashHelp._t = setTimeout(() => el.help.classList.remove('show'), 5200);
  }

  function update(stats, cam) {
    if (!stats) return;
    if (el.fps) {
      const fps = stats.ms > 0 ? 1000 / stats.ms : 0;
      el.fps.textContent = fps.toFixed(0);
      el.fps.className = 'v' + (fps < 30 ? ' warn' : (fps < 50 ? '' : ' ok'));
    }
    if (el.ms) {
      // Show real frame interval plus the CPU submit time, so it is obvious
      // whether the GPU or the CPU is the bottleneck.
      el.ms.textContent = stats.ms.toFixed(1) + ' / ' + (stats.cpuMs ?? 0).toFixed(1);
    }
    if (el.scale) {
      const s = Math.round((stats.scale ?? 1) * 100);
      el.scale.textContent = s + '%';
      el.scale.className = 'v' + (s < 90 ? ' warn' : '');
    }
    if (el.tris) el.tris.textContent = (stats.tris / 1000).toFixed(0) + 'k';
    if (el.pos && cam) {
      el.pos.textContent = cam.pos.map(v => v.toFixed(1)).join(' ');
    }
    if (el.fov && cam) el.fov.textContent = cam.fov.toFixed(0) + '\u00b0';
  }

  // Reflect which look mode the browser granted. This is the difference between
  // a captured cursor and one that still has to be pushed back from the edges,
  // and it is the first thing to check when the view feels wrong.
  function setLockState(on, supportsLock, everLocked) {
    const row = $('rd-look');
    if (row) {
      if (on) {
        row.textContent = 'captured';
        row.className = 'v ok';
      } else if (!supportsLock) {
        row.textContent = 'unsupported';
        row.className = 'v warn';
      } else {
        row.textContent = 'click to lock';
        row.className = 'v';
      }
    }
    const note = $('hud-lock-note');
    if (note) {
      note.textContent = on
        ? 'Cursor captured — it is pinned to the centre. Press Esc to release.'
        : (supportsLock
            ? 'Click anywhere on the view to capture the cursor. It is then pinned to the centre and turns without limit.'
            : 'This browser does not expose the Pointer Lock API, so the cursor cannot be captured.');
    }
    const hint = $('hud-lock-hint');
    if (hint) hint.classList.toggle('hidden', on);
  }

  return { update, toggleHints, flashHelp, setLockState, get hintsOn() { return hintsOn; } };
})();

const APP = {
  setShot,
  stats() {
    const avg = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0;
    const cpuAvg = cpuFrames.length ? cpuFrames.reduce((a, b) => a + b, 0) / cpuFrames.length : 0;
    return {
      frame: renderer ? renderer.frame : 0,
      // ms = real frame interval (what the eye sees)
      ms: +avg.toFixed(2),
      cpuMs: +cpuAvg.toFixed(2),
      scale: renderer ? (renderer.dynScale ?? 1) : 1,
      w: renderer ? renderer.w : 0,
      h: renderer ? renderer.h : 0,
      tris: APP.tris || 0,
      verts: APP.verts || 0,
      lights: APP.lights || 0,
      readyMs: +readyMs.toFixed(0),
      shot: SHOT || 'hero',
    };
  },
};
window.__APP__ = APP;

boot().catch((e) => {
  const msg = String((e && e.stack) || e);
  window.__BOOT__ = msg;
  console.error('BOOT FAIL', e);
  // Show it on the page as well - a failed boot previously produced a silent
  // black canvas with the reason buried in the console.
  if (window.__FATAL__) window.__FATAL__('Boot failed', msg);
});
