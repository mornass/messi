/* =========================================================
   3. LES 8 BALLONS D'OR — section épinglée (scrub)
   Années exactes : 2009, 2010, 2011, 2012, 2015, 2019, 2021, 2023.
   Club le jour de la cérémonie : Barça (2009 → 2019), PSG (2021), Inter Miami (2023).

   Au scroll :
     - un point doré avance sur la ligne 2009 → 2023 et l'année DÉFILE
       (2012 → 2013 → 2014 → 2015…) ;
     - à chaque sacre, un trophée 3D apparaît sur la ligne (il tourne, se pose)
       et y reste : à la fin, les 8 trophées sont alignés ;
     - la fiche (n°, club, texte) et la vidéo / photo de l'année changent ;
     - le grand « 8 » se remplit d'or, un huitième par trophée.
   Trophée : assets/3d/ballon-dor.glb (tools/usdz-to-glb.py), chargé à l'approche ;
   en attendant (ou sans WebGL) : photo du trophée (assets/3d/ballon-dor.png).
   Médias : js/club-media.js (vidéo si présente, sinon photo).
   ========================================================= */
(() => {
  const section = document.querySelector("[data-bdo]");
  if (!section || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  // les épinglages doivent être créés dans l'ordre de la page : les clubs d'abord
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    init();
    ScrollTrigger.refresh();
  });

  function init() {
    const YEARS = [2009, 2010, 2011, 2012, 2015, 2019, 2021, 2023];
    const N = YEARS.length;
    const D = { intro: 0.6, move: 1, appear: 0.55, hold: 0.55, outro: 0.9 };

    const intro = section.querySelector("[data-bdo-intro]");
    const stage = section.querySelector("[data-bdo-stage]");
    const info = section.querySelector(".bdo-info");
    const mediaBox = section.querySelector(".bdo-media");
    const eight = section.querySelector(".bdo-eight");
    const yearEl = section.querySelector("[data-bdo-year]");
    const cards = Array.from(section.querySelectorAll("[data-bdo-card]"));
    const medias = Array.from(section.querySelectorAll("[data-bdo-media]"));
    const slots = Array.from(section.querySelectorAll("[data-bdo-slot]"));
    const slotImgs = slots.map((s) => s.querySelector("[data-bdo-slot-img]"));
    const marker = section.querySelector("[data-bdo-marker]");
    const progress = section.querySelector("[data-bdo-progress]");
    const lineEl = section.querySelector(".bdo-line");
    const outro = section.querySelector("[data-bdo-outro]");

    // ---------- état piloté par la timeline ----------
    const st = { pos: 0, appear: new Array(N).fill(0), stage: 0, outro: 0 };
    let shownYear = null;
    let activeCard = -1;
    let media = null;
    const backOut = gsap.parseEase("back.out(1.8)");

    // position (px, repère de la section) d'un emplacement, même fractionnaire
    const slotX = (i) => {
      const c = Math.min(i, N - 1);
      const a = slots[Math.floor(c)].offsetLeft;
      const b = slots[Math.ceil(c)].offsetLeft;
      return a + (b - a) * (c - Math.floor(c));
    };

    function setCard(k) {
      if (k === activeCard) return;
      cards.forEach((c, i) => gsap.to(c, { autoAlpha: i === k ? 1 : 0, y: i === k ? 0 : 12, duration: 0.45, ease: "power2.out", overwrite: true }));
      medias.forEach((m, i) => {
        gsap.to(m, { opacity: i === k ? 1 : 0, duration: 0.6, ease: "power2.out", overwrite: true });
        media?.setSlot(m, i === k);
      });
      slots.forEach((s, i) => s.classList.toggle("is-won", i <= k));
      activeCard = k;
    }

    function render() {
      const pos = st.pos;
      // point doré + trait plein jusqu'à lui
      const x = slotX(pos);
      marker.style.left = `${x}px`;
      progress.style.width = `${Math.max(0, x - lineEl.offsetLeft)}px`;

      // l'année défile entre deux sacres (2012 → 2013 → 2014 → 2015)
      const i0 = Math.floor(pos), f = pos - i0;
      const y = i0 >= N - 1 ? YEARS[N - 1] : Math.floor(YEARS[i0] + (YEARS[i0 + 1] - YEARS[i0]) * f + 1e-6);
      if (y !== shownYear) {
        const up = shownYear === null || y > shownYear;
        yearEl.textContent = y;
        if (shownYear !== null) gsap.fromTo(yearEl, { yPercent: up ? 18 : -18, opacity: 0.4 }, { yPercent: 0, opacity: 1, duration: 0.35, ease: "power3.out", overwrite: true });
        shownYear = y;
      }

      // fiche : celle du dernier trophée apparu ; atténuée pendant le trajet
      const won = st.appear.reduce((n, a) => n + (a > 0.5 ? 1 : 0), 0);
      setCard(won - 1);
      const travel = i0 < N - 1 && f > 0 ? Math.sin(Math.PI * f) : 0;

      // grand 8 : un huitième d'or par trophée
      eight.style.setProperty("--fill", (st.appear.reduce((n, a) => n + a, 0) / N).toFixed(4));
      // photo des trophées (tant que le modèle 3D n'est pas chargé)
      slotImgs.forEach((img, i) => (img.style.transform = `translateX(-50%) scale(${Math.max(0, backOut(st.appear[i]))})`));

      // intro → scène → conclusion
      gsap.set(intro, { autoAlpha: 1 - st.stage, y: -30 * st.stage });
      gsap.set(stage, { autoAlpha: st.stage });
      gsap.set(info, { autoAlpha: (1 - 0.55 * travel) * (1 - st.outro) });
      gsap.set(mediaBox, { autoAlpha: 1 - st.outro });
      gsap.set(outro, { autoAlpha: st.outro, y: 24 * (1 - st.outro) });
    }

    // ---------- timeline principale ----------
    const tl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: () => `+=${Math.round(window.innerHeight * 0.7 * tl.duration())}`,
        scrub: 1,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
      onUpdate: render,
    });
    tl.to({}, { duration: D.intro });
    tl.to(st, { stage: 1, duration: 0.6, ease: "power2.inOut" });
    YEARS.forEach((_, i) => {
      if (i > 0) tl.to(st, { pos: i, duration: D.move, ease: "power1.inOut" });
      // le trophée apparaît : proxy 0 → 1 (échelle, rotation, or du 8)
      const proxy = { a: 0 };
      tl.to(proxy, { a: 1, duration: D.appear, ease: "power2.out", onUpdate: () => (st.appear[i] = proxy.a) });
      tl.to({}, { duration: D.hold });
    });
    tl.to(st, { outro: 1, duration: 0.6, ease: "power2.inOut" });
    tl.to({}, { duration: D.outro });

    // médias : chargés à l'approche ; vidéos lues seulement section à l'écran
    let inView = false;
    if (window.ClubMedia) {
      media = ClubMedia.attach(section);
      ScrollTrigger.create({ trigger: section, start: "top bottom+=100%", once: true, onEnter: () => media.load() });
    }
    ScrollTrigger.create({
      trigger: section,
      start: "top bottom",
      end: () => `+=${tl.scrollTrigger.end - tl.scrollTrigger.start + window.innerHeight * 2}`,
      onToggle: (self) => {
        inView = self.isActive;
        medias.forEach((m, i) => media?.setSlot(m, inView && i === activeCard));
      },
    });
    render();

    /* =========================================================
       TROPHÉES 3D — 8 copies du même modèle (géométrie partagée),
       une par emplacement ; chacune apparaît en tournant puis se pose,
       avec une très lente rotation au repos.
       ========================================================= */
    const holder = section.querySelector("[data-bdo-canvas]");
    const TROPHY_H = () => {
      const w = window.innerWidth, h = window.innerHeight;
      return w <= 767 ? Math.min(h * 0.075, w * 0.13) : Math.min(h * 0.16, ((w * 0.82) / 7) * 1.1);
    };
    const sizeImgs = () => slotImgs.forEach((img) => (img.style.height = `${TROPHY_H() * 1.02}px`));
    sizeImgs();
    if (!window.THREE || !THREE.GLTFLoader || !holder) {
      window.addEventListener("resize", sizeImgs);
      return;
    }
    const FRONT = -Math.PI / 2 + 0.45; // l'inscription regarde l'écran (3/4 face)

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    renderer.physicallyCorrectLights = true;
    holder.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(22, 1, 1, 20000);
    if (THREE.RoomEnvironment) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    }
    const key = new THREE.DirectionalLight(0xffe7b8, 3.2); // lumière chaude qui suit la souris
    key.position.set(-1, 1.4, 1.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6f8fd0, 1.2); // contre-jour bleuté (palette du site)
    rim.position.set(1.2, 0.6, -1);
    scene.add(rim);

    const trophies = YEARS.map(() => {
      const pivot = new THREE.Group();
      const spinner = new THREE.Group();
      pivot.add(spinner);
      scene.add(pivot);
      return { pivot, spinner };
    });
    let loaded = false;

    function layout() {
      const w = section.clientWidth, h = section.clientHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.set(0, 0, h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))); // 1 unité = 1 px en z = 0
      camera.near = camera.position.z / 10;
      camera.far = camera.position.z * 10;
      camera.updateProjectionMatrix();
      const H = TROPHY_H();
      const ly = lineEl.offsetTop;
      trophies.forEach((t, i) => {
        t.pivot.scale.setScalar(H);
        t.pivot.position.set(slotX(i) - w / 2, h / 2 - ly, 0);
      });
      sizeImgs();
      render();
    }
    window.addEventListener("resize", layout);
    ScrollTrigger.addEventListener("refresh", layout);
    layout();

    // modèle chargé à l'approche de la section
    ScrollTrigger.create({
      trigger: section,
      start: "top bottom+=100%",
      once: true,
      onEnter: () =>
        new THREE.GLTFLoader().load(
          "assets/3d/ballon-dor.glb",
          (gltf) => {
            gltf.scene.traverse((o) => {
              if (!o.isMesh) return;
              const m = o.material;
              // or poli (teinte physique de l'or) et socle doré-gris, d'après la photo de référence
              if (/gold/i.test(m.name)) { m.color.setRGB(1.0, 0.8, 0.33); m.roughness = 0.12; m.envMapIntensity = 2.8; }
              if (/silver/i.test(m.name)) { m.color.setRGB(0.82, 0.64, 0.32); m.roughness = 0.3; m.envMapIntensity = 2.3; }
            });
            trophies.forEach((t, i) => t.spinner.add(i === 0 ? gltf.scene : gltf.scene.clone()));
            loaded = true;
            slotImgs.forEach((img) => gsap.to(img, { autoAlpha: 0, duration: 0.4 }));
          },
          undefined,
          () => console.info("[ballons-dor] modèle 3D introuvable : les photos du trophée restent affichées")
        ),
    });

    const mouse = { x: 0, tx: 0 };
    window.addEventListener("mousemove", (e) => (mouse.tx = (e.clientX / window.innerWidth) * 2 - 1), { passive: true });

    const appearEase = gsap.parseEase("back.out(1.6)");
    let idle = 0;
    gsap.ticker.add((t, dt) => {
      if (!inView || !loaded) return;
      idle += (dt / 1000) * 0.25;
      mouse.x += (mouse.tx - mouse.x) * 0.05;
      trophies.forEach((tr, i) => {
        const a = st.appear[i];
        tr.pivot.visible = a > 0.001;
        if (!tr.pivot.visible) return;
        tr.spinner.scale.setScalar(Math.max(0.001, appearEase(a)));
        // apparition : un tour et demi en descendant se poser, puis lente rotation au repos
        tr.spinner.rotation.y = FRONT + (1 - a) * Math.PI * 3 + idle + i * 0.35;
        tr.spinner.position.y = (1 - a) * 0.35;
        tr.pivot.rotation.y = mouse.x * 0.15;
      });
      key.position.set(-1 + mouse.x * 0.8, 1.4, 1.2);
      renderer.render(scene, camera);
    });
  }
})();
