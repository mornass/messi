/* =========================================================
   HERO — portage de la logique landonorris.com (reference/)
   Étape 1 : curseur fluide (vraie simulation "stable fluids")
     - Time   : delta = secondes × 100 (plafonné), comme l'original
     - Mouse  : coordonnées normalisées + "pace" + versions amorties (damp)
     - Idle   : curseur fantôme quand la souris ne bouge plus
     - Fluid  : advection BFECC → force souris → divergence → Poisson → pression
     - Output : vitesse → texture "cursor effect" → masque step(0.1, …)
   ========================================================= */
(() => {
  // ---------- Config ----------
  const IMAGES = {
    base: "assets/img/messi-actuel.png",
    reveal: "assets/img/messi-jeune.png",
  };

  const COLORS = {
    navy: "#0B1F3A",
    offwhite: "#F6F5F0",
    barca: "#004D98",
    grenat: "#A50044",
  };

  // Valeurs de la simulation (identiques à l'original)
  const FLUID = {
    iterations_poisson: 4,
    dissipation: 0.96,
    mouse_force: 50,
    resolution: 0.1,
    cursor_size: 18,
    straightness: 1,
    dt: 0.014,
    BFECC: true,
    interval: 1 / 60, // pas fixe de simulation
  };

  // Lissage souris (identique à l'original : damp(λ, delta×100))
  const EASE = {
    normalized: 0.025,
    pace: 0.01,
  };

  // Fond topographique (paramètres headScene de l'original)
  const BG = {
    SCALE: 1,
    SPEED: 0.1,
    DISTORT_SCALE: 1,
    DISTORT_INTENSITY: 0.5,
    NOISE_DETAIL: 3,
    CURSOR_INTENSITY: 0.15,
    CURSOR_SCALE: 3,
    CURSOR_BOUNCE: -0.75,
    LINE_WIDTH: 1.0, // px écran
  };

  // Couleurs du shader (équivalents palette Barça des COLOR_* de l'original)
  const SHADER_COLORS = {
    BACKGROUND: COLORS.offwhite,
    OUTLINE: "#CED1D3",           // lignes topo sur blanc cassé
    CURSOR_BACKGROUND: COLORS.navy,
    CURSOR_FOREGROUND: "#102A4C", // 2e ton des bandes sous le curseur
    CURSOR_OUTLINE: COLORS.barca,
    DUO_DARK: "#081830",          // bichromie : ombres
    DUO_LIGHT: "#8EA6C8",         // bichromie : lumières
  };

  const LAYOUT = {
    imageHeight: 0.92,           // hauteur de l'image / hauteur de la boîte
    facePivot: [0.5, 0.72],      // point du visage (uv image) autour duquel on zoome
    faceTarget: 0.56,            // hauteur du visage dans la boîte en fin de scroll
    parallax: 14,                // px
  };

  const container = document.querySelector('[data-gl="hero"]');
  if (!container || !window.THREE) return;

  const V2 = THREE.Vector2;
  const damp = (x, y, lambda, dt) => x + (y - x) * (1 - Math.exp(-lambda * dt));

  // ---------- Lenis + ScrollTrigger ----------
  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({ lerp: 0.1 });
  window.lenis = lenis; // partagé (comme l'original : window.lenis)
  lenis.on("scroll", ScrollTrigger.update);
  // scroll bloqué tant que le preloader est affiché
  if (window.Preloader) {
    lenis.stop();
    window.Preloader.onDone(() => lenis.start());
  }
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  // lagSmoothing(0) (recommandé avec Lenis) seulement après le preloader :
  // pendant le chargement, la compilation des shaders ne doit pas faire sauter l'animation
  if (window.Preloader) window.Preloader.onDone(() => gsap.ticker.lagSmoothing(0));
  else gsap.ticker.lagSmoothing(0);

  // =========================================================
  // Sizes / Renderer (résolution native de l'écran)
  // =========================================================
  const sizes = {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  };

  // alpha : hors de la boîte, le canvas est transparent (on voit les bandeaux derrière)
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(sizes.pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false; // indispensable : la force souris s'additionne sur la vitesse advectée
  container.appendChild(renderer.domElement);

  const rawCamera = new THREE.Camera();
  const quadGeometry = new THREE.PlaneGeometry(2, 2);

  // =========================================================
  // Time  (delta = secondes × 100, plafonné à 1/30 s)
  // =========================================================
  const time = {
    clock: new THREE.Clock(),
    delta: 0,
    elapsed: 0,
    tick() {
      this.delta = Math.min(this.clock.getDelta(), 1 / 30) * 100;
      this.elapsed = this.clock.elapsedTime;
    },
  };

  // =========================================================
  // Mouse  (normalisé -1..1, pace = distance parcourue / frame)
  // =========================================================
  const mouse = {
    normalized: { current: new V2(), previous: new V2() },
    pace: { default: 0, separated: new V2() },

    setFromClient(x, y) {
      this.normalized.current.set((x / sizes.width) * 2 - 1, -(y / sizes.height) * 2 + 1);
    },
    update() {
      const c = this.normalized.current, p = this.normalized.previous;
      this.pace.default = c.distanceTo(p);
      this.pace.separated.set(c.x - p.x, c.y - p.y);
      p.copy(c);
    },
    createEasedNormalized(lambda) {
      const value = new V2();
      return {
        value,
        update: (dt) => {
          value.x = damp(value.x, this.normalized.current.x, lambda, dt);
          value.y = damp(value.y, this.normalized.current.y, lambda, dt);
        },
      };
    },
    createEasedPace(lambda) {
      const value = { default: 0, separated: new V2() };
      return {
        value,
        update: (dt) => {
          value.default = damp(value.default, this.pace.default, lambda, dt);
          value.separated.x = damp(value.separated.x, this.pace.separated.x, lambda, dt);
          value.separated.y = damp(value.separated.y, this.pace.separated.y, lambda, dt);
        },
      };
    },
  };

  // =========================================================
  // Idle state  (curseur fantôme quand la souris est immobile)
  // =========================================================
  const idle = {
    isMoving: true,
    isMovingPrevious: true,
    moveTimeout: null,
    progress: { x: 0, y: 0 },
    cursor: new V2(),
    timeline: null,

    init() {
      this.initial = setTimeout(() => (this.isMoving = false), 2500);
      const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 3 });
      tl.fromTo(this.progress, { y: 0 }, { y: 1, duration: 2.5, ease: "none" }, 0);
      tl.fromTo(this.progress, { x: 0 }, { x: 1, duration: 2.5, ease: "power1.inOut" }, 0);
      tl.fromTo(this.progress, { y: 1 }, { y: 0, duration: 2.5, ease: "none" }, 4);
      tl.fromTo(this.progress, { x: 1 }, { x: 0, duration: 2.5, ease: "power1.inOut" }, 4);
      this.timeline = tl;
    },
    move() {
      this.isMoving = true;
      clearTimeout(this.initial);
      clearTimeout(this.moveTimeout);
      this.moveTimeout = setTimeout(() => (this.isMoving = false), 2000);
    },
    update() {
      if (!this.isMoving) {
        this.cursor.x = -Math.cos(this.progress.x * Math.PI * 4) * 0.75;
        this.cursor.y = Math.cos(this.progress.y * Math.PI) * 0.5;
      }
      if (this.isMoving !== this.isMovingPrevious) {
        if (!this.isMoving) {
          this.timeline.seek(0);
          this.timeline.play();
        } else {
          this.timeline.pause();
        }
      }
      this.isMovingPrevious = this.isMoving;
    },
  };
  idle.init();

  // =========================================================
  // Souris de la simulation (coords + diff par pas de simulation)
  // =========================================================
  const fluidMouse = {
    coords: new V2(),
    coords_old: new V2(),
    diff: new V2(),
    set() {
      this.coords.copy(mouse.normalized.current);
    },
    update() {
      if (idle.isMoving) {
        this.diff.subVectors(this.coords, this.coords_old);
        this.coords_old.copy(this.coords);
        if (this.coords_old.x === 0 && this.coords_old.y === 0) this.diff.set(0, 0);
      } else {
        this.coords.copy(idle.cursor);
        this.diff.subVectors(this.coords, this.coords_old);
        this.coords_old.copy(this.coords);
      }
    },
  };

  // ---------- Événements ----------
  function onMouseMove(e) {
    mouse.setFromClient(e.clientX, e.clientY);
    fluidMouse.set();
    idle.move();
  }
  function onTouch(e) {
    if (e.touches.length !== 1) return;
    mouse.setFromClient(e.touches[0].clientX, e.touches[0].clientY);
    fluidMouse.set();
    idle.move();
  }
  document.addEventListener("mousemove", onMouseMove, { passive: true });
  document.addEventListener("touchstart", onTouch, { passive: true });
  document.addEventListener("touchmove", onTouch, { passive: true });

  // =========================================================
  // FLUID — shaders (repris de la référence)
  // =========================================================
  const FACE_VERT = /* glsl */ `
    attribute vec3 position;
    uniform vec2 px;
    uniform vec2 boundarySpace;
    varying vec2 uv;
    precision highp float;
    void main(){
      vec3 pos = position;
      vec2 scale = 1.0 - boundarySpace * 2.0;
      pos.xy = pos.xy * scale;
      uv = vec2(0.5) + (pos.xy) * 0.5;
      gl_Position = vec4(pos, 1.0);
    }
  `;

  const ADVECTION_FRAG = /* glsl */ `
    precision highp float;
    uniform sampler2D velocity;
    uniform float dt;
    uniform float dissipation;
    uniform bool isBFECC;
    uniform vec2 fboSize;
    uniform vec2 px;
    varying vec2 uv;
    void main(){
      vec2 ratio = max(fboSize.x, fboSize.y) / fboSize;
      if (isBFECC == false) {
        vec2 vel = texture2D(velocity, uv).xy;
        vec2 uv2 = uv - vel * dt * ratio;
        vec2 newVel = texture2D(velocity, uv2).xy;
        gl_FragColor = vec4(newVel, 0.0, 0.0);
      } else {
        vec2 spot_new = uv;
        vec2 vel_old = texture2D(velocity, uv).xy;
        vec2 spot_old = spot_new - vel_old * dt * ratio;
        vec2 vel_new1 = texture2D(velocity, spot_old).xy;
        vec2 spot_new2 = spot_old + vel_new1 * dt * ratio;
        vec2 error = spot_new2 - spot_new;
        vec2 spot_new3 = spot_new - error / 2.0;
        vec2 vel_2 = texture2D(velocity, spot_new3).xy;
        vec2 spot_old2 = spot_new3 - vel_2 * dt * ratio;
        vec2 newVel2 = texture2D(velocity, spot_old2).xy * dissipation;
        gl_FragColor = vec4(newVel2, 0.0, 0.0);
      }
    }
  `;

  const MOUSE_VERT = /* glsl */ `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform vec2 center;
    uniform vec2 scale;
    uniform vec2 px;
    varying vec2 vUv;
    void main(){
      vec2 pos = position.xy * scale * 2.0 * px + center;
      vUv = uv;
      gl_Position = vec4(pos, 0.0, 1.0);
    }
  `;

  const EXTERNAL_FORCE_FRAG = /* glsl */ `
    precision highp float;
    uniform vec2 force;
    uniform vec2 center;
    uniform vec2 scale;
    uniform vec2 px;
    varying vec2 vUv;
    void main(){
      vec2 circle = (vUv - 0.5) * 2.0;
      float d = 1.0 - min(length(circle), 1.0);
      d *= d;
      gl_FragColor = vec4(force * d, 0, 1);
    }
  `;

  const DIVERGENCE_FRAG = /* glsl */ `
    precision highp float;
    uniform sampler2D velocity;
    uniform float dt;
    uniform vec2 px;
    varying vec2 uv;
    void main(){
      float x0 = texture2D(velocity, uv - vec2(px.x, 0)).x;
      float x1 = texture2D(velocity, uv + vec2(px.x, 0)).x;
      float y0 = texture2D(velocity, uv - vec2(0, px.y)).y;
      float y1 = texture2D(velocity, uv + vec2(0, px.y)).y;
      float divergence = (x1 - x0 + y1 - y0) / 2.0;
      gl_FragColor = vec4(divergence / dt);
    }
  `;

  const POISSON_FRAG = /* glsl */ `
    precision highp float;
    uniform sampler2D pressure;
    uniform sampler2D divergence;
    uniform float straightness;
    uniform vec2 px;
    varying vec2 uv;
    void main(){
      float p0 = texture2D(pressure, uv + vec2(px.x * 2.0, 0)).r;
      float p1 = texture2D(pressure, uv - vec2(px.x * 2.0, 0)).r;
      float p2 = texture2D(pressure, uv + vec2(0, px.y * 2.0)).r;
      float p3 = texture2D(pressure, uv - vec2(0, px.y * 2.0)).r;
      float div = texture2D(divergence, uv).r;
      float newP = (p0 + p1 + p2 + p3) / (4.0 + straightness) - div;
      gl_FragColor = vec4(newP);
    }
  `;

  const PRESSURE_FRAG = /* glsl */ `
    precision highp float;
    uniform sampler2D pressure;
    uniform sampler2D velocity;
    uniform vec2 px;
    uniform float dt;
    varying vec2 uv;
    void main(){
      float step = 1.0;
      float p0 = texture2D(pressure, uv + vec2(px.x * step, 0)).r;
      float p1 = texture2D(pressure, uv - vec2(px.x * step, 0)).r;
      float p2 = texture2D(pressure, uv + vec2(0, px.y * step)).r;
      float p3 = texture2D(pressure, uv - vec2(0, px.y * step)).r;
      vec2 v = texture2D(velocity, uv).xy;
      vec2 gradP = vec2(p0 - p1, p2 - p3) * 0.5;
      v = v - gradP * dt;
      gl_FragColor = vec4(v, 0.0, 1.0);
    }
  `;

  // vitesse → couleur ; le hero lit 1 - r comme intensité du curseur
  const OUTPUT_FRAG = /* glsl */ `
    precision highp float;
    uniform sampler2D velocity;
    varying vec2 uv;
    void main(){
      vec2 vel = texture2D(velocity, uv).xy;
      float len = length(vel);
      vel = vel * 0.5 + 0.5;
      vec3 color = vec3(vel.x, vel.y, 1.0);
      color = mix(vec3(1.0), color, len);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // =========================================================
  // FLUID — simulation
  // =========================================================
  const fluid = (() => {
    const fboSize = new V2();
    const cellScale = new V2();
    const boundarySpace = new V2();

    function calcSize() {
      const w = Math.round(FLUID.resolution * sizes.width);
      const h = Math.round(FLUID.resolution * sizes.height);
      // cellScale normalisé sur une largeur de référence de 1100 px (comme l'original)
      const k = w / (1100 * FLUID.resolution);
      cellScale.set((1 / w) * k, (1 / h) * k);
      fboSize.set(w, h);
    }
    calcSize();

    const isIOS = /(iPad|iPhone|iPod)/g.test(navigator.userAgent);
    const floatLinear = renderer.capabilities.isWebGL2 && renderer.extensions.has("OES_texture_float_linear");
    const type = !isIOS && floatLinear ? THREE.FloatType : THREE.HalfFloatType;

    const makeFBO = () =>
      new THREE.WebGLRenderTarget(fboSize.x, fboSize.y, {
        type,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

    const fbos = {
      vel_0: makeFBO(),
      vel_1: makeFBO(),
      div: makeFBO(),
      pressure_0: makeFBO(),
      pressure_1: makeFBO(),
    };

    // Pass plein écran générique
    function makePass(vertexShader, fragmentShader, uniforms) {
      const scene = new THREE.Scene();
      const material = new THREE.RawShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false });
      scene.add(new THREE.Mesh(quadGeometry, material));
      return {
        uniforms,
        render(target) {
          renderer.setRenderTarget(target);
          renderer.render(scene, rawCamera);
          renderer.setRenderTarget(null);
        },
      };
    }

    const advection = makePass(FACE_VERT, ADVECTION_FRAG, {
      boundarySpace: { value: cellScale },
      px: { value: cellScale },
      fboSize: { value: fboSize },
      velocity: { value: fbos.vel_0.texture },
      dt: { value: FLUID.dt },
      isBFECC: { value: FLUID.BFECC },
      dissipation: { value: FLUID.dissipation },
    });

    // Force souris : petit quad additif posé sur la vitesse advectée
    const forceScene = new THREE.Scene();
    const forceUniforms = {
      px: { value: cellScale },
      force: { value: new V2() },
      center: { value: new V2() },
      scale: { value: new V2(FLUID.cursor_size, FLUID.cursor_size) },
    };
    forceScene.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.RawShaderMaterial({
          vertexShader: MOUSE_VERT,
          fragmentShader: EXTERNAL_FORCE_FRAG,
          uniforms: forceUniforms,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        })
      )
    );

    const divergence = makePass(FACE_VERT, DIVERGENCE_FRAG, {
      boundarySpace: { value: boundarySpace },
      velocity: { value: fbos.vel_1.texture },
      px: { value: cellScale },
      dt: { value: FLUID.dt },
    });

    const poisson = makePass(FACE_VERT, POISSON_FRAG, {
      boundarySpace: { value: boundarySpace },
      pressure: { value: fbos.pressure_0.texture },
      divergence: { value: fbos.div.texture },
      px: { value: cellScale },
      straightness: { value: FLUID.straightness },
    });

    const pressure = makePass(FACE_VERT, PRESSURE_FRAG, {
      boundarySpace: { value: boundarySpace },
      pressure: { value: fbos.pressure_0.texture },
      velocity: { value: fbos.vel_1.texture },
      px: { value: cellScale },
      dt: { value: FLUID.dt },
    });

    // Sortie "cursor effect" à la taille de l'écran
    const sourceTarget = new THREE.WebGLRenderTarget(sizes.width, sizes.height, { depthBuffer: false, stencilBuffer: false });
    const output = makePass(FACE_VERT, OUTPUT_FRAG, {
      velocity: { value: fbos.vel_0.texture },
      boundarySpace: { value: new V2() },
    });

    function step() {
      boundarySpace.copy(cellScale); // isBounce = false

      // 1. advection
      advection.render(fbos.vel_1);

      // 2. force externe (souris)
      fluidMouse.update();
      const fx = (fluidMouse.diff.x / 2) * FLUID.mouse_force;
      const fy = (fluidMouse.diff.y / 2) * FLUID.mouse_force;
      const cx = FLUID.cursor_size * cellScale.x;
      const cy = FLUID.cursor_size * cellScale.y;
      forceUniforms.force.value.set(fx, fy);
      forceUniforms.center.value.set(
        Math.min(Math.max(fluidMouse.coords.x, -1 + cx + cellScale.x * 2), 1 - cx - cellScale.x * 2),
        Math.min(Math.max(fluidMouse.coords.y, -1 + cy + cellScale.y * 2), 1 - cy - cellScale.y * 2)
      );
      renderer.setRenderTarget(fbos.vel_1);
      renderer.render(forceScene, rawCamera);
      renderer.setRenderTarget(null);

      // 3. divergence
      divergence.uniforms.velocity.value = fbos.vel_1.texture;
      divergence.render(fbos.div);

      // 4. Poisson (ping-pong)
      let out = fbos.pressure_1;
      for (let i = 0; i < FLUID.iterations_poisson; i++) {
        const src = i % 2 === 0 ? fbos.pressure_0 : fbos.pressure_1;
        out = i % 2 === 0 ? fbos.pressure_1 : fbos.pressure_0;
        poisson.uniforms.pressure.value = src.texture;
        poisson.render(out);
      }

      // 5. projection (soustraction du gradient de pression)
      pressure.uniforms.velocity.value = fbos.vel_1.texture;
      pressure.uniforms.pressure.value = out.texture;
      pressure.render(fbos.vel_0);

      // 6. sortie
      output.render(sourceTarget);
    }

    // pas fixe à 60 Hz, quel que soit le taux de rafraîchissement
    const clock = new THREE.Clock();
    let acc = 0;
    function update() {
      acc += clock.getDelta();
      if (acc > FLUID.interval) {
        step();
        acc %= FLUID.interval;
      }
    }

    function resize() {
      calcSize();
      for (const k in fbos) fbos[k].setSize(fboSize.x, fboSize.y);
      sourceTarget.setSize(sizes.width, sizes.height);
    }

    return { update, resize, texture: sourceTarget.texture };
  })();

  // =========================================================
  // COMPOSITION (fond topo + images + masque fluide)
  // =========================================================
  const SIMPLEX = /* glsl */ `
    vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
    vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
    vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
    float snoise(vec3 v){
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ * ns.x + ns.yyyy;
      vec4 y = y_ * ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
  `;

  const compMaterial = new THREE.ShaderMaterial({
    extensions: { derivatives: true },
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${SIMPLEX}
      const float PI = 3.141592;
      varying vec2 vUv;

      uniform vec2 uRes;            // taille canvas (px CSS)
      uniform float uDpr;
      uniform float uTime;
      uniform vec4 uBox;            // boîte de rendu : x, y (bas-gauche), largeur, hauteur (px CSS)
      uniform float uZoom;          // "caméra" : 1 → 1.5
      uniform float uZoomProgress;  // 0 → 1
      uniform float uFilter;        // bichromie : 0 → 1
      uniform float uCursorIntensity;
      uniform float uHelmetHover;   // révélation complète au survol (vague)
      uniform vec2 uMouseCoords;    // -1..1 amorti (0.025)
      uniform float uMousePace;     // pace amorti (0.01) × 4
      uniform vec2 uParallax;       // px

      uniform sampler2D tCursorEffect;
      uniform sampler2D tBase;
      uniform sampler2D tReveal;
      uniform float uBaseAspect;
      uniform float uRevealAspect;
      uniform float uImageHeight;
      uniform vec2 uFacePivot;
      uniform float uFaceTarget;

      uniform float SCALE;
      uniform float SPEED;
      uniform float DISTORT_SCALE;
      uniform float DISTORT_INTENSITY;
      uniform float NOISE_DETAIL;
      uniform float CURSOR_INTENSITY;
      uniform float CURSOR_SCALE;
      uniform float CURSOR_BOUNCE;
      uniform float LINE_WIDTH;

      uniform vec3 COLOR_BACKGROUND;
      uniform vec3 COLOR_OUTLINE;
      uniform vec3 COLOR_CURSOR_BACKGROUND;
      uniform vec3 COLOR_CURSOR_FOREGROUND;
      uniform vec3 COLOR_CURSOR_OUTLINE;
      uniform vec3 COLOR_DUO_DARK;
      uniform vec3 COLOR_DUO_LIGHT;
      uniform vec3 COLOR_GRENAT;

      vec3 toGrayscale(vec3 c) { return vec3(dot(c, vec3(0.299, 0.587, 0.114))); }
      vec3 adjustContrast(vec3 c, float k) { return (c - 0.5) * k + 0.5; }

      // ligne anti-aliasée là où v franchit un entier
      float contour(float v, float width) {
        float f = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4);
        return 1.0 - clamp(f / width, 0.0, 1.0);
      }

      // Position de l'image dans la boîte : ancrée en bas au repos,
      // puis zoom autour du visage qui glisse vers le centre de la boîte.
      vec4 sampleImage(sampler2D tex, float aspect, vec2 local) {
        vec2 box = uBox.zw;
        float h0 = box.y * uImageHeight;
        vec2 size0 = vec2(h0 * aspect, h0);
        vec2 center0 = vec2(box.x * 0.5, h0 * 0.5);
        vec2 face0 = center0 + (uFacePivot - 0.5) * size0;
        vec2 faceEnd = vec2(box.x * 0.5, box.y * uFaceTarget);
        vec2 face = mix(face0, faceEnd, uZoomProgress);

        vec2 size = size0 * uZoom;
        vec2 center = face - (uFacePivot - 0.5) * size + uParallax;
        vec2 iuv = (local - center) / size + 0.5;
        if (iuv.x < 0.0 || iuv.x > 1.0 || iuv.y < 0.0 || iuv.y > 1.0) return vec4(0.0);
        return texture2D(tex, iuv);
      }

      void main() {
        vec2 px = vUv * uRes;
        vec2 local = px - uBox.xy;
        vec2 puv = local / uBox.zw;   // uv du "plan" (comme vUv du renderPlane de l'original)

        if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) {
          gl_FragColor = vec4(0.0);
          return;
        }

        float aspect = uBox.z / uBox.w;
        vec2 uv = puv * vec2(aspect, 1.0);

        /* ---------- Bruit topographique (backgroundNoise de l'original) ---------- */
        vec2 mouse = uMouseCoords * 0.5 + 0.5;
        mouse.x *= aspect;
        float cursor = 1.0 - distance(mouse, uv) * CURSOR_SCALE;
        cursor *= uMousePace;
        cursor = clamp(cursor, CURSOR_BOUNCE, 1.0);

        float noiseDistort = 0.5 + snoise(vec3(uv * DISTORT_SCALE, uTime * SPEED * 0.1)) * 0.5;
        float noiseFinal = 0.5 + snoise(vec3(
          (uv + cursor * CURSOR_INTENSITY + noiseDistort * DISTORT_INTENSITY) * SCALE,
          uTime * SPEED
        )) * 0.5;
        float v = noiseFinal * NOISE_DETAIL;
        float noiseBase = step(0.5, fract(v));            // bandes
        float edge = contour(v * 2.0, LINE_WIDTH * uDpr); // bords des bandes (fract = 0 et 0.5)

        // OUTLINE = true : fond uni + lignes
        vec3 background = mix(COLOR_BACKGROUND, COLOR_OUTLINE, edge);

        // sous le curseur : bandes remplies en deux tons + lignes
        vec3 cursorBackground = mix(COLOR_CURSOR_BACKGROUND, COLOR_CURSOR_FOREGROUND, noiseBase);
        cursorBackground = mix(cursorBackground, COLOR_CURSOR_OUTLINE, edge);

        /* ---------- Curseur fluide ---------- */
        vec4 tc = texture2D(tCursorEffect, vec2(0.025 + puv.x * 0.95, 0.025 + puv.y * 0.95));
        float cv = 1.0 - tc.r;
        float fw = max(fwidth(cv), 1e-4);
        float fluid = smoothstep(-fw, fw, cv - 0.1);                       // step(0.1, …) anti-aliasé
        float fluidRim = 1.0 - clamp(abs(cv - 0.1) / (fw * 1.5), 0.0, 1.0);

        /* ---------- Survol : vague de bas en haut ---------- */
        float hoverTransition = puv.y + sin(puv.x * PI) * sin(uHelmetHover * PI) * 0.2;
        float hd = hoverTransition - (1.0 - uHelmetHover);
        float fwh = max(fwidth(hd), 1e-4);
        float hoverActive = step(0.0005, uHelmetHover);
        float hover = smoothstep(-fwh, fwh, hd) * hoverActive;
        float hoverRim = (1.0 - clamp(abs(hd) / (fwh * 1.5), 0.0, 1.0)) * hoverActive * step(uHelmetHover, 0.9995);

        float cursorEffect = clamp((fluid + hover) * uCursorIntensity, 0.0, 1.0);
        float rim = max(fluidRim * (1.0 - hover), hoverRim) * uCursorIntensity;

        background = mix(background, cursorBackground, cursorEffect);

        /* ---------- Images ---------- */
        vec4 imgBase = sampleImage(tBase, uBaseAspect, local);
        vec4 imgReveal = sampleImage(tReveal, uRevealAspect, local);

        // le visage actuel passe en version "ombrée" sous le curseur (shadow diffuse de l'original)
        vec3 baseShadow = mix(imgBase.rgb * 0.42, COLOR_CURSOR_BACKGROUND, 0.25);
        vec3 baseColor = mix(imgBase.rgb, baseShadow, cursorEffect);
        vec3 base = mix(background, baseColor, imgBase.a);

        vec3 final = mix(base, imgReveal.rgb, cursorEffect * imgReveal.a);
        final = mix(final, COLOR_GRENAT, rim * 0.85);

        /* ---------- Transition : bichromie bleu marine ---------- */
        vec3 end = mix(imgBase.rgb, vec3(0.05), 1.0 - imgBase.a);
        end = toGrayscale(end);
        end = adjustContrast(end, 0.8);
        end *= 0.75;
        vec3 duo = mix(COLOR_DUO_DARK, COLOR_DUO_LIGHT, smoothstep(0.08, 0.62, end.r));

        gl_FragColor = vec4(mix(final, duo, uFilter), 1.0);
      }
    `,
    uniforms: {
      uRes: { value: new V2(1, 1) },
      uDpr: { value: sizes.pixelRatio },
      uTime: { value: 0 },
      uBox: { value: new THREE.Vector4(0, 0, 1, 1) },
      uZoom: { value: 1 },
      uZoomProgress: { value: 0 },
      uFilter: { value: 0 },
      uCursorIntensity: { value: 1 },
      uHelmetHover: { value: 0 },
      uMouseCoords: { value: new V2() },
      uMousePace: { value: 0 },
      uParallax: { value: new V2() },
      tCursorEffect: { value: fluid.texture },
      tBase: { value: null },
      tReveal: { value: null },
      uBaseAspect: { value: 0.75 },
      uRevealAspect: { value: 0.75 },
      uImageHeight: { value: LAYOUT.imageHeight },
      uFacePivot: { value: new V2(...LAYOUT.facePivot) },
      uFaceTarget: { value: LAYOUT.faceTarget },
      SCALE: { value: BG.SCALE },
      SPEED: { value: BG.SPEED },
      DISTORT_SCALE: { value: BG.DISTORT_SCALE },
      DISTORT_INTENSITY: { value: BG.DISTORT_INTENSITY },
      NOISE_DETAIL: { value: BG.NOISE_DETAIL },
      CURSOR_INTENSITY: { value: BG.CURSOR_INTENSITY },
      CURSOR_SCALE: { value: BG.CURSOR_SCALE },
      CURSOR_BOUNCE: { value: BG.CURSOR_BOUNCE },
      LINE_WIDTH: { value: BG.LINE_WIDTH },
      COLOR_BACKGROUND: { value: new THREE.Color(SHADER_COLORS.BACKGROUND) },
      COLOR_OUTLINE: { value: new THREE.Color(SHADER_COLORS.OUTLINE) },
      COLOR_CURSOR_BACKGROUND: { value: new THREE.Color(SHADER_COLORS.CURSOR_BACKGROUND) },
      COLOR_CURSOR_FOREGROUND: { value: new THREE.Color(SHADER_COLORS.CURSOR_FOREGROUND) },
      COLOR_CURSOR_OUTLINE: { value: new THREE.Color(SHADER_COLORS.CURSOR_OUTLINE) },
      COLOR_DUO_DARK: { value: new THREE.Color(SHADER_COLORS.DUO_DARK) },
      COLOR_DUO_LIGHT: { value: new THREE.Color(SHADER_COLORS.DUO_LIGHT) },
      COLOR_GRENAT: { value: new THREE.Color(COLORS.grenat) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const compScene = new THREE.Scene();
  compScene.add(new THREE.Mesh(quadGeometry, compMaterial));

  // =========================================================
  // Images (fichiers réels ou placeholders générés)
  // =========================================================
  function makePlaceholder(variant) {
    const W = 900, H = 1100;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const isYoung = variant === "reveal";
    ctx.beginPath();
    ctx.ellipse(W / 2, H + 120, W * 0.46, 430, 0, Math.PI, 0);
    ctx.rect(W / 2 - 85, 520, 170, 320);
    ctx.ellipse(W / 2, 400, isYoung ? 190 : 170, isYoung ? 235 : 215, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = isYoung ? COLORS.barca : COLORS.navy;
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return { tex, aspect: W / H };
  }

  function loadImage(url, variant) {
    if (location.protocol === "file:") {
      console.warn(`[hero] file:// détecté → placeholder pour ${url}. Lance un serveur local.`);
      return Promise.resolve(makePlaceholder(variant));
    }
    return new Promise((resolve) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.minFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          resolve({ tex, aspect: tex.image.width / tex.image.height });
        },
        undefined,
        () => {
          console.info(`[hero] ${url} introuvable → placeholder`);
          resolve(makePlaceholder(variant));
        }
      );
    });
  }

  // =========================================================
  // État du "plan" (renderPlane de l'original), piloté par GSAP
  // =========================================================
  const track = document.querySelector("[data-hero-track]");
  const boxEl = document.querySelector("[data-hero-box]");
  const view = { w: 1, h: 1 };

  const plane = { width: 1, height: 1, zoom: 1, filter: 0, cursorIntensity: 1, progress: 0 };
  const hover = { value: 0, reveal: 1 }; // uHelmetHover + helmetRevealValue

  // =========================================================
  // Resize
  // =========================================================
  function resize() {
    sizes.width = window.innerWidth;
    sizes.height = window.innerHeight;
    sizes.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    view.w = container.clientWidth;
    view.h = container.clientHeight;
    renderer.setPixelRatio(sizes.pixelRatio);
    renderer.setSize(view.w, view.h, false);
    compMaterial.uniforms.uRes.value.set(view.w, view.h);
    compMaterial.uniforms.uDpr.value = sizes.pixelRatio;
    fluid.resize();
  }
  window.addEventListener("resize", resize);
  resize();
  plane.width = view.w;
  plane.height = view.h;

  // =========================================================
  // Scroll : rétrécissement, zoom, bichromie, extinction du curseur
  // =========================================================
  function setupScroll() {
    const scrub = () => ({
      trigger: track,
      start: "top top",
      end: () => `+=${view.h}`,
      scrub: true,
      invalidateOnRefresh: true,
    });

    // bounds : plein écran → boîte (target.offsetWidth / offsetHeight)
    gsap.fromTo(
      plane,
      { width: () => view.w, height: () => view.h },
      {
        width: () => boxEl.offsetWidth,
        height: () => boxEl.offsetHeight,
        ease: "power1.inOut",
        scrollTrigger: { ...scrub(), onUpdate: (self) => (plane.progress = self.progress) },
      }
    );
    // caméra z 0 → -1 (≈ zoom ×1.5)
    gsap.fromTo(plane, { zoom: 1 }, { zoom: 1.5, ease: "power1.inOut", scrollTrigger: scrub() });
    // uFilter 0 → 1
    gsap.fromTo(plane, { filter: 0 }, { filter: 1, ease: "power1.inOut", scrollTrigger: scrub() });
    // uCursorIntensity 1 → 0 à 1/2.25 d'écran
    gsap.fromTo(
      plane,
      { cursorIntensity: 1 },
      {
        cursorIntensity: 0,
        duration: 0.25,
        ease: "power1.inOut",
        scrollTrigger: {
          trigger: track,
          start: () => `top+=${view.h / 2.25} top`,
          end: () => `top+=${view.h / 2.25} top`,
          toggleActions: "play none none reverse",
          invalidateOnRefresh: true,
        },
      }
    );

    // carte "Prochain match" : se referme dès le 1er pixel de scroll
    const card = document.querySelector("[data-match-card]");
    if (card) {
      ScrollTrigger.create({
        trigger: document.body,
        start: "1px top",
        onEnter: () => card.classList.add("is-hidden"),
        onLeaveBack: () => card.classList.remove("is-hidden"),
      });
    }

    // rendu WebGL seulement autour de la piste
    ScrollTrigger.create({
      trigger: track,
      start: () => `top-=${view.h / 2} bottom`,
      end: () => `bottom+=${view.h / 2} top`,
      invalidateOnRefresh: true,
      onToggle: (self) => (isRendering = self.isActive),
    });
  }

  // =========================================================
  // Textes : split en caractères
  // =========================================================
  function splitChars(el) {
    const text = el.textContent;
    el.textContent = "";
    for (const ch of text) {
      const span = document.createElement("span");
      span.className = "char";
      span.textContent = ch === " " ? " " : ch;
      el.appendChild(span);
    }
    return el.querySelectorAll(".char");
  }
  document.querySelectorAll('[data-split="chars"]').forEach(splitChars);

  // "Message de Leo" + logo : montée des lettres scrubée (fin de piste)
  function setupMessage() {
    const tracker = document.querySelector("[data-hero-eyebrow-tracker]");
    const chars = document.querySelectorAll('[data-hero-anim="msg"] .char');
    const imgs = document.querySelectorAll('[data-hero-anim="img"]');
    if (!tracker || !chars.length) return;
    const U = 0.8;
    gsap.set(chars, { y: "100%" });
    gsap.set(imgs, { autoAlpha: 0, y: "1rem" });
    gsap
      .timeline({ scrollTrigger: { trigger: tracker, start: "top bottom", end: "bottom bottom", scrub: true } })
      .to(chars, { y: "0", duration: U, stagger: 0.02, ease: "power3.out" })
      .to(imgs, { autoAlpha: 1, y: 0, duration: U, ease: "power3.out" }, "<0.3");
  }

  // Tracé tactique : dessiné au scroll (remplace la signature Rive)
  function setupDraw() {
    const tracker = document.querySelector("[data-hero-draw-tracker]");
    const paths = document.querySelectorAll("[data-hero-draw] path, [data-hero-draw] circle");
    if (!tracker || !paths.length) return;
    paths.forEach((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len} ${len}`;
      p.style.strokeDashoffset = len;
    });
    gsap.to(paths, {
      strokeDashoffset: 0,
      ease: "none",
      stagger: 0.12,
      scrollTrigger: { trigger: tracker, start: "top center", end: "bottom 80%", scrub: true },
    });
  }

  // =========================================================
  // "High-line reveal" : chaque ligne s'ouvre + bloc de couleur qui se retire
  // =========================================================
  const highLines = [];
  function setupHighLines() {
    const Q = 0.6, B = 0.6, E = 0.15;
    // uniquement le hero : les sections ont leur propre gestion (sections.js)
    document.querySelectorAll("[data-hero] [data-anim-high]").forEach((el) => {
      const lines = el.querySelectorAll(".line");
      const tl = gsap.timeline({ paused: true });
      lines.forEach((line, i) => {
        line.style.position = "relative";
        gsap.set(line, { clipPath: "inset(0 100% 0 0)", autoAlpha: 1 });
        const block = document.createElement("div");
        block.className = "high-line-reveal";
        Object.assign(block.style, {
          position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
          backgroundColor: "var(--barca)", transformOrigin: "right center", zIndex: "5",
        });
        line.appendChild(block);
        gsap.set(block, { scaleX: 1 });
        const at = i * E;
        tl.to(line, { clipPath: "inset(0 0% 0 0)", duration: Q, ease: "power2.out" }, at);
        tl.to(block, { scaleX: 0, duration: B, ease: "power2.inOut" }, at + Q / 2);
      });
      if (el.closest("[data-hero-animation-container]")) {
        highLines.push(tl); // joué par l'intro
      } else {
        ScrollTrigger.create({ trigger: el, start: "top 90%", once: true, onEnter: () => tl.play() });
      }
    });
  }

  // Mini-terrain de la carte : tracé à l'intro (remplace le circuit Rive)
  function drawPitch() {
    const shapes = document.querySelectorAll("[data-pitch] rect, [data-pitch] path, [data-pitch] circle:not(.match-pitch-ball)");
    shapes.forEach((s) => {
      const len = s.getTotalLength();
      gsap.fromTo(s, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.4, ease: "power2.inOut", delay: 0.2 });
    });
    gsap.fromTo(".match-pitch-ball", { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.6, delay: 1.2, ease: "back.out(2)" });
  }

  // =========================================================
  // Survol de la ligne "FC Barcelone" : révélation complète en vague
  // =========================================================
  function setupHelmetHover() {
    document.querySelectorAll('[data-gl-helmet="hover"]').forEach((el) => {
      el.addEventListener("mouseenter", () => {
        gsap.to(hover, { value: 1, duration: 1.5, ease: "expo.inOut", overwrite: "auto" });
        gsap.to(hover, { reveal: 0, duration: 1.5, ease: "power1.inOut", overwrite: "auto" });
      });
      el.addEventListener("mouseleave", () => {
        gsap.to(hover, { value: 0, duration: 1, ease: "expo.inOut", overwrite: "auto" });
        gsap.to(hover, { reveal: 1, duration: 1, ease: "power1.inOut", overwrite: "auto" });
      });
    });
  }

  // =========================================================
  // Bandeaux : défilement continu + accélération avec la vitesse du scroll
  // =========================================================
  const marquees = [...document.querySelectorAll("[data-marquee]")].map((row) => {
    const span = row.querySelector("span");
    row.appendChild(span.cloneNode(true)); // 2 copies pour boucler sans couture
    return { row, dir: row.dataset.marquee === "left" ? -1 : 1, x: 0, width: 0 };
  });
  function measureMarquees() {
    marquees.forEach((m) => {
      m.width = m.row.scrollWidth / 2;
      if (m.dir > 0) m.x = -m.width;
    });
  }
  function updateMarquees() {
    // 1 unité de l'original ≈ hauteur écran / 6.9 (caméra fov 75 à z = 4.5)
    const unit = view.h / 6.9;
    const v = Math.abs(lenis.velocity || 0);
    const step = (time.delta * 0.01 + v * 0.001) * unit;
    marquees.forEach((m) => {
      m.x += step * m.dir;
      if (m.dir < 0 && m.x < -m.width) m.x += m.width;
      if (m.dir > 0 && m.x > 0) m.x -= m.width;
      m.row.style.transform = `translate3d(${m.x}px,0,0)`;
    });
  }
  window.addEventListener("resize", measureMarquees);

  // =========================================================
  // Boucle
  // =========================================================
  let isRendering = true;
  const easedMouse = {
    normalized: mouse.createEasedNormalized(EASE.normalized),
    pace: mouse.createEasedPace(EASE.pace),
  };

  function tick() {
    time.tick();

    idle.update();
    fluid.update();
    easedMouse.normalized.update(time.delta);
    easedMouse.pace.update(time.delta);
    updateMarquees();

    if (isRendering) {
      const u = compMaterial.uniforms;
      u.uTime.value = time.elapsed;
      u.uBox.value.set((view.w - plane.width) / 2, (view.h - plane.height) / 2, plane.width, plane.height);
      u.uZoom.value = plane.zoom;
      u.uZoomProgress.value = (plane.zoom - 1) / 0.5;
      u.uFilter.value = plane.filter;
      u.uCursorIntensity.value = plane.cursorIntensity;
      u.uHelmetHover.value = hover.value;
      u.uMouseCoords.value.copy(easedMouse.normalized.value);
      u.uMousePace.value = easedMouse.pace.value.default * 4;
      // parallaxe (caméra qui suit la souris), coupée au survol et pendant le scroll
      u.uParallax.value.set(
        easedMouse.normalized.value.x * -LAYOUT.parallax * hover.reveal,
        easedMouse.normalized.value.y * -LAYOUT.parallax * 0.5 * hover.reveal * (1 - plane.progress)
      );
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(compScene, rawCamera);
    }

    mouse.update();
    requestAnimationFrame(tick);
  }

  // =========================================================
  // Init
  // =========================================================
  setupHighLines();
  setupMessage();
  setupDraw();
  setupHelmetHover();
  setupScroll();

  Promise.all([
    loadImage(IMAGES.base, "base"),
    loadImage(IMAGES.reveal, "reveal"),
    document.fonts ? document.fonts.ready : Promise.resolve(),
  ]).then(([base, reveal]) => {
    const u = compMaterial.uniforms;
    u.tBase.value = base.tex;
    u.uBaseAspect.value = base.aspect;
    u.tReveal.value = reveal.tex;
    u.uRevealAspect.value = reveal.aspect;

    measureMarquees();
    ScrollTrigger.refresh();

    // le rendu démarre tout de suite (derrière le preloader) : aucune saccade à l'entrée
    gsap.set(container, { opacity: 0 });
    tick();

    // Entrée du hero : le visuel se dézoome en fondu, puis carte + textes
    // (≈ k0() de l'original). Déclenchée quand le rideau du preloader monte.
    const intro = () => {
      gsap.fromTo(
        container,
        { opacity: 0, scale: 1.08 },
        { opacity: 1, scale: 1, duration: 1.6, ease: "expo.out", clearProps: "transform" }
      );
      gsap.delayedCall(0.45, () => {
        if (window.scrollY < 2) document.querySelector("[data-match-card]")?.classList.remove("is-hidden");
        highLines.forEach((tl) => tl.play());
        drawPitch();
      });
    };

    if (window.Preloader) {
      window.Preloader.setLoaded();
      window.Preloader.onExit(intro);
    } else {
      intro();
    }
  });
})();
