// ============================================================
//  App entry: build level, bake probes, run the render loop
// ============================================================
import { Renderer, SCALE_LADDER } from './renderer.js';
import { buildLevel, WATER_Y, HALL, POOL } from './level.js';
import { V3, clamp } from './math.js';
import { Ambience } from './audio.js';

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
const ambience = new Ambience();
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


// ============================================================
//  Loading progress
// ============================================================
// Weights reflect the real cost of each stage rather than splitting the bar
// evenly: the environment probe bake is by far the longest step (3 passes x 6
// cube faces, each running the full pipeline), while geometry generation and the
// GPU upload are quick.
//
// The bar reports real completion of each stage, so it can sit still while the
// GPU works instead of creeping forward on a timer.
const Loader = (() => {
  const STAGES = [
    ['shaders',  'loading shaders',   0.34],
    ['geometry', 'building level',    0.06],
    ['upload',   'uploading mesh',    0.05],
    ['bake',     'baking light probe',0.53],
    ['final',    'preparing view',    0.02],
  ];
  const index = {};
  let acc = 0;
  STAGES.forEach(([k, , w], i) => { index[k] = { i, base: acc, weight: w }; acc += w; });

  const el = {
    root: document.getElementById('loader'),
    fill: document.getElementById('loader-fill'),
    stage: document.getElementById('loader-stage'),
    pct: document.getElementById('loader-pct'),
  };
  let finished = false;

  function set(key, frac) {
    if (finished || !el.fill) return;
    const s = index[key];
    if (!s) return;
    const f = Math.max(0, Math.min(1, frac));
    const total = s.base + s.weight * f;
    el.fill.style.width = (total * 100).toFixed(1) + '%';
    el.pct.textContent = Math.round(total * 100) + '%';
    el.stage.textContent = STAGES[s.i][1];
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (el.fill) el.fill.style.width = '100%';
    if (el.pct) el.pct.textContent = '100%';
    if (el.stage) el.stage.textContent = 'ready';
    // Let the bar visibly reach 100% before the panel fades, otherwise a fast
    // load looks like a flash rather than a completed action.
    setTimeout(() => {
      if (el.root) el.root.classList.add('done');
      // Remove it from the layer tree once faded so it cannot intercept clicks.
      setTimeout(() => { if (el.root && el.root.parentNode) el.root.parentNode.removeChild(el.root); }, 500);
    }, 180);
  }

  return { set, finish, get el() { return el; } };
})();

async function boot() {
  const { w, h } = fitCanvas();
  Loader.set('shaders', 0);
  renderer = new Renderer(canvas);
  renderer.onLoad = (stage, frac) => Loader.set(stage, frac);
  await renderer.ready;
  Loader.set('shaders', 1);
  renderer.setSize(w, h);
  installContextLossHandling(renderer.gl);
  GPUTimer.init(renderer.gl);
  GPUInfo.init(renderer.gl);
  renderer.dynScale = 1.0;
  renderer._userScale = SCALE;
  // Supersampling factor. 1.25 is a good default; ?ss=1 disables it on weak GPUs,
  // ?ss=1.5 pushes it further on a strong one.
  renderer.ssaa = num('ss', 1.25);
  renderer.applyRenderSize();

  // buildLevel is synchronous and takes a moment; yield once so the browser can
  // actually paint the progress bar before the main thread blocks.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  Loader.set('geometry', 0);
  const level = buildLevel();
  Loader.set('geometry', 1);

  await new Promise(r => requestAnimationFrame(r));
  Loader.set('upload', 0);
  const gpu = level.mesh.toGPU(renderer.gl);
  Loader.set('upload', 1);
  renderer.setGeometry(gpu);
  renderer.lights = level.lights.slice(0, 64);
  renderer.portals = (level.portals || []).slice(0, 10);

  cam = { pos: [0, 1.7, 20], target: [0, 2.2, -6], fov: 47 };
  setShot(SHOT || 'hero');

  await new Promise(r => requestAnimationFrame(r));
  Loader.set('bake', 0);
  await renderer.bakeEnv(512);
  Loader.set('bake', 1);

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

  // Ambience. Volume is a URL parameter so the mix can be judged without a
  // rebuild; 0 disables it entirely. Audio cannot start until the user
  // interacts, so this only stores the level - playback begins on first click.
  ambience.setVolume(num('vol', 0.55));
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

  // Do not keep the room humming in a background tab.
  document.addEventListener('visibilitychange', () => {
    if (!ambience.started) return;
    if (document.hidden) ambience.suspend(); else ambience.resume();
  });

  // ?hud=0 hides every overlay for documentation screenshots.
  if (num('hud', 1) === 0) {
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.classList.add('hidden');
  }

  Loader.set('final', 1);
  Loader.finish();

  installInput();
  requestAnimationFrame(loop);
}

