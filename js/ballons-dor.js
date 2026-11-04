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
     TROPHÉE 3D — modèle du Ballon d'Or (assets/3d/ballon-dor.glb,
     converti depuis l'USDZ par tools/usdz-to-glb.py)
     - posé sur la ligne de craie, il tourne sur lui-même : exactement un
       tour entre deux trophées, donc il présente la même face à chaque arrêt
     - matériaux du modèle (or poli, socle argent) + reflets de studio
     - chargé seulement à l'approche de la section ; en attendant (ou sans
       WebGL), la photo du trophée (assets/3d/ballon-dor.png) est affichée
     ========================================================= */
  const holder = section.querySelector("[data-bdo-canvas]");
  const photo = section.querySelector("[data-bdo-trophy-img]");
  const TROPHY_H = () => (window.innerWidth <= 767 ? 0.26 : 0.36) * window.innerHeight; // hauteur à l'écran
  const FRONT = -Math.PI / 2 + 0.45; // angle où l'inscription regarde l'écran (3/4 face)

  function placePhoto() {
    if (!photo) return;
    gsap.set(photo, { height: TROPHY_H() * 1.02 });
  }
  placePhoto();
  window.addEventListener("resize", placePhoto);
  gsap.set(shadow, { width: TROPHY_H() * 0.75, height: TROPHY_H() * 0.09 });

  if (!window.THREE || !THREE.GLTFLoader || !holder) return;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.55;
  renderer.physicallyCorrectLights = true;
  holder.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 1, 1, 20000);

  // reflets : studio neutre (RoomEnvironment) + lumière chaude qui suit la souris
  if (THREE.RoomEnvironment) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  }
  const key = new THREE.DirectionalLight(0xffe7b8, 3.2);
  key.position.set(-1, 1.4, 1.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6f8fd0, 1.2); // contre-jour bleuté (palette du site)
  rim.position.set(1.2, 0.6, -1);
  scene.add(rim);

  const pivot = new THREE.Group(); // à la place du ballon, sur la ligne
  const spinner = new THREE.Group(); // rotation sur lui-même
  pivot.add(spinner);
  scene.add(pivot);
  let model = null;

  function resize() {
    const w = section.clientWidth, h = section.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    // caméra perspective réglée pour qu'1 unité = 1 px dans le plan z = 0
    camera.aspect = w / h;
    camera.position.set(0, 0, h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.near = camera.position.z / 10;
    camera.far = camera.position.z * 10;
    camera.updateProjectionMatrix();
    const H = TROPHY_H();
    pivot.scale.setScalar(H);
    pivot.position.set(ballX() - w / 2, h / 2 - lineY(), 0);
    gsap.set(shadow, { width: H * 0.75, height: H * 0.09 });
    updateRail();
  }
  window.addEventListener("resize", resize);
  resize();
  ScrollTrigger.addEventListener("refresh", resize);

  // chargement du modèle à l'approche de la section
  ScrollTrigger.create({
    trigger: section,
    start: "top bottom+=100%",
    once: true,
    onEnter: () => {
      new THREE.GLTFLoader().load(
        "assets/3d/ballon-dor.glb",
        (gltf) => {
          model = gltf.scene;
          model.traverse((o) => {
            if (!o.isMesh) return;
            const m = o.material;
            // réglages proches de la photo : or chaud poli, socle doré-argenté plus mat
            // or poli : teinte physique de l'or (linéaire), la couleur d'origine du modèle sortait brune
            if (/gold/i.test(m.name)) { m.color.setRGB(1.0, 0.8, 0.33); m.roughness = 0.12; m.envMapIntensity = 2.8; }
            if (/silver/i.test(m.name)) { m.color.setRGB(0.82, 0.64, 0.32); m.roughness = 0.3; m.envMapIntensity = 2.3; }
          });
          spinner.add(model);
          gsap.fromTo(spinner.scale, { x: 0.85, y: 0.85, z: 0.85 }, { x: 1, y: 1, z: 1, duration: 0.9, ease: "back.out(1.6)" });
          if (photo) gsap.to(photo, { autoAlpha: 0, duration: 0.5, delay: 0.1 });
        },
        undefined,
        () => console.info("[ballons-dor] modèle 3D introuvable : la photo reste affichée")
      );
    },
  });

  // légère inclinaison qui suit la souris (amortie)
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener("mousemove", (e) => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  // rendu uniquement quand la section est à l'écran
  let visible = false;
  ScrollTrigger.create({
    trigger: section,
    start: "top bottom",
    end: () => `+=${tl.scrollTrigger.end - tl.scrollTrigger.start + window.innerHeight * 2}`,
    onToggle: (self) => (visible = self.isActive),
  });

  gsap.ticker.add(() => {
    if (!visible || !model) return;
    const traveled = -gsap.getProperty(track, "x");
    // un tour complet entre deux trophées : même face à chaque arrêt
    spinner.rotation.y = FRONT + (traveled / S()) * Math.PI * 2;
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    pivot.rotation.set(mouse.y * 0.08, mouse.x * 0.12, 0);
    key.position.set(-1 + mouse.x * 0.8, 1.4 - mouse.y * 0.6, 1.2);
    renderer.render(scene, camera);
  });
  }
})();
