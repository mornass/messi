/* =========================================================
   3. LES 8 BALLONS D'OR — ambiance cérémonie
   Années : 2009, 2010, 2011, 2012, 2015, 2019, 2021, 2023
   (club le jour de la cérémonie : Barça, puis PSG en 2021, Inter Miami en 2023).

   - arrivée : la couleur de la section précédente s'efface vers le noir (scrub)
   - section épinglée (scrub) :
       1. le contour doré du grand « 8 » se dessine, le titre s'installe
       2. les 8 cartes apparaissent une par une (grille 4 × 2 ; carrousel sur
          mobile), le « 8 » se remplit d'or d'un huitième à chaque carte,
          compteur 01 → 08 et index des années
       3. phrase finale
   - ambiance (seulement quand la section est à l'écran) : halo doré qui suit
     la souris, particules dorées sur trois profondeurs (canvas 2D),
     projecteurs et reflet métallique en CSS
   - cartes : inclinaison 3D + reflet au survol (souris uniquement)
   Médias des cartes : js/club-media.js (vidéo si présente, sinon photo).
   ========================================================= */
(() => {
  const section = document.querySelector("[data-bdo]");
  if (!section || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  // épinglages créés dans l'ordre de la page : les clubs (après les polices) d'abord
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    init();
    ScrollTrigger.refresh();
  });

  function init() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const N = 8;

    const prev = section.querySelector("[data-bdo-prev]");
    const halo = section.querySelector("[data-bdo-halo]");
    const canvas = section.querySelector("[data-bdo-particles]");
    const stroke = section.querySelector("[data-bdo-stroke]");
    const fill = section.querySelector("[data-bdo-fill]");
    const sheen = section.querySelector(".bdo-eight-sheen");
    const title = section.querySelector("[data-bdo-title]");
    const lead = section.querySelector("[data-bdo-lead]");
    const countEl = section.querySelector("[data-bdo-count-n]");
    const index = Array.from(section.querySelectorAll("[data-bdo-index]"));
    const outro = section.querySelector("[data-bdo-outro]");
    const track = section.querySelector("[data-bdo-track]");
    const cards = Array.from(section.querySelectorAll("[data-bdo-card]"));
    const medias = cards.map((c) => c.querySelector("[data-bdo-media]"));

    /* ---------- 1. fondu depuis la section précédente ---------- */
    const clubs = document.querySelector("[data-clubs]");
    const setPrev = () => {
      const c = clubs && getComputedStyle(clubs).getPropertyValue("--c-base").trim();
      if (c) prev.style.setProperty("--prev", c);
    };
    gsap.fromTo(prev, { opacity: 1 }, {
      opacity: 0,
      ease: "power1.out",
      scrollTrigger: { trigger: section, start: "top bottom", end: "top 15%", scrub: true, onRefresh: setPrev, onEnter: setPrev },
    });

    /* ---------- état + rendu ---------- */
    const st = { fill: 0, shown: 0 };
    let media = null;
    let inView = false;
    let current = -1;

    function setCurrent(k) {
      if (k === current) return;
      current = k;
      countEl.textContent = String(Math.max(0, k + 1)).padStart(2, "0");
      index.forEach((li, i) => {
        li.classList.toggle("is-on", i <= k);
        li.classList.toggle("is-current", i === k);
      });
      // une seule vidéo lue : celle de la dernière carte apparue
      medias.forEach((m, i) => media?.setSlot(m, inView && i === k));
    }

    const strokeLen = stroke.getTotalLength();
    gsap.set(stroke, { strokeDasharray: strokeLen, strokeDashoffset: strokeLen });
    gsap.set([title, lead], { autoAlpha: 0, y: 30 });
    gsap.set(cards, { autoAlpha: 0, y: 70, rotateX: -18, scale: 0.94, transformOrigin: "50% 100%" });

    function render() {
      fill.style.transform = `scaleY(${st.fill})`;
      sheen.style.opacity = Math.min(1, st.fill * 2.5).toFixed(3);
      setCurrent(Math.round(st.shown) - 1);
    }

    /* ---------- 2. timeline épinglée (bureau / mobile) ---------- */
    const mm = gsap.matchMedia();
    let tl;
    mm.add({ desk: "(min-width: 768px)", mob: "(max-width: 767px)" }, (ctx) => {
      const mob = ctx.conditions.mob;
      tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: () => `+=${Math.round(window.innerHeight * 0.65 * tl.duration())}`,
          scrub: 1,
          pin: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
        onUpdate: render,
      });
      // 1. le contour du 8 se dessine, le titre s'installe
      tl.to(stroke, { strokeDashoffset: 0, duration: 1.2, ease: "power1.inOut" }, 0);
      tl.to([title, lead], { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.15 }, 0.15);
      // 2. les cartes une par une ; le 8 se remplit d'un huitième à chaque carte
      const cardW = () => cards[0].offsetWidth + parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || 0);
      cards.forEach((card, i) => {
        const at = 1.3 + i * 0.95;
        if (mob && i > 0) tl.to(track, { x: () => -i * cardW(), duration: 0.6, ease: "power2.inOut" }, at - 0.15);
        tl.to(card, { autoAlpha: 1, y: 0, rotateX: 0, scale: 1, duration: 0.6 }, at);
        tl.to(st, { fill: (i + 1) / N, shown: i + 1, duration: 0.6, ease: "power1.inOut" }, at);
        if (mob && i > 0) tl.to(cards[i - 1], { autoAlpha: 0.35, scale: 0.94, duration: 0.5 }, at);
      });
      // 3. phrase finale
      tl.to(outro, { autoAlpha: 1, duration: 0.7 }, 1.3 + N * 0.95);
      tl.to({}, { duration: 0.9 });
      return () => gsap.set(track, { clearProps: "x" });
    });

    /* ---------- médias : chargés à l'approche ---------- */
    if (window.ClubMedia) {
      media = ClubMedia.attach(section);
      ScrollTrigger.create({ trigger: section, start: "top bottom+=100%", once: true, onEnter: () => media.load() });
    }
    // ambiance et vidéos actives seulement quand la section est à l'écran
    ScrollTrigger.create({
      trigger: section,
      start: "top bottom",
      end: () => `+=${tl.scrollTrigger.end - tl.scrollTrigger.start + window.innerHeight * 2}`,
      onToggle: (self) => {
        inView = self.isActive;
        medias.forEach((m, i) => media?.setSlot(m, inView && i === current));
      },
    });
    render();

    /* ---------- 3. halo doré + particules ---------- */
    const ctx2d = canvas.getContext("2d");
    const mobile = () => window.innerWidth <= 767;
    let W = 0, H = 0, dpr = 1, parts = [];
    // sprite lumineux pré-rendu (un drawImage par particule : rapide)
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    {
      const g = sprite.getContext("2d");
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, "rgba(255, 240, 200, 1)");
      grd.addColorStop(0.25, "rgba(232, 211, 162, 0.75)");
      grd.addColorStop(1, "rgba(201, 162, 75, 0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }
    function sizeCanvas() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = section.clientWidth;
      H = section.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const n = mobile() ? 50 : 110;
      parts = Array.from({ length: n }, () => {
        const z = Math.random(); // 0 = loin, 1 = près
        return {
          x: Math.random() * W,
          y: Math.random() * H,
          z,
          r: 1.2 + z * z * 5.5,
          a: 0.15 + z * 0.55,
          vy: -(0.06 + z * 0.32),
          sway: Math.random() * Math.PI * 2,
          tw: 0.5 + Math.random() * 1.5,
        };
      });
    }
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);

    const pointer = { x: 0.62, y: 0.4, tx: 0.62, ty: 0.4 };
    section.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const r = section.getBoundingClientRect();
      pointer.tx = (e.clientX - r.left) / r.width;
      pointer.ty = (e.clientY - r.top) / r.height;
    }, { passive: true });

    let time = 0;
    gsap.ticker.add((t, dtMs) => {
      if (!inView) return;
      const dt = Math.min(dtMs, 50) / 16.67;
      time += dt;
      // sans souris (mobile) : le halo suit la carte active
      if (!finePointer) {
        const c = cards[Math.max(0, current)];
        if (c) {
          const r = c.getBoundingClientRect(), sr = section.getBoundingClientRect();
          pointer.tx = (r.left + r.width / 2 - sr.left) / sr.width;
          pointer.ty = (r.top + r.height * 0.3 - sr.top) / sr.height;
        }
      }
      pointer.x += (pointer.tx - pointer.x) * 0.05 * dt;
      pointer.y += (pointer.ty - pointer.y) * 0.05 * dt;
      halo.style.transform = `translate3d(${pointer.x * W}px, ${pointer.y * H}px, 0)`;

      // particules : montée lente + balancement, parallaxe selon la profondeur
      const prog = tl ? tl.progress() : 0;
      const mx = (pointer.x - 0.5) * 2, my = (pointer.y - 0.5) * 2;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, W, H);
      ctx2d.globalCompositeOperation = "lighter";
      for (const p of parts) {
        if (!reduce) {
          p.y += p.vy * dt;
          p.sway += 0.01 * dt;
        }
        if (p.y < -20) { p.y = H + 20; p.x = Math.random() * W; }
        const px = p.x + Math.sin(p.sway) * 14 * p.z - mx * 26 * p.z;
        const py = p.y - my * 16 * p.z - prog * 120 * p.z;
        const yy = ((py % (H + 40)) + H + 40) % (H + 40) - 20;
        const flick = 0.75 + 0.25 * Math.sin(time * 0.05 * p.tw + p.sway * 3);
        ctx2d.globalAlpha = p.a * flick;
        const s = p.r * 2;
        ctx2d.drawImage(sprite, px - s, yy - s, s * 2, s * 2);
      }
      ctx2d.globalAlpha = 1;
    });

    /* ---------- 4. cartes : inclinaison 3D + reflet au survol ---------- */
    if (finePointer && !reduce) {
      section.querySelectorAll("[data-bdo-tilt]").forEach((el) => {
        const rx = gsap.quickTo(el, "rotationX", { duration: 0.5, ease: "power3.out" });
        const ry = gsap.quickTo(el, "rotationY", { duration: 0.5, ease: "power3.out" });
        const z = gsap.quickTo(el, "z", { duration: 0.5, ease: "power3.out" });
        el.addEventListener("pointermove", (e) => {
          const r = el.getBoundingClientRect();
          const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
          ry((u - 0.5) * 14);
          rx(-(v - 0.5) * 12);
          z(24);
          el.style.setProperty("--gx", `${u * 100}%`);
          el.style.setProperty("--gy", `${v * 100}%`);
        });
        el.addEventListener("pointerleave", () => { rx(0); ry(0); z(0); });
      });
    }
  }
})();