let hudAcc = 0;
const perfAcc = [];
let scaleCooldown = 0;   // frames to wait after a resolution change
const cpuFrames = [];
let lastFrameT = 0;

// ============================================================
//  GPU timer: distinguishes a slow GPU from a slow compositor
// ============================================================
// requestAnimationFrame spacing includes GPU work, browser compositing and the
// vsync wait, so a 17 ms interval does not prove the GPU is the bottleneck. When
// EXT_disjoint_timer_query_webgl2 is available we can measure the GPU directly:
// if the GPU reports ~4 ms while frames arrive every 17 ms, the cost is elsewhere.
const GPUTimer = (() => {
  // A single in-flight query is not enough. The GPU runs one to three frames
  // behind the CPU, so by the time a query is readable the CPU may already have
  // submitted another frame. Tracking only one query meant begin() silently
  // skipped while a result was pending, and the pairing broke - which is how the
  // HUD ended up reporting a GPU time LONGER than the whole frame interval.
  //
  // Keep a small queue instead, and only report the most recent completed result.
  const MAX_IN_FLIGHT = 4;
  let gl = null, ext = null;
  let inFlight = [];
  let lastMs = 0, supported = false;

  function init(ctx) {
    gl = ctx;
    ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    supported = !!ext;
    inFlight = [];
    return supported;
  }

  function begin() {
    if (!supported) return null;
    // If the queue is full the GPU is far behind; drop the measurement rather
    // than corrupting the pairing.
    if (inFlight.length >= MAX_IN_FLIGHT) return null;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    return q;
  }

  function end(q) {
    if (!supported || !q) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    inFlight.push(q);
  }

  function poll() {
    if (!supported) return;
    // A disjoint event means the GPU was interrupted (context switch, power
    // state change) and every in-flight result is garbage - discard them all.
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    if (disjoint) {
      for (const q of inFlight) gl.deleteQuery(q);
      inFlight.length = 0;
      return;
    }
    while (inFlight.length) {
      const q = inFlight[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      gl.deleteQuery(q);
      inFlight.shift();
      lastMs = ns / 1e6;
    }
  }

  return { init, begin, end, poll, get ms() { return lastMs; }, get supported() { return supported; } };
})();


// ============================================================
//  GPU identification: which adapter is actually rendering?
// ============================================================
// On a hybrid-graphics laptop the browser can silently pick the integrated GPU,
// and no amount of shader optimisation will help. WEBGL_debug_renderer_info
// exposes the adapter string that the WebGL context really bound to, which is
// the only reliable way to tell from inside the page.
const GPUInfo = (() => {
  let name = 'unknown';
  let vendor = 'unknown';
  let software = false;

  function init(gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      name = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'unknown';
      vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || 'unknown';
    } else {
      name = gl.getParameter(gl.RENDERER) || 'unknown';
      vendor = gl.getParameter(gl.VENDOR) || 'unknown';
    }
    // SwiftShader / llvmpipe mean the browser fell back to CPU rasterisation.
    software = /swiftshader|llvmpipe|software|basic render/i.test(name);
    console.log('[poolcore] GPU:', vendor, '/', name, software ? '(SOFTWARE!)' : '');
    return { name, vendor, software };
  }

  return { init, get name() { return name; }, get vendor() { return vendor; }, get software() { return software; } };
})();


