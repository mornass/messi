/* =========================================================
   404 — « Fais comme Messi » : mini-jeu en vue subjective (Three.js r128)
   Inspiré du slalom contre Getafe (Coupe du Roi, 18.04.2007) :
   départ au rond central, 6 défenseurs puis le gardien, but au bout.

   Repère : x = largeur (±34 m), z = longueur ; rond central en z = 0,
   ligne de but en z = -52 (moitié d'un terrain de 105 m), cage de 7,32 × 2,44 m.

   Commandes
     ordinateur : ZQSD / WASD (touches physiques) + flèches, souris (pointer lock),
                  Maj = sprint, clic = tirer
     tactile    : joystick à gauche, glisser à droite pour tourner, boutons
                  « Sprint » (maintenu) et « Tirer »

   Rendu léger pour tenir 60 fps sur mobile : formes low-poly, aucune ombre
   calculée (taches au sol), lignes de craie peintes une fois dans une texture,
   grain en CSS, flou de vitesse = traînées radiales sur un canvas 2D en surimpression.
   ========================================================= */
(() => {
  if (!window.THREE) return;
  const $ = (s) => document.querySelector(s);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  const C = {
    navy: 0x0b1f3a, navyDeep: 0x071426, navyGrass: 0x0e2546, offwhite: 0xf6f5f0,
    grenat: 0xa50044, barca: 0x004d98,
  };
  const FIELD = { halfW: 34, goalZ: -52, backZ: 12, goalHalfW: 3.66, goalH: 2.44, netDepth: 2.2 };
  const P = {
    eye: 1.55, run: 6.4, sprint: 9.2, back: 0.6, accel: 8,
    staminaDrain: 0.24, staminaRegen: 0.16,
    ballAhead: 1.45, ballR: 0.11,
    shotSpeed: 25, gravity: 9.8,
  };
  const HOME = "/";

  /* ---------- rendu ---------- */
  const canvas = $("[data-g-canvas]");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !touch, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.25 : 1.75));
  renderer.setClearColor(C.navyDeep);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.navyDeep, 38, 120);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 260);
  camera.rotation.order = "YXZ";
  scene.add(new THREE.HemisphereLight(0xffffff, C.navy, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(-20, 40, 10);
  scene.add(sun);

  /* ---------- terrain : texture peinte (bandes + lignes de craie) ---------- */
  function makePitch() {
    const X0 = -40, X1 = 40, Z0 = -60, Z1 = FIELD.backZ;
    const W = touch ? 1024 : 2048, H = Math.round((W * (Z1 - Z0)) / (X1 - X0));
    const k = W / (X1 - X0);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const px = (x) => (x - X0) * k, pz = (z) => (z - Z0) * k;
    g.fillStyle = "#081830";
    g.fillRect(0, 0, W, H);
    // bandes de tonte (5,25 m) dans le terrain
    for (let z = FIELD.goalZ, i = 0; z < Z1; z += 5.25, i++) {
      g.fillStyle = i % 2 ? "#0B1F3A" : "#0E2546";
      g.fillRect(px(-FIELD.halfW), pz(z), (FIELD.halfW * 2) * k, 5.25 * k + 1);
    }
    // craie : plusieurs passages légèrement décalés, opacité faible
    const chalk = (draw) => {
      g.lineCap = "round";
      for (let p = 0; p < 3; p++) {
        g.save();
        g.translate((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6);
        g.strokeStyle = `rgba(246, 245, 240, ${p === 0 ? 0.75 : 0.25})`;
        g.lineWidth = 0.12 * k * (p === 0 ? 1 : 1.5);
        g.beginPath();
        draw();
        g.stroke();
        g.restore();
      }
    };
    const rect = (x0, z0, x1, z1) => chalk(() => g.rect(px(x0), pz(z0), (x1 - x0) * k, (z1 - z0) * k));
    const line = (x0, z0, x1, z1) => chalk(() => { g.moveTo(px(x0), pz(z0)); g.lineTo(px(x1), pz(z1)); });
    const arc = (x, z, r, a0, a1) => chalk(() => g.arc(px(x), pz(z), r * k, a0, a1));
    const dot = (x, z, r) => { g.fillStyle = "rgba(246,245,240,0.8)"; g.beginPath(); g.arc(px(x), pz(z), r * k, 0, Math.PI * 2); g.fill(); };
    const L = FIELD.halfW, G = FIELD.goalZ;
    line(-L, G, -L, Z1); line(L, G, L, Z1); line(-L, G, L, G);   // touches + ligne de but
    line(-L, 0, L, 0);                                            // ligne médiane
    arc(0, 0, 9.15, 0, Math.PI * 2); dot(0, 0, 0.25);             // rond central
    rect(-20.16, G, 20.16, G + 16.5);                             // surface de réparation
    rect(-9.16, G, 9.16, G + 5.5);                                // surface de but
    dot(0, G + 11, 0.2);                                          // point de penalty
    const a = Math.acos(5.5 / 9.15);
    arc(0, G + 11, 9.15, Math.PI / 2 - a, Math.PI / 2 + a);       // arc de la surface
    arc(-L, G, 1, 0, Math.PI / 2); arc(L, G, 1, Math.PI / 2, Math.PI); // corners
    // poussière de craie : petites taches effacées
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < W * 3; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`;
      g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    }
    g.globalCompositeOperation = "source-over";
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(X1 - X0, Z1 - Z0),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    scene.add(mesh);
    // le reste du terrain (derrière la ligne médiane), sous le brouillard
    const far = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x081830 }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.02;
    scene.add(far);
  }

  /* ---------- tribunes : anneau sombre, bande grenat, points de lumière ---------- */
  function makeStands() {
    const cv = document.createElement("canvas");
    cv.width = 1024; cv.height = 128;
    const g = cv.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, "#050d1a"); grd.addColorStop(0.7, "#0b1f3a"); grd.addColorStop(1, "#0b1f3a");
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 128);
    for (let i = 0; i < 2200; i++) {
      g.fillStyle = Math.random() < 0.08 ? "rgba(165,0,68,0.9)" : `rgba(246,245,240,${0.15 + Math.random() * 0.35})`;
      g.fillRect(Math.random() * 1024, 30 + Math.random() * 80, 1.5, 1.5);
    }
    g.fillStyle = "#A50044"; g.fillRect(0, 112, 1024, 3);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = 6;
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(78, 70, 22, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
    );
    ring.position.set(0, 8, -22);
    scene.add(ring);
  }

  /* ---------- cage + filet déformable ---------- */
  const net = {};
  function makeGoal() {
    const m = new THREE.MeshBasicMaterial({ color: C.offwhite });
    const G = FIELD.goalZ, hw = FIELD.goalHalfW, h = FIELD.goalH, d = FIELD.netDepth;
    const post = new THREE.CylinderGeometry(0.06, 0.06, h, 8);
    [-hw, hw].forEach((x) => { const p = new THREE.Mesh(post, m); p.position.set(x, h / 2, G); scene.add(p); });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, hw * 2, 8), m);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, h, G); scene.add(bar);
    const nm = new THREE.MeshBasicMaterial({ color: C.offwhite, wireframe: true, transparent: true, opacity: 0.45 });
    // fond (déformé au but), toit et côtés
    const back = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, h, 28, 10), nm);
    back.position.set(0, h / 2, G - d);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, d, 28, 8), nm);
    roof.rotation.x = -Math.PI / 2; roof.position.set(0, h, G - d / 2);
    [-hw, hw].forEach((x) => {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(d, h, 8, 10), nm);
      s.rotation.y = Math.PI / 2; s.position.set(x, h / 2, G - d / 2); scene.add(s);
    });
    scene.add(back, roof);
    net.back = back;
    net.base = Float32Array.from(back.geometry.attributes.position.array);
    net.hit = null; // { x, y, t }
  }
  function updateNet(dt) {
    if (!net.hit) return;
    net.hit.t += dt;
    const t = net.hit.t;
    const pos = net.back.geometry.attributes.position;
    const a = pos.array, b = net.base;
    const amp = 0.9 * Math.exp(-t * 1.6);
    for (let i = 0; i < a.length; i += 3) {
      const dx = b[i] - net.hit.x, dy = b[i + 1] - (net.hit.y - FIELD.goalH / 2);
      const f = Math.exp(-(dx * dx + dy * dy) / 1.4);
      a[i + 2] = b[i + 2] - amp * f * (0.65 + 0.35 * Math.cos(t * 11));
    }
    pos.needsUpdate = true;
  }

  /* ---------- joueurs low-poly ---------- */
  const shadowGeo = new THREE.CircleGeometry(0.42, 14);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
  function makeMan(body, accent, shorts) {
    const g = new THREE.Group();
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const mBody = lam(body), mAcc = lam(accent), mShort = lam(shorts), mSkin = lam(0xd9b89a);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.21, 0.74, 6), mBody);
    torso.position.y = 1.15;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.29, 0.1, 6), mAcc);
    band.position.y = 1.42;
    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.24, 6), mShort);
    hips.position.y = 0.73;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), mSkin);
    head.position.y = 1.7;
    const legGeo = new THREE.BoxGeometry(0.13, 0.62, 0.13);
    legGeo.translate(0, -0.31, 0);
    const legs = [-0.1, 0.1].map((x) => {
      const l = new THREE.Mesh(legGeo, mAcc);
      l.position.set(x, 0.64, 0);
      g.add(l);
      return l;
    });
    const sh = new THREE.Mesh(shadowGeo, shadowMat);
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.015;
    g.add(torso, band, hips, head, sh);
    g.userData.legs = legs;
    scene.add(g);
    return g;
  }
  const animLegs = (man, phase, amount) => {
    const [l, r] = man.userData.legs;
    l.rotation.x = Math.sin(phase) * 0.8 * amount;
    r.rotation.x = -Math.sin(phase) * 0.8 * amount;
  };

  /* ---------- ballon : icosaèdre, pentagones marine ---------- */
  function makeBall() {
    const geo = new THREE.IcosahedronGeometry(P.ballR, 1);
    const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position;
    const tips = [];
    for (let i = 0; i < ico.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(ico, i).normalize();
      if (!tips.some((t) => t.distanceTo(v) < 1e-3)) tips.push(v);
    }
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const white = new THREE.Color(C.offwhite), navy = new THREE.Color(C.navy);
    for (let f = 0; f < pos.count; f += 3) {
      const c = new THREE.Vector3();
      for (let j = 0; j < 3; j++) c.add(new THREE.Vector3().fromBufferAttribute(pos, f + j));
      c.normalize();
      const isTip = tips.some((t) => t.dot(c) > 0.93);
      for (let j = 0; j < 3; j++) (isTip ? navy : white).toArray(col, (f + j) * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const ball = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), shadowMat);
    sh.rotation.x = -Math.PI / 2;
    scene.add(ball, sh);
    ball.userData.shadow = sh;
    return ball;
  }

  makePitch();
  makeStands();
  makeGoal();
  const ball = makeBall();

  // défenseurs (blancs, touches grenat) placés comme sur le slalom de 2007
  const DEF_START = [[-3, -10], [4, -15], [-6, -21], [5.5, -27], [-2.5, -33], [6.5, -38]];
  const defenders = DEF_START.map(() => ({
    man: makeMan(C.offwhite, C.grenat, C.offwhite),
    pos: new THREE.Vector2(), vel: new THREE.Vector2(),
    state: "idle", timer: 0, speed: 0, phase: Math.random() * 6, lunge: new THREE.Vector2(),
  }));
  const keeper = {
    man: makeMan(C.grenat, C.navy, C.navy),
    pos: new THREE.Vector2(), vel: new THREE.Vector2(), phase: 0, dive: 0, react: 0, targetX: 0,
  };

  /* ---------- état ---------- */
  const S = {
    mode: "intro", // intro | play | pause | lost | goal
    pos: new THREE.Vector2(), vel: new THREE.Vector2(),
    yaw: 0, pitch: -0.22, yawRate: 0, lastYaw: 0, phase: 0,
    stamina: 1, sprintLock: false,
    ballFree: false, ballPos: new THREE.Vector3(), ballVel: new THREE.Vector3(), lat: 0, shotT: 0,
    slow: 1, goalT: 0, fov: 70, distShown: -1,
  };
  const input = { f: 0, b: 0, l: 0, r: 0, sprint: false, stickX: 0, stickY: 0 };

  function reset() {
    S.pos.set(0, 0); S.vel.set(0, 0);
    goal.shown = false;
    S.yaw = 0; S.lastYaw = 0; S.pitch = -0.22; S.yawRate = 0; S.phase = 0;
    S.stamina = 1; S.sprintLock = false;
    S.ballFree = false; S.ballVel.set(0, 0, 0); S.lat = 0; S.shotT = 0;
    S.slow = 1; S.goalT = 0;
    S.ballPos.set(0, P.ballR, S.pos.y - P.ballAhead);
    defenders.forEach((d, i) => {
      d.pos.set(DEF_START[i][0], DEF_START[i][1]);
      d.vel.set(0, 0);
      d.state = "idle"; d.timer = 0;
      d.speed = 5.3 + i * 0.12 + Math.random() * 0.3;
      d.man.rotation.set(0, 0, 0);
    });
    keeper.pos.set(0, FIELD.goalZ + 0.7); keeper.vel.set(0, 0); keeper.dive = 0; keeper.react = 0;
    keeper.man.rotation.set(0, 0, 0);
    // place les silhouettes tout de suite (sinon elles restent en 0,0 sur la caméra avant la 1re mise à jour)
    defenders.forEach((d) => d.man.position.set(d.pos.x, 0, d.pos.y));
    keeper.man.position.set(keeper.pos.x, 0, keeper.pos.y);
    net.hit = null;
    net.back.geometry.attributes.position.array.set(net.base);
    net.back.geometry.attributes.position.needsUpdate = true;
    input.f = input.b = input.l = input.r = 0; input.sprint = false; input.stickX = input.stickY = 0;
  }

  /* ---------- écrans ---------- */
  const screens = {};
  document.querySelectorAll("[data-g-screen]").forEach((el) => (screens[el.dataset.gScreen] = el));
  const hud = $("[data-g-hud]"), touchUi = $("[data-g-touch]");
  const show = (name) => Object.entries(screens).forEach(([k, el]) => el.classList.toggle("is-on", k === name));
  const lock = () => { if (!touch && canvas.requestPointerLock) try { canvas.requestPointerLock(); } catch (e) {} };
  const unlock = () => { if (document.pointerLockElement) document.exitPointerLock(); };

  function start() {
    reset();
    S.mode = "play";
    show(null);
    hud.hidden = false;
    if (touch) touchUi.hidden = false;
    lock();
    const hint = $(".g-hint");
    hint?.classList.remove("is-faded");
    clearTimeout(start.t);
    start.t = setTimeout(() => hint?.classList.add("is-faded"), 6000);
  }
  function lose(title, text) {
    if (S.mode !== "play") return;
    S.mode = "lost";
    $("[data-g-lost-title]").textContent = title;
    $("[data-g-lost-text]").textContent = text;
    unlock();
    setTimeout(() => { show("lost"); screens.lost.querySelector("button").focus({ preventScroll: true }); }, 450);
  }
  function pause() {
    if (S.mode !== "play") return;
    S.mode = "pause";
    show("pause");
  }
  function resume() {
    if (S.mode !== "pause") return;
    S.mode = "play";
    show(null);
    lock();
  }
  $("[data-g-play]").addEventListener("click", start);
  $("[data-g-replay]").addEventListener("click", start);
  $("[data-g-resume]").addEventListener("click", resume);
  let lockedAt = 0;
  document.addEventListener("pointerlockchange", () => { if (document.pointerLockElement) lockedAt = performance.now(); });
  document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && S.mode === "play" && !touch) pause(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

  /* ---------- clavier / souris ---------- */
  const KEYS = {
    KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r",
  };
  // e.code = position physique : ZQSD (AZERTY) et WASD (QWERTY) donnent les mêmes codes
  const keyOf = (e) => KEYS[e.code] || { z: "f", q: "l", s: "b", d: "r", w: "f", a: "l" }[e.key?.toLowerCase()];
  document.addEventListener("keydown", (e) => {
    if (e.key === "Shift") input.sprint = true;
    const k = keyOf(e);
    if (k && S.mode === "play") { input[k] = 1; e.preventDefault(); }
    if ((e.key === "Enter" || e.key === " ") && S.mode === "play") { shoot(); e.preventDefault(); }
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Shift") input.sprint = false;
    const k = keyOf(e);
    if (k) input[k] = 0;
  });
  const look = (dx, dy) => {
    S.yaw -= dx;
    S.pitch = Math.max(-0.75, Math.min(0.25, S.pitch - dy));
  };
  document.addEventListener("mousemove", (e) => {
    if (S.mode !== "play") return;
    if (document.pointerLockElement === canvas) {
      // Chrome envoie parfois un saut énorme juste après le verrouillage : ignoré
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250 || performance.now() - lockedAt < 120) return;
      look(e.movementX * 0.0022, e.movementY * 0.0018);
    }
    else if (e.buttons & 1 && !touch) look(e.movementX * 0.004, e.movementY * 0.003); // sans pointer lock : glisser
  });
  canvas.addEventListener("mousedown", (e) => {
    if (touch || S.mode !== "play" || e.button !== 0) return;
    if (document.pointerLockElement === canvas) shoot();
    else lock();
  });

  /* ---------- tactile : joystick gauche, regard à droite ---------- */
  const stick = $("[data-g-stick]"), knob = $("[data-g-knob]");
  const tp = { stick: null, look: null, ox: 0, oy: 0, lx: 0, ly: 0 };
  const R = 52;
  touchUi.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || S.mode !== "play") return;
    touchUi.setPointerCapture(e.pointerId);
    if (e.clientX < window.innerWidth * 0.45 && tp.stick === null) {
      tp.stick = e.pointerId; tp.ox = e.clientX; tp.oy = e.clientY;
      stick.style.left = `${tp.ox}px`; stick.style.top = `${tp.oy}px`;
      stick.classList.add("is-on");
    } else if (tp.look === null) {
      tp.look = e.pointerId; tp.lx = e.clientX; tp.ly = e.clientY;
    }
  });
  touchUi.addEventListener("pointermove", (e) => {
    if (e.pointerId === tp.stick) {
      let dx = e.clientX - tp.ox, dy = e.clientY - tp.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.stickX = dx / R; input.stickY = -dy / R;
    } else if (e.pointerId === tp.look) {
      look((e.clientX - tp.lx) * 0.006, (e.clientY - tp.ly) * 0.0045);
      tp.lx = e.clientX; tp.ly = e.clientY;
    }
  });
  const endTouch = (e) => {
    if (e.pointerId === tp.stick) {
      tp.stick = null; input.stickX = input.stickY = 0;
      knob.style.transform = ""; stick.classList.remove("is-on");
    }
    if (e.pointerId === tp.look) tp.look = null;
  };
  touchUi.addEventListener("pointerup", endTouch);
  touchUi.addEventListener("pointercancel", endTouch);
  const sprintBtn = $("[data-g-sprint]"), shootBtn = $("[data-g-shoot]");
  const sprintOn = (on) => (e) => { e.preventDefault(); input.sprint = on; sprintBtn.classList.toggle("is-down", on); };
  sprintBtn.addEventListener("pointerdown", sprintOn(true));
  ["pointerup", "pointercancel", "pointerleave"].forEach((t) => sprintBtn.addEventListener(t, sprintOn(false)));
  shootBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    shootBtn.classList.add("is-down");
    setTimeout(() => shootBtn.classList.remove("is-down"), 150);
    shoot();
  });

  /* ---------- tir ---------- */
  function shoot() {
    if (S.mode !== "play" || S.ballFree) return;
    S.ballFree = true;
    S.shotT = 0;
    const sp = P.shotSpeed + (input.sprint && S.stamina > 0 ? 3 : 0);
    const vy = Math.max(0.6, Math.min(9, 2.6 + (S.pitch + 0.22) * 18));
    S.ballVel.set(-Math.sin(S.yaw) * sp, vy, -Math.cos(S.yaw) * sp);
    keeper.react = 0.2; // temps de réaction du gardien
    S.camKick = 1;
  }

  /* ---------- flou de vitesse : traînées radiales peintes une fois ---------- */
  const speedCv = $("[data-g-speed]");
  function paintSpeed() {
    const w = (speedCv.width = Math.round(window.innerWidth / 2));
    const h = (speedCv.height = Math.round(window.innerHeight / 2));
    const g = speedCv.getContext("2d");
    const cx = w / 2, cy = h * 0.48, rMax = Math.hypot(w, h) / 2;
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = rMax * (0.45 + Math.random() * 0.3), r1 = r0 + rMax * (0.15 + Math.random() * 0.35);
      const grd = g.createLinearGradient(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      grd.addColorStop(0, "rgba(246,245,240,0)");
      grd.addColorStop(1, "rgba(246,245,240,0.35)");
      g.strokeStyle = grd;
      g.lineWidth = 0.6 + Math.random() * 1.4;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
  }

  /* ---------- grain (texture de bruit en CSS) ---------- */
  {
    const n = document.createElement("canvas");
    n.width = n.height = 180;
    const g = n.getContext("2d");
    const img = g.createImageData(180, 180);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    document.documentElement.style.setProperty("--grain", `url(${n.toDataURL()})`);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    paintSpeed();
  }
  window.addEventListener("resize", resize);
  resize();

  /* ---------- boucle ---------- */
  const tmp2 = new THREE.Vector2(), tmp3 = new THREE.Vector3();
  const distEl = $("[data-g-dist]"), stamEl = $("[data-g-stamina]"), stamBar = $(".g-stamina");
  const fwd = () => tmp2.set(-Math.sin(S.yaw), -Math.cos(S.yaw));

  function updatePlayer(dt) {
    // entrées → vitesse voulue dans le repère du regard
    let mf = input.f - input.b + input.stickY;
    let ms = input.r - input.l + input.stickX;
    const m = Math.hypot(mf, ms);
    if (m > 1) { mf /= m; ms /= m; }
    const canSprint = S.stamina > 0.02 && !S.sprintLock;
    const sprinting = input.sprint && canSprint && mf > 0.2;
    S.stamina = Math.max(0, Math.min(1, S.stamina + (sprinting ? -P.staminaDrain : P.staminaRegen) * dt));
    if (S.stamina <= 0.02) S.sprintLock = true;
    if (S.sprintLock && S.stamina > 0.3) S.sprintLock = false;
    const speed = (sprinting ? P.sprint : P.run) * (mf < 0 ? P.back : 1);
    const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
    const tx = (-sy * mf + cy * ms) * speed, tz = (-cy * mf - sy * ms) * speed;
    const a = 1 - Math.exp(-P.accel * dt);
    S.vel.x += (tx - S.vel.x) * a;
    S.vel.y += (tz - S.vel.y) * a;
    S.pos.x += S.vel.x * dt;
    S.pos.y += S.vel.y * dt;
    S.pos.x = Math.max(-FIELD.halfW + 0.5, Math.min(FIELD.halfW - 0.5, S.pos.x));
    S.pos.y = Math.max(FIELD.goalZ + 0.6, Math.min(FIELD.backZ - 1, S.pos.y));
    // collisions avec les joueurs (on les contourne, pas de perte de balle)
    for (const o of [...defenders, keeper]) {
      tmp2.set(S.pos.x - o.pos.x, S.pos.y - o.pos.y);
      const d = tmp2.length();
      if (d < 0.65 && d > 1e-4) S.pos.addScaledVector(tmp2.divideScalar(d), 0.65 - d);
    }
    const v = S.vel.length();
    S.phase += dt * v * 1.5;
    S.sprinting = sprinting;
    S.speed = v;
    // vitesse de rotation (pour décaler le ballon dans les virages)
    const yr = (S.yaw - S.lastYaw) / Math.max(dt, 1e-3);
    S.lastYaw = S.yaw;
    S.yawRate += (yr - S.yawRate) * (1 - Math.exp(-10 * dt));
    return sprinting;
  }

  function updateBallDribble(dt) {
    const f = fwd();
    const vN = Math.min(1, S.speed / P.sprint);
    // petites touches : le ballon s'éloigne un peu du pied puis revient
    const touchOut = Math.pow(Math.abs(Math.sin(S.phase * 0.5)), 3) * 0.45 * vN;
    const latT = Math.max(-0.75, Math.min(0.75, S.yawRate * 0.28));
    S.lat += (latT - S.lat) * (1 - Math.exp(-6 * dt));
    const d = P.ballAhead + touchOut + vN * 0.25;
    const rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw); // vecteur droite
    tmp3.set(S.pos.x + f.x * d + rx * S.lat, P.ballR, S.pos.y + f.y * d + rz * S.lat);
    const before = tmp3.clone().sub(S.ballPos);
    S.ballPos.lerp(tmp3, 1 - Math.exp(-16 * dt));
    rollBall(before.multiplyScalar(1 - Math.exp(-16 * dt)));
  }
  function rollBall(delta) {
    const l = Math.hypot(delta.x, delta.z);
    if (l < 1e-5) return;
    tmp3.set(delta.z, 0, -delta.x).normalize();
    ball.rotateOnWorldAxis(tmp3, l / P.ballR);
  }

  function updateBallFree(dt) {
    S.shotT += dt;
    const v = S.ballVel, p = S.ballPos;
    const prevZ = (S.prevBallZ = p.z);
    v.y -= P.gravity * dt;
    v.multiplyScalar(Math.exp(-0.12 * dt));
    const delta = v.clone().multiplyScalar(dt);
    p.add(delta);
    rollBall(delta);
    if (p.y < P.ballR) {
      p.y = P.ballR;
      if (v.y < 0) v.y = -v.y * 0.45;
      v.x *= 0.92; v.z *= 0.92;
    }
    const G = FIELD.goalZ;
    if (S.mode === "goal") {
      // dans le filet : le ballon s'arrête contre le fond
      if (p.z < G - FIELD.netDepth + 0.2) { p.z = G - FIELD.netDepth + 0.2; v.multiplyScalar(0.15); }
      return;
    }
    // le ballon franchit la ligne de but
    if (prevZ >= G && p.z < G) {
      if (Math.abs(p.x) < FIELD.goalHalfW - P.ballR && p.y < FIELD.goalH - P.ballR) return goal();
      return lose("Raté", Math.abs(p.x) < FIELD.goalHalfW + 0.3 && p.y < FIELD.goalH + 0.3 ? "Sur le poteau !" : "Le tir passe à côté.");
    }
    if (S.shotT > 3.2 || (v.length() < 0.6 && p.y <= P.ballR + 0.01)) lose("Raté", "Le tir s'est arrêté avant le but.");
    if (Math.abs(p.x) > FIELD.halfW + 1) lose("Raté", "Le ballon est sorti.");
  }

  function updateDefenders(dt) {
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw); // copie : tmp2 est réutilisé dans la boucle
    for (const d of defenders) {
      tmp2.set(S.ballPos.x - d.pos.x, S.ballPos.z - d.pos.y);
      const toBall = tmp2.length();
      const toPlayer = Math.hypot(S.pos.x - d.pos.x, S.pos.y - d.pos.y);
      // dépassé : le défenseur est derrière Messi → il ralentit (comme sur le slalom)
      const behind = (d.pos.x - S.pos.x) * fx + (d.pos.y - S.pos.y) * fz < -1.2;
      if (d.state === "idle" && toPlayer < 16 && !S.ballFree) { d.state = "chase"; d.timer = 0; }
      let target = null, spd = 0;
      if (d.state === "chase") {
        // vise le ballon, un peu en avance sur la course de Messi
        target = tmp3.set(S.ballPos.x + S.vel.x * 0.35, 0, S.ballPos.z + S.vel.y * 0.35);
        spd = d.speed * (behind ? 0.55 : 1);
        if (S.ballFree) spd *= 0.4;
        d.timer -= dt;
        if (toBall < 3 && !behind && d.timer <= 0 && !S.ballFree) {
          d.state = "lunge"; d.timer = 0.32;
          d.lunge.set(S.ballPos.x + S.vel.x * 0.25 - d.pos.x, S.ballPos.z + S.vel.y * 0.25 - d.pos.y).normalize();
        }
      } else if (d.state === "lunge") {
        d.vel.copy(d.lunge).multiplyScalar(9.5);
        d.timer -= dt;
        if (d.timer <= 0) { d.state = "recover"; d.timer = 0.9; }
      } else if (d.state === "recover") {
        spd = 1.2;
        target = tmp3.set(S.ballPos.x, 0, S.ballPos.z);
        d.timer -= dt;
        if (d.timer <= 0) { d.state = "chase"; d.timer = 0.4; }
      }
      if (target && d.state !== "lunge") {
        tmp2.set(target.x - d.pos.x, target.z - d.pos.y);
        const l = tmp2.length();
        if (l > 0.01) tmp2.multiplyScalar(spd / l);
        const a = 1 - Math.exp(-5 * dt);
        d.vel.x += (tmp2.x - d.vel.x) * a;
        d.vel.y += (tmp2.y - d.vel.y) * a;
      } else if (!target && d.state !== "lunge") d.vel.multiplyScalar(Math.exp(-6 * dt));
      // écart entre défenseurs
      for (const o of defenders) {
        if (o === d) continue;
        const dx = d.pos.x - o.pos.x, dz = d.pos.y - o.pos.y, l = Math.hypot(dx, dz);
        if (l < 1.2 && l > 1e-4) { d.pos.x += (dx / l) * (1.2 - l) * 0.5; d.pos.y += (dz / l) * (1.2 - l) * 0.5; }
      }
      d.pos.addScaledVector(d.vel, dt);
      // ballon touché
      if (!S.ballFree && toBall < (d.state === "lunge" ? 0.8 : 0.55)) {
        lose("Ballon perdu", "Un défenseur t'a pris le ballon.");
      }
      // rendu
      const v = d.vel.length();
      d.phase += dt * v * 1.6;
      d.man.position.set(d.pos.x, 0, d.pos.y);
      if (v > 0.3) d.man.rotation.y = Math.atan2(d.vel.x, d.vel.y);
      d.man.rotation.x = d.state === "lunge" ? 0.35 : 0; // tacle : penché vers l'avant
      animLegs(d.man, d.phase, Math.min(1, v / 5));
    }
  }

  function updateKeeper(dt) {
    const G = FIELD.goalZ;
    let tx, tz, spd;
    if (S.ballFree) {
      // plongeon vers le point de passage prévu du ballon
      keeper.react -= dt;
      if (keeper.react <= 0 && S.mode === "play") {
        const v = S.ballVel, p = S.ballPos;
        const t = v.z < -0.1 ? (keeper.pos.y - p.z) / v.z : 0;
        keeper.targetX = Math.max(-3.4, Math.min(3.4, p.x + v.x * Math.max(0, t)));
        tx = keeper.targetX; tz = keeper.pos.y; spd = 5;
        keeper.dive = Math.max(-1, Math.min(1, (keeper.targetX - keeper.pos.x) / 1.5));
      } else { tx = keeper.pos.x; tz = keeper.pos.y; spd = 0; }
      // arrêt : le ballon passe à portée de bras
      const p = S.ballPos;
      // le ballon traverse le plan du gardien (test de franchissement : sûr même à 30 fps)
      const crossed = (S.prevBallZ - keeper.pos.y) * (p.z - keeper.pos.y) <= 0;
      if (S.mode === "play" && crossed && Math.abs(p.x - keeper.pos.x) < 1 && p.y < 2.3) {
        S.ballVel.z = Math.abs(S.ballVel.z) * 0.35;
        S.ballVel.x *= -0.4;
        lose("Arrêté", "Le gardien a sorti le tir.");
      }
    } else if (S.pos.y < G + 18) {
      // Messi entre dans la surface : le gardien sort à sa rencontre
      tmp2.set(S.ballPos.x - 0, S.ballPos.z - G);
      const l = tmp2.length();
      const out = Math.min(Math.max(0.7, l - 1.2), 9);
      tx = (tmp2.x / l) * out; tz = G + (tmp2.y / l) * out; spd = 4.4;
    } else {
      tx = Math.max(-2, Math.min(2, S.ballPos.x * 0.12)); tz = G + 0.7; spd = 3;
    }
    tmp2.set(tx - keeper.pos.x, tz - keeper.pos.y);
    const l = tmp2.length();
    if (l > 0.02) keeper.pos.addScaledVector(tmp2.divideScalar(l), Math.min(l, spd * dt));
    keeper.vel.set(0, 0);
    if (!S.ballFree && S.mode === "play" && Math.hypot(S.ballPos.x - keeper.pos.x, S.ballPos.z - keeper.pos.y) < 0.9) {
      lose("Ballon perdu", "Le gardien a capté le ballon.");
    }
    keeper.phase += dt * spd * (l > 0.05 ? 1.6 : 0);
    keeper.man.position.set(keeper.pos.x, 0, keeper.pos.y);
    keeper.man.rotation.y = Math.atan2(S.pos.x - keeper.pos.x, S.pos.y - keeper.pos.y);
    keeper.man.rotation.z += ((S.ballFree ? -keeper.dive * 1.1 : 0) - keeper.man.rotation.z) * (1 - Math.exp(-8 * dt));
    animLegs(keeper.man, keeper.phase, 0.6);
  }

  function goal() {
    S.mode = "goal";
    S.goalT = 0;
    net.hit = { x: S.ballPos.x, y: S.ballPos.y, t: 0 };
    unlock();
    hud.hidden = true;
    touchUi.hidden = true;
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (S.mode === "goal") {
      // ralenti : 25 % de la vitesse pendant 1,6 s, puis « BUT ! » et retour à l'accueil
      S.goalT += rawDt;
      S.slow = S.goalT < 1.6 ? 0.25 : Math.min(1, S.slow + rawDt);
      if (S.goalT > 1.2 && !goal.shown) {
        goal.shown = true;
        show("goal");
        setTimeout(() => (window.location.href = HOME), 2000);
      }
    }
    const dt = rawDt * S.slow;

    if (S.mode === "play" || S.mode === "goal") {
      if (S.mode === "play") updatePlayer(dt);
      else { S.vel.multiplyScalar(Math.exp(-3 * dt)); S.speed = S.vel.length(); S.sprinting = false; }
      if (S.ballFree) updateBallFree(dt);
      else if (S.mode === "play") updateBallDribble(dt);
      if (S.mode === "play") updateDefenders(dt);
      updateKeeper(dt);
      updateNet(dt);
    }

    // caméra : balancement de course, petit roulis, champ élargi au sprint
    const vN = Math.min(1, (S.speed || 0) / P.sprint);
    const bob = reduce ? 0 : Math.sin(S.phase) * 0.035 * vN;
    let yaw = S.yaw, pitch = S.pitch;
    if (S.mode === "goal") {
      // la caméra se tourne vers le filet pendant le ralenti
      const want = Math.atan2(-(S.ballPos.x - S.pos.x), -(S.ballPos.z - S.pos.y));
      S.yaw += (want - S.yaw) * (1 - Math.exp(-3 * rawDt));
      S.pitch += (-0.05 - S.pitch) * (1 - Math.exp(-3 * rawDt));
      yaw = S.yaw; pitch = S.pitch;
    }
    camera.position.set(S.pos.x, P.eye + bob, S.pos.y);
    camera.rotation.set(pitch, yaw, reduce ? 0 : Math.sin(S.phase * 0.5) * 0.012 * vN);
    const fovT = 70 + (reduce ? 0 : (S.sprinting ? 8 : 0) * vN);
    S.fov += (fovT - S.fov) * (1 - Math.exp(-5 * rawDt));
    if (Math.abs(camera.fov - S.fov) > 0.05) { camera.fov = S.fov; camera.updateProjectionMatrix(); }
    speedCv.style.opacity = reduce ? 0 : (S.sprinting ? Math.max(0, (vN - 0.6) / 0.4) * 0.55 : 0).toFixed(3);

    // ballon + ombre
    ball.position.copy(S.ballPos);
    ball.userData.shadow.position.set(S.ballPos.x, 0.012, S.ballPos.z);
    ball.userData.shadow.scale.setScalar(Math.max(0.4, 1 - S.ballPos.y * 0.25));

    // HUD
    if (S.mode === "play") {
      const dist = Math.max(0, Math.round(S.pos.y - FIELD.goalZ));
      if (dist !== S.distShown) { S.distShown = dist; distEl.textContent = dist; }
      stamEl.style.transform = `scaleX(${S.stamina.toFixed(3)})`;
      stamBar.classList.toggle("is-low", S.sprintLock);
    }
    if (S.mode === "intro" && !reduce) {
      // écran d'accueil : léger balayage du regard vers le but
      S.yaw = Math.sin(now / 2600) * 0.12;
      S.pitch = -0.12 + Math.sin(now / 3300) * 0.03;
    }

    renderer.render(scene, camera);
  }
  reset();
  S.ballPos.set(0, P.ballR, S.pos.y - P.ballAhead);
  requestAnimationFrame(frame);
  // tests automatisés uniquement (404.html?debug)
  if (/[?&]debug\b/.test(location.search)) window.__g404 = { S, input, defenders, keeper, shoot, start, HOME };
})();
