/* =========================================================
   FOND GLOBAL (≈ scène "background" de l'original)
   Canvas fixe derrière toutes les sections : même bruit topographique
   que le hero, en bleu marine, qui réagit à la souris.
   Les couleurs changent au scroll via :
     data-gl-change-track
     data-gl-change-from="#bg, #lignes"  data-gl-change-to="#bg, #lignes"
     data-gl-change-trigger-start / -end (défaut : "top top" / "bottom bottom")
     data-gl-change-cursor : le curseur fluide (bandes marine, comme le hero)
     apparaît avec ce changement (utilisé par la fin de page)
   ========================================================= */
(() => {
  const container = document.querySelector('[data-gl="background"]');
  if (!container || !window.THREE || !window.gsap) return;

  const COLORS = {
    background: "#0B1F3A", // bleu marine
    foreground: "#1B3A66", // lignes topographiques (discrètes)
    // curseur fluide : bandes bleu pâle (le texte marine reste lisible dessus),
    // contours bleu Barça
    cursorBackground: "#D9E0EA",
    cursorForeground: "#C5D1E1",
    cursorOutline: "#004D98",
  };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // mêmes réglages que le bruit du hero (headScene de l'original)
  const P = {
    SCALE: 1, SPEED: 0.1, DISTORT_SCALE: 1, DISTORT_INTENSITY: 0.5, NOISE_DETAIL: 3,
    CURSOR_INTENSITY: 0.15, CURSOR_SCALE: 3, CURSOR_BOUNCE: -0.75, LINE_WIDTH: 1,
  };

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

  // ---------- Renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
  container.appendChild(renderer.domElement);
  const camera = new THREE.Camera();
  const state = {
    bg: COLORS.background,
    fg: COLORS.foreground,
  };

  const material = new THREE.ShaderMaterial({
    extensions: { derivatives: true },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${SIMPLEX}
      varying vec2 vUv;
      uniform vec2 uRes;
      uniform float uDpr;
      uniform float uTime;
      uniform vec2 uMouseCoords;
      uniform float uMousePace;
      uniform float SCALE, SPEED, DISTORT_SCALE, DISTORT_INTENSITY, NOISE_DETAIL;
      uniform float CURSOR_INTENSITY, CURSOR_SCALE, CURSOR_BOUNCE, LINE_WIDTH;
      uniform vec3 COLOR_BACKGROUND;
      uniform vec3 COLOR_FOREGROUND;
      uniform sampler2D tTrail;
      uniform float uReveal;
      uniform vec3 COLOR_CURSOR_BACKGROUND, COLOR_CURSOR_FOREGROUND, COLOR_CURSOR_OUTLINE;

      float contour(float v, float width) {
        float f = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4);
        return 1.0 - clamp(f / width, 0.0, 1.0);
      }

      void main() {
        float aspect = uRes.x / uRes.y;
        vec2 uv = vUv * vec2(aspect, 1.0);

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
        float level = noiseFinal * NOISE_DETAIL * 2.0;
        float edge = contour(level, LINE_WIDTH * uDpr);
        vec3 color = mix(COLOR_BACKGROUND, COLOR_FOREGROUND, edge);

        // curseur fluide : la traînée de la souris révèle des bandes bleutées
        // (une sur deux), contours bleu Barça, bord ondulé par le bruit
        if (uReveal > 0.001) {
          float t = texture2D(tTrail, vUv + (noiseDistort - 0.5) * 0.05).r;
          float tw = max(fwidth(t), 1e-4);
          float mask = smoothstep(0.3 - tw, 0.3 + tw, t) * uReveal;
          float rim = (1.0 - clamp(abs(t - 0.3) / (tw * 1.5), 0.0, 1.0)) * uReveal;
          float band = mod(floor(level), 2.0);
          vec3 inside = mix(mix(COLOR_CURSOR_BACKGROUND, COLOR_CURSOR_FOREGROUND, band), COLOR_CURSOR_OUTLINE, edge);
          color = mix(color, inside, mask);
          color = mix(color, COLOR_CURSOR_OUTLINE, rim * 0.85);
        }

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: 1 },
      uTime: { value: 0 },
      uMouseCoords: { value: new THREE.Vector2() },
      uMousePace: { value: 0 },
      SCALE: { value: P.SCALE },
      SPEED: { value: P.SPEED },
      DISTORT_SCALE: { value: P.DISTORT_SCALE },
      DISTORT_INTENSITY: { value: P.DISTORT_INTENSITY },
      NOISE_DETAIL: { value: P.NOISE_DETAIL },
      CURSOR_INTENSITY: { value: P.CURSOR_INTENSITY },
      CURSOR_SCALE: { value: P.CURSOR_SCALE },
      CURSOR_BOUNCE: { value: P.CURSOR_BOUNCE },
      LINE_WIDTH: { value: P.LINE_WIDTH },
      COLOR_BACKGROUND: { value: new THREE.Color(state.bg) },
      COLOR_FOREGROUND: { value: new THREE.Color(state.fg) },
      tTrail: { value: null },
      uReveal: { value: 0 },
      COLOR_CURSOR_BACKGROUND: { value: new THREE.Color(COLORS.cursorBackground) },
      COLOR_CURSOR_FOREGROUND: { value: new THREE.Color(COLORS.cursorForeground) },
      COLOR_CURSOR_OUTLINE: { value: new THREE.Color(COLORS.cursorOutline) },
    },
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // ---------- Traînée du curseur fluide (petit canvas 2D, 1/8 de l'écran) ----------
  const trail = document.createElement("canvas");
  const tctx = trail.getContext("2d");
  const trailTex = new THREE.CanvasTexture(trail);
  trailTex.minFilter = trailTex.magFilter = THREE.LinearFilter;
  material.uniforms.tTrail.value = trailTex;
  const sizeTrail = () => {
    trail.width = Math.max(32, Math.ceil(window.innerWidth / 8));
    trail.height = Math.max(32, Math.ceil(window.innerHeight / 8));
    tctx.fillStyle = "#000";
    tctx.fillRect(0, 0, trail.width, trail.height);
  };
  sizeTrail();
  window.addEventListener("resize", sizeTrail);
  const brush = { x: null, y: null };
  function paintTrail() {
    const w = trail.width, h = trail.height;
    tctx.globalCompositeOperation = "source-over";
    tctx.fillStyle = "rgba(0, 0, 0, 0.05)"; // la traînée s'efface doucement
    tctx.fillRect(0, 0, w, h);
    const x = (mouse.cur.x * 0.5 + 0.5) * w;
    const y = (0.5 - mouse.cur.y * 0.5) * h;
    if (brush.x === null) { brush.x = x; brush.y = y; }
    const dx = x - brush.x, dy = y - brush.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.1) return;
    const r = Math.min(w, h) * (0.06 + Math.min(dist / w, 0.08));
    tctx.globalCompositeOperation = "lighter";
    const steps = Math.ceil(dist / (r * 0.35));
    for (let i = 1; i <= steps; i++) {
      const px = brush.x + (dx * i) / steps, py = brush.y + (dy * i) / steps;
      const g = tctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, "rgba(255, 255, 255, 0.35)");
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      tctx.fillStyle = g;
      tctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
    brush.x = x; brush.y = y;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    material.uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
    material.uniforms.uDpr.value = dpr;
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Souris (mêmes amortis que l'original : 0.025 / 0.01) ----------
  const damp = (x, y, l, dt) => x + (y - x) * (1 - Math.exp(-l * dt));
  const mouse = { cur: new THREE.Vector2(), prev: new THREE.Vector2(), eased: new THREE.Vector2(), pace: 0, easedPace: 0 };
  const setMouse = (x, y) => mouse.cur.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  document.addEventListener("mousemove", (e) => setMouse(e.clientX, e.clientY), { passive: true });
  document.addEventListener("touchmove", (e) => e.touches[0] && setMouse(e.touches[0].clientX, e.touches[0].clientY), { passive: true });

  // ---------- Changement de couleurs au scroll ----------
  const toPair = (attr) => {
    if (!attr) return [null, null];
    const [a, b] = attr.split(",").map((s) => s.trim());
    return [a, b || a];
  };
  document.querySelectorAll("[data-gl-change-track]").forEach((el) => {
    const [bgFrom, fgFrom] = toPair(el.getAttribute("data-gl-change-from"));
    const [bgTo, fgTo] = toPair(el.getAttribute("data-gl-change-to"));
    if (!bgFrom || !bgTo) return;
    const p = { progress: 0 };
    const cursor = el.hasAttribute("data-gl-change-cursor") && !reduce;
    gsap.fromTo(p, { progress: 0 }, {
      progress: 1,
      ease: "none",
      immediateRender: false,
      scrollTrigger: {
        trigger: el,
        start: el.getAttribute("data-gl-change-trigger-start") || "top top",
        end: el.getAttribute("data-gl-change-trigger-end") || "bottom bottom",
        scrub: true,
        refreshPriority: -1, // après les épinglages créés plus tard (clubs, Ballons d'Or)
        invalidateOnRefresh: true,
        onUpdate: () => {
          state.bg = gsap.utils.interpolate(bgFrom, bgTo, p.progress);
          state.fg = gsap.utils.interpolate(fgFrom, fgTo, p.progress);
          material.uniforms.COLOR_BACKGROUND.value.set(state.bg);
          material.uniforms.COLOR_FOREGROUND.value.set(state.fg);
          if (cursor) material.uniforms.uReveal.value = p.progress;
        },
      },
    });
  });

  // ---------- Rendu (seulement quand le fond est visible) ----------
  const heroTrack = document.querySelector("[data-hero-track]");
  const clock = new THREE.Clock();

  gsap.ticker.add(() => {
    const delta = Math.min(clock.getDelta(), 1 / 30) * 100;

    // le fond est caché par le hero tant que celui-ci est collé à l'écran
    // (ou par une section opaque épinglée, ex. les clubs : html[data-gl-covered])
    const hidden =
      (heroTrack && window.scrollY < heroTrack.offsetHeight - window.innerHeight * 1.05) ||
      document.documentElement.hasAttribute("data-gl-covered");

    mouse.pace = mouse.cur.distanceTo(mouse.prev);
    mouse.prev.copy(mouse.cur);
    mouse.eased.x = damp(mouse.eased.x, mouse.cur.x, 0.025, delta);
    mouse.eased.y = damp(mouse.eased.y, mouse.cur.y, 0.025, delta);
    mouse.easedPace = damp(mouse.easedPace, mouse.pace, 0.01, delta);

    if (hidden) return;
    const u = material.uniforms;
    if (u.uReveal.value > 0.001) {
      paintTrail();
      trailTex.needsUpdate = true;
    } else brush.x = null;
    u.uTime.value = clock.elapsedTime;
    u.uMouseCoords.value.copy(mouse.eased);
    u.uMousePace.value = mouse.easedPace * 4;
    renderer.render(scene, camera);
  });
})();