// ============================================================
//  WebGL context loss
// ============================================================
// A lost context is what a user experiences as "the page crashed": the canvas
// freezes or goes black and nothing recovers it. Every texture, framebuffer and
// program is invalid after the event, so a full rebuild would be required - the
// practical fix is to surface it and offer a reload.
function installContextLossHandling(gl) {
  let lost = false;
  gl.canvas.addEventListener('webglcontextlost', (e) => {
    // Preventing the default is what allows a restore event to fire at all.
    e.preventDefault();
    lost = true;
    if (window.__FATAL__) {
      window.__FATAL__('WebGL context lost',
        'The GPU dropped this context. This usually means it ran out of video\n' +
        'memory or the driver reset.\n\n' +
        'Reload the page to continue. If it keeps happening, try a smaller\n' +
        'window, or lower the resolution with ?ss=0.75 in the URL.\n\n' +
        'Render size at the time: ' + gl.drawingBufferWidth + ' x ' + gl.drawingBufferHeight);
    }
  });
  gl.canvas.addEventListener('webglcontextrestored', () => {
    if (lost) location.reload();
  });
}

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
  const gpuQuery = GPUTimer.begin();
  renderer.render(cam);
  GPUTimer.end(gpuQuery);
  GPUTimer.poll();
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
    // ---- adaptive resolution, tuned for vsync stability, not average fps ----
    //
    // With vsync on, a frame that takes 17.1 ms on a 60 Hz display misses the
    // 16.67 ms deadline, so it waits for the next one and is presented 33.3 ms
    // later. The average can read a healthy 58 fps while the motion visibly
    // stutters, because some frames are being doubled.
    //
    // The old thresholds (drop above 19 ms, climb below 14 ms) left a dead zone
    // that 17.1 ms fell into: too fast to trigger a drop, too slow to climb, so
    // the scale parked at 76% and the judder never went away.
    //
    // Budget is now 16.67 ms with headroom: drop above 15.5 ms, climb below
    // 12.5 ms. The gap between them keeps the scale from oscillating.
    // Drop above the budget, climb just below it. The previous pair (15.5 / 12.5)
    // left a 3 ms dead zone, and a machine running at ~13.7 ms sat inside it
    // forever: too slow to climb, too fast to drop. Once the scale dipped it never
    // came back, which is why it settled low.
    //
    // The band is now narrow (14.9 / 13.9) so the scaler keeps probing upward
    // while there is headroom to the 16.67 ms vsync deadline. A climb that proves
    // too expensive pushes the average past 14.9 within a couple of frames and it
    // drops straight back, so the narrower band does not cause oscillation.
    const FRAME_BUDGET = 14.9;
    const FRAME_HEADROOM = 13.9;

    // Cooldown. Changing the render size destroys and recreates ~37 GL objects
    // (every FBO, every texture, every depth buffer) and forces TAA to rebuild
    // its history. That frame is itself very expensive, so without a cooldown a
    // fast camera pan - which raises frame time on its own - would trigger a
    // drop, the drop's own cost would raise the average further, and the scaler
    // would cascade down several steps in a row. That cascade is what showed up
    // as tearing while panning.
    //
    // After any change we now ignore frame times for a settling period, so each
    // step gets a chance to be measured before another is applied.
    // The scale is a fixed ladder (see Renderer.setDynamicScale), so this picks
    // the next rung rather than nudging a continuous value. Coarser steps are
    // deliberate: every change reallocates the whole render target set.
    const LADDER = SCALE_LADDER;
    let idx = 0;
    for (let k = 0; k < LADDER.length; k++) if (cur >= LADDER[k] - 0.001) idx = k;

    if (scaleCooldown > 0) {
      scaleCooldown--;
    } else if (avg > FRAME_BUDGET && idx > 0) {
      next = LADDER[idx - 1];
    } else if (avg < FRAME_HEADROOM && idx < LADDER.length - 1) {
      // Predictive climb: frame cost scales with pixel count, so raising the
      // scale from s to s2 multiplies frame time by (s2/s)^2. Step up only if the
      // projected time still fits. Without this check a climb on a machine that
      // is already near the budget would immediately overshoot and drop back.
      const s2 = LADDER[idx + 1];
      const projected = avg * (s2 / cur) * (s2 / cur);
      if (projected < FRAME_BUDGET) next = s2;
    }
    if (next !== cur) {
      renderer.setDynamicScale(next);
      perfAcc.length = 0;
      // ~0.5 s at 60 fps. Long enough for the reallocation spike to leave the
      // 30-sample window, short enough to still react within a second.
      scaleCooldown = 30;
    }
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
const POOL_FLOOR_Y = POOL.floor;    // deepest point of the basin
const DECK_LEVEL = 0.0;             // deck surface; nothing below this exists outside the pool
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
  // Audio is only allowed to start from a user gesture. The click that captures
  // the pointer is the natural moment; any key press works too.
  const startAudio = () => { try { ambience.start(); } catch (e) { console.warn('audio', e); } };
  canvas.addEventListener('click', startAudio);
  window.addEventListener('keydown', startAudio, { once: true });
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
    // Audio level, so the mix can be judged without editing the URL.
    if (ev.code === 'BracketLeft' || ev.code === 'BracketRight') {
      const step = ev.code === 'BracketLeft' ? -0.08 : 0.08;
      ambience.setVolume((ambience.masterGain ?? 0.55) + step);
      HUD.flashVolume(ambience.masterGain);
      return;
    }
    if (ev.code === 'KeyM') {
      ambience.setVolume(ambience.masterGain > 0 ? 0 : 0.55);
      HUD.flashVolume(ambience.masterGain);
      return;
    }
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

  // The floor limit is not a single plane. Below deck level there is only the
  // basin: the walls and floor exist inside the pool rectangle, and everywhere
  // else under y = 0 is empty space with nothing but backfacing deck above it.
  // Allowing the camera down there let it drop through the deck and look up at
  // culled surfaces, which reads as the model having no bottom.
  //
  // So: inside the pool the limit is the basin floor, outside it the limit is
  // just above the deck.
  const inPoolX = cam.pos[0] > POOL.x0 + 0.3 && cam.pos[0] < POOL.x1 - 0.3;
  const inPoolZ = cam.pos[2] > POOL.z0 + 0.3 && cam.pos[2] < POOL.z1 - 0.3;
  const overWater = inPoolX && inPoolZ;
  const lowest = overWater ? POOL_FLOOR_Y + 0.35 : DECK_LEVEL + 0.25;
  cam.pos[1] = clamp(cam.pos[1], lowest, HALL.y + HALL.vault - 0.4);

  applyLook();
}


