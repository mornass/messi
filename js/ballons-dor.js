/* =========================================================
   3. LES 8 BALLONS D'OR — frise horizontale épinglée
   - la section est épinglée ; la frise défile (scrub) et s'arrête sur
     chaque trophée : année remplie, texte + photo, compteur n / 8
   - un ballon d'or en 3D (Three.js) roule sur la ligne de craie :
     sa rotation suit exactement la distance parcourue
   - les années sans Ballon d'Or restent en graduations discrètes
   - à la fin, le « 8 » du compteur passe en grenat
   Photos : data-media (js/club-media.js), chargées à l'approche.
   ========================================================= */
(() => {
  const section = document.querySelector("[data-bdo]");
  if (!section || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  // les épinglages doivent être créés dans l'ordre de la page : les clubs (créés
  // après le chargement des polices, js/clubs.js) d'abord, cette section ensuite
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    init();
    ScrollTrigger.refresh();
  });

  function init() {

  const track = section.querySelector("[data-bdo-track]");
  const rail = section.querySelector("[data-bdo-rail]");
  const railLine = rail.parentElement;
  const roll = section.querySelector("[data-bdo-roll]");
  const count = section.querySelector("[data-bdo-count]");
  const stops = Array.from(section.querySelectorAll("[data-bdo-stop]"));
  const intro = section.querySelectorAll("[data-bdo-intro]");
  const outro = section.querySelector("[data-bdo-outro]");
  const shadow = section.querySelector("[data-bdo-shadow]");

  const D = { introHold: 0.5, move: 1, arrive: 0.35, hold: 0.6, outroHold: 0.9 };
  const FILL_ON = "rgba(246, 245, 240, 1)";
  const FILL_OFF = "rgba(246, 245, 240, 0)";
  const OUTRO_X = 8.85;

  // distance entre deux trophées (--S) et position du ballon (--ball-x), en px
  const S = () => stops[0].offsetLeft;
  const ballX = () => track.offsetLeft;
  const lineY = () => railLine.offsetTop;

  // ---------- états initiaux ----------
  stops.forEach((st) => gsap.set(st.querySelectorAll("[data-bdo-body]"), { autoAlpha: 0, y: 24 }));
  gsap.set(outro, { autoAlpha: 0, y: 24 });
  gsap.set(intro, { autoAlpha: 0, y: 30 });

  // intro : apparaît à l'arrivée de la section (avant l'épinglage)
  gsap.to(intro, {
    autoAlpha: 1,
    y: 0,
    duration: 1,
    stagger: 0.12,
    ease: "power3.out",
    scrollTrigger: { trigger: section, start: "top 65%", toggleActions: "play none none reverse" },
  });

  // ---------- compteur n / 8 ----------
  const counter = { n: 0 };
  const renderCount = () => {
    gsap.set(roll, { yPercent: (-counter.n * 100) / 9 });
    count.classList.toggle("is-complete", counter.n > 7.98);
  };

  // ---------- timeline principale ----------
  const tl = gsap.timeline({
    defaults: { ease: "power1.inOut" },
    scrollTrigger: {
      trigger: section,
      start: "top top",
      end: () => `+=${Math.round(window.innerHeight * 0.75 * tl.duration())}`,
      scrub: 1,
      pin: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
    onUpdate: updateRail,
  });

  tl.to({}, { duration: D.introHold });
  stops.forEach((st, k) => {
    const i = k + 1;
    const year = st.querySelector("[data-bdo-year]");
    const bodies = st.querySelectorAll("[data-bdo-body]");
    const start = tl.duration();
    // l'année précédente se vide pendant que le ballon repart
    if (k > 0) tl.to(stops[k - 1].querySelector("[data-bdo-year]"), { color: FILL_OFF, duration: 0.4, ease: "none" }, start);
    if (k === 0) tl.to(intro, { autoAlpha: 0, duration: 0.5, ease: "none" }, start);
    tl.to(track, { x: () => -i * S(), duration: D.move }, start);
    // arrivée : année remplie, texte + photo, compteur
    const at = start + D.move - 0.1;
    tl.to(year, { color: FILL_ON, duration: D.arrive, ease: "power2.out" }, at);
    tl.to(bodies, { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.08, ease: "power3.out" }, at);
    tl.to(counter, { n: i, duration: D.arrive, ease: "power2.out", onUpdate: renderCount }, at);
    tl.to({}, { duration: D.hold }, at + D.arrive);
  });
  // conclusion
  const end = tl.duration();
  tl.to(stops[stops.length - 1].querySelector("[data-bdo-year]"), { color: FILL_OFF, duration: 0.4, ease: "none" }, end);
  tl.to(track, { x: () => -OUTRO_X * S(), duration: D.move }, end);
  tl.to(outro, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power3.out" }, end + D.move - 0.15);
  tl.to({}, { duration: D.outroHold });

  // trait plein de la ligne de craie : jusqu'au ballon
  function updateRail() {
    const traveled = -gsap.getProperty(track, "x");
    rail.style.width = `${ballX() + traveled}px`;
  }
  updateRail();

  // photos : chargées à l'approche de la section
  if (window.ClubMedia) {
    const media = ClubMedia.attach(section);
    ScrollTrigger.create({ trigger: section, start: "top bottom+=100%", once: true, onEnter: () => media.load() });
  }

  /* =========================================================
     BALLON D'OR 3D
     Coutures de vrai ballon : 12 pentagones + 20 hexagones (cellules de
     Voronoï autour des sommets de l'icosaèdre et du dodécaèdre), or
     martelé, reflets d'environnement, lumière qui suit la souris.
     ========================================================= */
  const holder = section.querySelector("[data-bdo-canvas]");
  if (!window.THREE || !holder) return;

  const PHI = (1 + Math.sqrt(5)) / 2;
  const centers = [];
  // icosaèdre (pentagones)
  [[0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI], [1, PHI, 0], [-1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1]]
    .forEach((v) => centers.push(new THREE.Vector3(...v).normalize()));
  // dodécaèdre (hexagones)
  const ip = 1 / PHI;
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) centers.push(new THREE.Vector3(a, b, c).normalize());
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    centers.push(new THREE.Vector3(0, a * ip, b * PHI).normalize());
    centers.push(new THREE.Vector3(a * ip, b * PHI, 0).normalize());
    centers.push(new THREE.Vector3(a * PHI, 0, b * ip).normalize());
  }

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  holder.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);

  const uniforms = {
    uCenters: { value: centers },
    uLight: { value: new THREE.Vector3(-0.4, 0.7, 0.9) },
    uGold: { value: new THREE.Color("#C9A13B") },
  };
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN;     // normale (repère vue)
        varying vec3 vObj;   // position sur la sphère (repère objet : suit la rotation)
        void main() {
          vObj = normalize(position);
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCenters[32];
        uniform vec3 uLight;
        uniform vec3 uGold;
        varying vec3 vN;
        varying vec3 vObj;

        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }

        void main() {
          // panneau le plus proche et le second : la couture est là où ils se valent
          vec3 p = normalize(vObj);
          float d1 = -2.0, d2 = -2.0; int best = 0;
          for (int i = 0; i < 32; i++) {
            float d = dot(p, uCenters[i]);
            if (d > d1) { d2 = d1; d1 = d; best = i; }
            else if (d > d2) { d2 = d; }
          }
          float seam = 1.0 - smoothstep(0.004, 0.022, d1 - d2);
          float pent = best < 12 ? 1.0 : 0.0;

          // or martelé : petites bosses qui modulent la normale et la teinte
          float h = noise(p * 22.0) * 0.6 + noise(p * 47.0) * 0.4;
          vec3 N = normalize(vN + (h - 0.5) * 0.18 * vec3(1.0, 1.0, 0.0));
          vec3 V = vec3(0.0, 0.0, 1.0);
          vec3 L = normalize(uLight);

          float diff = max(dot(N, L), 0.0);
          vec3 R = reflect(-V, N);
          // environnement : ciel chaud en haut, bleu marine du site en bas
          vec3 env = mix(vec3(0.03, 0.07, 0.14), vec3(1.0, 0.94, 0.82), smoothstep(-0.35, 0.75, R.y));
          env += vec3(0.25, 0.18, 0.08) * exp(-abs(R.y) * 9.0);          // ligne d'horizon
          vec3 gold = uGold * mix(1.0, 0.86, pent) * (0.92 + h * 0.16);

          vec3 col = gold * (0.18 + 0.55 * diff) + gold * env * 0.85;
          float spec = pow(max(dot(reflect(-L, N), V), 0.0), 60.0);
          col += vec3(1.0, 0.93, 0.75) * spec * 1.1;
          float fres = pow(1.0 - max(N.z, 0.0), 3.0);
          col += gold * fres * 0.35;

          // couture creusée : sombre, sans reflet
          col = mix(col, gold * 0.18, seam * 0.85);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  );
  ball.rotation.order = "ZXY"; // le roulement (axe z) s'applique en dernier
  scene.add(ball);

  let R = 1;
  function resize() {
    const w = section.clientWidth, h = section.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    const mobile = w <= 767;
    R = mobile ? Math.min(h * 0.07, w * 0.13) : Math.min(h * 0.115, w * 0.09);
    ball.scale.setScalar(R);
    ball.position.set(ballX() - w / 2, h / 2 - lineY() + R, 0);
    gsap.set(shadow, { width: R * 2.3, height: R * 0.4 });
    updateRail();
  }
  window.addEventListener("resize", resize);
  resize();
  ScrollTrigger.addEventListener("refresh", resize);

  // lumière qui suit la souris (amortie)
  const mouse = { x: -0.4, y: 0.7, tx: -0.4, ty: 0.7 };
  window.addEventListener("mousemove", (e) => {
    mouse.tx = (e.clientX / window.innerWidth) * 1.6 - 0.8;
    mouse.ty = 1 - (e.clientY / window.innerHeight) * 1.2;
  }, { passive: true });

  // rendu uniquement quand la section est à l'écran
  let visible = false;
  ScrollTrigger.create({
    trigger: section,
    start: "top bottom",
    end: () => `+=${tl.scrollTrigger.end - tl.scrollTrigger.start + window.innerHeight * 2}`,
    onToggle: (self) => (visible = self.isActive),
  });

  let spin = 0;
  gsap.ticker.add((t, dt) => {
    if (!visible) return;
    const traveled = -gsap.getProperty(track, "x");
    spin += (dt / 1000) * 0.15; // très légère rotation sur lui-même au repos
    // roulement sans glisser : angle = distance / rayon
    ball.rotation.set(0.35, spin, -traveled / R);
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    uniforms.uLight.value.set(mouse.x, mouse.y, 0.9);
    renderer.render(scene, camera);
  });
  }
})();
