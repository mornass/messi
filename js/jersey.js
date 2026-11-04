/* =========================================================
   JERSEY STAGE — maillot en relief (Three.js), un seul canvas fixe
   Même rôle que le lecteur de l'original (canvas global, centré, DPR ≤ 2,
   vitesse boostée par la molette : deltaY × 6, max 500, ÷3, ×0.9 / 16 ms),
   mais à partir d'images de FACE uniquement :

   - mode "image" (une image de face) : plan bombé + plis de tissu animés,
     éclairage (diffus + reflet satiné + liseré), léger balancement,
     inclinaison qui suit la souris, ombre douce au sol.
   - mode "frames" (PSG : séquence de rotation) : on ne lit que les images
     autour de la face, en balancement gauche ↔ droite (fondu entre deux
     images voisines), sans jamais atteindre le dos.

   API (utilisée par js/clubs.js) :
     JerseyPlayer.get(container) → player
     player.canvas · player.load(id, spec) · player.setSection(id)
     player.start() · player.stop() · player.clear()
   ========================================================= */
window.JerseyPlayer = (() => {
  if (!window.THREE) return { get: () => null };

  const CFG = {
    size: 0.65,              // hauteur du maillot / hauteur de l'écran (original : 0.65)
    sizeMobile: 0.8,
    fov: 30,
    wheelFactor: 6, maxVelocity: 500, decay: 0.9, baseSpeed: 30, // ← original
    swing: { amp: 0.2, speed: 0.85 },         // mode image : ±11.5°, rad/s de phase
    tilt: { yaw: 0.17, pitch: 0.11, lambda: 3.5 },
    bob: { amp: 0.012, speed: 1.3 },
    curve: 0.15,             // bombé du torse (unités monde, hauteur maillot = 1)
    wave: 0.007,             // plis de tissu
    sheen: 1,
    frames: { ampDeg: 40, speed: 0.75, frameScale: 1 },
  };

  const isMobile = () => window.innerWidth <= 991;
  const isLowEnd = !!(navigator.deviceMemory && navigator.deviceMemory < 4);
  const damp = (x, y, lambda, dt) => x + (y - x) * (1 - Math.exp(-lambda * dt));

  /* ---------------- shaders ---------------- */
  const VERT = /* glsl */ `
    uniform float uCurve, uWave, uTime, uHalfW, uHalfH;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPos;

    float height(vec2 p) {
      vec2 n = vec2(p.x / uHalfW, p.y / uHalfH);           // -1..1
      float body = -uCurve * n.x * n.x * (0.75 + 0.25 * (1.0 - n.y) * 0.5);
      float folds = uWave * sin(n.y * 5.0 + uTime * 1.3 + n.x * 1.7) * (0.55 + 0.45 * (1.0 - n.y) * 0.5)
                  + uWave * 0.6 * sin(n.x * 7.0 - uTime * 0.9 + n.y * 2.0);
      return body + folds;
    }

    void main() {
      vUv = uv;
      vec3 p = position;
      p.z = height(p.xy);
      float e = 0.01;
      float dx = (height(p.xy + vec2(e, 0.0)) - height(p.xy - vec2(e, 0.0))) / (2.0 * e);
      float dy = (height(p.xy + vec2(0.0, e)) - height(p.xy - vec2(0.0, e))) / (2.0 * e);
      vNormal = normalize(normalMatrix * normalize(vec3(-dx, -dy, 1.0)));
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vViewPos = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `;

  const FRAG = /* glsl */ `
    uniform sampler2D tMap;
    uniform sampler2D tNext;
    uniform float uMix, uSheen;
    uniform vec3 uLight;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPos;

    void main() {
      vec4 tex = mix(texture2D(tMap, vUv), texture2D(tNext, vUv), uMix);   // prémultiplié
      if (tex.a < 0.004) discard;
      vec3 N = normalize(vNormal);
      if (!gl_FrontFacing) N = -N;
      vec3 V = normalize(-vViewPos);
      vec3 L = normalize(uLight);
      float ndl = dot(N, L);
      float diffuse = 0.84 + 0.2 * max(ndl, 0.0) - 0.1 * max(-ndl, 0.0);
      vec3 H = normalize(L + V);
      float nh = max(dot(N, H), 0.0);
      float satin = pow(nh, 24.0) * 0.15;                 // reflet large (tissu satiné)
      float glint = pow(nh, 110.0) * 0.14;                // reflet serré
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.3;
      vec3 col = tex.rgb * diffuse
               + (satin + glint) * uSheen * tex.a * vec3(1.0, 0.98, 0.95)
               + rim * uSheen * tex.a * vec3(0.72, 0.8, 1.0);
      gl_FragColor = vec4(col, tex.a);
    }
  `;

  const SHADOW_FRAG = /* glsl */ `
    uniform float uOpacity;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float d = dot(p, p);
      float a = (exp(-d * 5.5) * 0.7 + exp(-d * 2.0) * 0.3) * uOpacity;
      gl_FragColor = vec4(vec3(0.02, 0.015, 0.02) * a, a);   // prémultiplié (noir neutre : va sur toutes les palettes)
    }
  `;
  const SHADOW_VERT = /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `;

  /* ---------------- chargement ---------------- */
  // contour opaque de l'image (pour cadrer le maillot quelles que soient les marges)
  function alphaBox(source) {
    const w = 160;
    const h = Math.max(1, Math.round((w * (source.height || 1)) / (source.width || 1)));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.drawImage(source, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (d[(y * w + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < x0) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function loadImageSource(spec, renderer) {
    let img;
    try {
      img = await loadImage(spec.src);
    } catch (e) {
      console.warn("[jersey] image introuvable :", spec.src);
      return null;
    }
    const tex = new THREE.Texture(img);
    tex.premultiplyAlpha = true;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    renderer.initTexture(tex);
    return {
      mode: "image",
      aspect: img.width / img.height,
      box: alphaBox(img),
      textures: [tex],
      dispose() { tex.dispose(); },
    };
  }

  // PSG : seulement les images autour de la face (front ± marge), jamais le dos
  async function loadFramesSource(spec, renderer) {
    const total = spec.end - spec.start + 1;
    const degPerFrame = 360 / total;
    const reach = Math.ceil(CFG.frames.ampDeg / degPerFrame) + 1;
    const offsets = [];
    for (let k = -reach; k <= reach; k++) offsets.push(k);
    const texSize = window.devicePixelRatio > 1.25 && !isLowEnd ? 1024 : 768;
    const pad = spec.pad || 4;
    const wrap = (i) => spec.start + ((((i - spec.start) % total) + total) % total);

    const textures = new Map();
    let first = null;
    await Promise.all(
      offsets.map(async (k) => {
        const n = wrap(spec.front + k);
        try {
          const blob = await (await fetch(`${spec.dir}/${String(n).padStart(pad, "0")}.${spec.ext || "webp"}`)).blob();
          const bmp = await createImageBitmap(blob, {
            premultiplyAlpha: "premultiply",
            imageOrientation: "flipY",
            resizeWidth: texSize,
            resizeHeight: texSize,
            resizeQuality: "high",
          });
          const tex = new THREE.Texture(bmp);
          tex.flipY = false;
          tex.premultiplyAlpha = false;
          tex.needsUpdate = true;
          renderer.initTexture(tex);
          textures.set(k, tex);
          if (k === 0) first = bmp;
        } catch (e) { /* image manquante */ }
      })
    );
    if (!textures.has(0)) return null;
    // contour mesuré sur l'image de face (l'ImageBitmap est retournée : on corrige y)
    const box = alphaBox(first);
    box.y = 1 - box.y - box.h;
    return {
      mode: "frames",
      aspect: 1,
      box,
      degPerFrame,
      reach,
      get(k) {
        const kk = Math.max(-reach, Math.min(reach, k));
        return textures.get(kk) || textures.get(0);
      },
      dispose() { textures.forEach((t) => { t.image && t.image.close && t.image.close(); t.dispose(); }); },
    };
  }

  /* ---------------- scène ---------------- */
  class Stage {
    constructor(container) {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
      this.renderer.setClearColor(0x000000, 0);
      this.canvas = this.renderer.domElement;
      this.canvas.className = "jersey-canvas";
      this.canvas.setAttribute("aria-hidden", "true");
      (container || document.body).appendChild(this.canvas);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(CFG.fov, 1, 0.1, 50);

      // racine → balancement (yaw) → [inclinaison (pitch) → maillot] + ombre
      this.root = new THREE.Group();
      this.swing = new THREE.Group();
      this.tilt = new THREE.Group();
      this.root.add(this.swing);
      this.swing.add(this.tilt);
      this.scene.add(this.root);

      this.uniforms = {
        tMap: { value: null },
        tNext: { value: null },
        uMix: { value: 0 },
        uSheen: { value: CFG.sheen },
        uLight: { value: new THREE.Vector3(0.4, 0.6, 1) },
        uCurve: { value: CFG.curve },
        uWave: { value: CFG.wave },
        uTime: { value: 0 },
        uHalfW: { value: 0.5 },
        uHalfH: { value: 0.5 },
      };
      this.mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1, 48, 56),
        new THREE.ShaderMaterial({
          uniforms: this.uniforms,
          vertexShader: VERT,
          fragmentShader: FRAG,
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      this.mesh.renderOrder = 2;
      this.tilt.add(this.mesh);

      this.shadowU = { uOpacity: { value: 0.55 } };
      this.shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: this.shadowU,
          vertexShader: SHADOW_VERT,
          fragmentShader: SHADOW_FRAG,
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
        })
      );
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.renderOrder = 1;
      this.swing.add(this.shadow);

      this.sources = new Map();
      this.pending = new Map();
      this.current = null;
      this.currentId = null;
      this.animating = false;
      this.raf = null;

      this.phase = 0;
      this.time = 0;
      this.velocity = 0;
      this.direction = 1;
      this.mouse = { x: 0, y: 0, ex: 0, ey: 0 };

      this.resize();
      let t;
      window.addEventListener("resize", () => {
        clearTimeout(t);
        t = setTimeout(() => this.resize(), 150);
      }, { passive: true });
      window.addEventListener("mousemove", (e) => {
        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
      }, { passive: true });
      window.addEventListener("wheel", (e) => {
        if (!this.animating) return;
        const v = e.deltaY * CFG.wheelFactor;
        this.velocity = Math.max(-CFG.maxVelocity, Math.min(CFG.maxVelocity, v));
        if (e.deltaY > 0) this.direction = 1;
        else if (e.deltaY < 0) this.direction = -1;
      }, { passive: true });
      setInterval(() => { if (this.animating) this.velocity *= CFG.decay; }, 16);
    }

    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setPixelRatio(isLowEnd ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      // caméra un peu au-dessus, qui regarde le centre : le sol (ombre) devient lisible
      const dist = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(CFG.fov / 2)));   // hauteur visible = 1
      this.camera.position.set(0, 0.07, dist);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
      this.root.scale.setScalar(isMobile() ? CFG.sizeMobile : CFG.size);
      if (!this.animating && this.current) this.render(0);
    }

    load(id, spec) {
      if (this.sources.has(id)) return Promise.resolve(this.sources.get(id));
      if (this.pending.has(id)) return this.pending.get(id);
      const p = (spec.frames ? loadFramesSource(spec.frames, this.renderer) : loadImageSource(spec, this.renderer))
        .then((src) => {
          this.pending.delete(id);
          if (src) this.sources.set(id, src);
          return src;
        });
      this.pending.set(id, p);
      return p;
    }

    unload(id) {
      const s = this.sources.get(id);
      if (!s || id === this.currentId) return;
      s.dispose();
      this.sources.delete(id);
    }

    // cadre le maillot : son contour opaque fait 1 unité de haut, centré
    setSection(id) {
      const s = this.sources.get(id);
      if (!s) return false;
      this.current = s;
      this.currentId = id;
      const scale = 1 / s.box.h;
      const planeW = s.aspect * scale;
      const planeH = scale;
      this.mesh.scale.set(planeW, planeH, 1);
      // centre du contour → origine
      const cx = (s.box.x + s.box.w / 2 - 0.5) * planeW;
      const cy = (0.5 - (s.box.y + s.box.h / 2)) * planeH;
      this.mesh.position.set(-cx, -cy, 0);
      this.uniforms.uHalfW.value = 0.5;
      this.uniforms.uHalfH.value = 0.5;

      const image = s.mode === "image";
      this.uniforms.uCurve.value = image ? CFG.curve : 0;
      this.uniforms.uWave.value = image ? CFG.wave : 0;
      this.uniforms.uSheen.value = image ? CFG.sheen : 0.35;
      if (image) {
        this.uniforms.tMap.value = s.textures[0];
        this.uniforms.tNext.value = s.textures[0];
        this.uniforms.uMix.value = 0;
      }
      // ombre au sol : sous le bas du maillot
      const bw = (s.box.w * s.aspect) / s.box.h;   // largeur du contour (unités monde)
      this.shadowBase = bw;
      this.shadow.position.set(0, -0.53, 0.02);
      this.shadow.scale.set(bw * 1.05, 0.42, 1);
      return true;
    }

    update(dt) {
      const s = this.current;
      const boost = (CFG.baseSpeed + Math.abs(this.velocity) / 3) / CFG.baseSpeed; // vitesse ×, comme l'original
      this.time += dt;
      const m = this.mouse;
      m.ex = damp(m.ex, m.x, CFG.tilt.lambda, dt);
      m.ey = damp(m.ey, m.y, CFG.tilt.lambda, dt);

      // la lumière suit la souris → les reflets glissent sur le tissu
      this.uniforms.uLight.value.set(0.35 + m.ex * 0.65, 0.55 - m.ey * 0.45, 1);
      this.uniforms.uTime.value = this.time;

      const bob = Math.sin(this.time * CFG.bob.speed) * CFG.bob.amp;
      this.tilt.position.y = bob;
      this.tilt.rotation.x = m.ey * CFG.tilt.pitch;
      this.shadowU.uOpacity.value = 0.55 * (1 - bob * 9);

      if (s.mode === "image") {
        this.phase += dt * CFG.swing.speed * boost * this.direction;
        const swing = Math.sin(this.phase) * CFG.swing.amp;
        this.swing.rotation.y = swing + m.ex * CFG.tilt.yaw;
        this.shadow.scale.x = this.shadowBase * 1.05 * (1 + bob * 4);
      } else {
        // balancement dans la séquence : fondu entre deux images voisines
        this.phase += dt * CFG.frames.speed * boost * this.direction;
        const deg = Math.sin(this.phase) * CFG.frames.ampDeg;
        const f = deg / s.degPerFrame;
        const i0 = Math.floor(f);
        this.uniforms.tMap.value = s.get(i0);
        this.uniforms.tNext.value = s.get(i0 + 1);
        this.uniforms.uMix.value = f - i0;
        this.swing.rotation.y = m.ex * CFG.tilt.yaw * 0.5;
        const c = Math.cos(THREE.MathUtils.degToRad(deg));
        this.shadow.scale.x = this.shadowBase * (0.8 + 0.25 * c) * (1 + bob * 4);
      }
    }

    render(dt) {
      if (!this.current) return;
      if (dt) this.update(dt);
      this.renderer.render(this.scene, this.camera);
    }

    start() {
      if (this.animating || !this.current) return;
      this.animating = true;
      let last = performance.now();
      const loop = (now) => {
        if (!this.animating) return;
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        this.render(dt);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      this.animating = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
    }

    clear() {
      this.renderer.clear();
    }
  }

  let instance = null;
  return {
    get(container) {
      if (!instance) instance = new Stage(container);
      return instance;
    },
  };
})();