// ============================================================
//  HUD: runtime readout + key hints
// ============================================================
const HUD = (() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    fps: $('rd-fps'), ms: $('rd-ms'), tris: $('rd-tris'),
    pos: $('rd-pos'), fov: $('rd-fov'), scale: $('rd-scale'), gpu: $('rd-gpu'),
    hints: $('hud-hints'), help: $('hud-help'), helpErr: $('hud-help-err'),
  };
  let hintsOn = true;

  function toggleHints() {
    hintsOn = !hintsOn;
    if (el.hints) el.hints.classList.toggle('hidden', !hintsOn);
  }

  // Transient toast for actions that have no permanent readout, like volume.
  function flashVolume(v) {
    const el2 = $('hud-toast');
    if (!el2) return;
    el2.textContent = v <= 0 ? 'muted' : 'volume ' + Math.round(v * 100) + '%';
    el2.classList.add('show');
    clearTimeout(flashVolume._t);
    flashVolume._t = setTimeout(() => el2.classList.remove('show'), 1400);
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
      // frame interval / GPU execution time / CPU submit time.
      // If the interval is much larger than the GPU time, the cost is NOT in our
      // shaders - it is the browser compositor, vsync waiting, or the canvas size.
      const g = (stats.gpuTimer && stats.gpuMs > 0) ? stats.gpuMs.toFixed(1) : 'n/a';
      el.ms.textContent = stats.ms.toFixed(1) + ' / ' + g + ' / ' + (stats.cpuMs ?? 0).toFixed(1);
    }
    if (el.gpu) {
      // Trim the long driver string to something readable; the full value is in
      // the console and in __APP__.stats().
      let g = (stats.gpuName || 'unknown');
      g = g.replace(/^ANGLE \(/, '').replace(/\)$/, '');
      const m = g.match(/(NVIDIA[^,]*|AMD[^,]*|Intel[^,]*|Apple[^,]*|Mali[^,]*|Adreno[^,]*)/i);
      if (m) g = m[1];
      g = g.replace(/Direct3D\d+/i, 'D3D').trim();
      if (g.length > 26) g = g.slice(0, 25) + '\u2026';
      el.gpu.textContent = g;
      el.gpu.className = 'v' + (stats.gpuSoftware ? ' warn' : '');
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

  return { update, toggleHints, flashHelp, flashVolume, setLockState, get hintsOn() { return hintsOn; } };
})();

const APP = {
  setShot,
  // Exposed for automated tests and for console debugging.
  get cam() { return cam; },
  get renderer() { return renderer; },
  stats() {
    const avg = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0;
    const cpuAvg = cpuFrames.length ? cpuFrames.reduce((a, b) => a + b, 0) / cpuFrames.length : 0;
    return {
      frame: renderer ? renderer.frame : 0,
      // ms = real frame interval (what the eye sees)
      ms: +avg.toFixed(2),
      cpuMs: +cpuAvg.toFixed(2),
      // A GPU pass cannot take longer than the frame interval that contains it.
      // When the raw reading violates that, report it as invalid rather than
      // showing a physically impossible number.
      gpuMs: (GPUTimer.ms > 0 && GPUTimer.ms <= avg * 1.15) ? +GPUTimer.ms.toFixed(2) : -1,
      gpuRawMs: +GPUTimer.ms.toFixed(2),
      gpuTimer: GPUTimer.supported,
      gpuName: GPUInfo.name,
      gpuSoftware: GPUInfo.software,
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
window.__AMBIENCE__ = ambience;

boot().catch((e) => {
  const msg = String((e && e.stack) || e);
  window.__BOOT__ = msg;
  console.error('BOOT FAIL', e);
  // Show it on the page as well - a failed boot previously produced a silent
  // black canvas with the reason buried in the console.
  if (window.__FATAL__) window.__FATAL__('Boot failed', msg);
});
