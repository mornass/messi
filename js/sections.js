/* =========================================================
   SECTIONS (après le hero)
   ========================================================= */
(() => {
  if (!window.gsap || !window.ScrollTrigger || !window.MessiUtils) return;
  gsap.registerPlugin(ScrollTrigger);
  const { splitLines, highLines } = window.MessiUtils;

  // Les textes sont découpés en lignes une fois la police chargée
  // (sinon les retours à la ligne seraient faux).
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();

  /* -------------------------------------------------------
     1. IMPACT — manifeste
        Original : icône casque (Rive) + eyebrow + grand texte,
        chaque ligne révélée par le "high-line" au passage (top 90%).
        Ajout terrain : rond central + ligne médiane tracés au scroll.
     ------------------------------------------------------- */
  function initImpact() {
    const section = document.querySelector("[data-impact]");
    if (!section) return;

    // --- Textes : high-line reveal (une seule fois, à 90 % de l'écran) ---
    const texts = section.querySelectorAll("[data-anim-high]");
    const timelines = new Map();

    function build() {
      texts.forEach((el) => {
        const old = timelines.get(el);
        if (old?.played) return; // déjà révélé : on ne rejoue pas après un resize
        old?.tl.kill();
        old?.st.kill();
        el.querySelectorAll(".high-line-reveal").forEach((b) => b.remove());

        if (el.hasAttribute("data-split-lines")) splitLines(el);
        const entry = { played: false };
        entry.tl = highLines(el, () => el.classList.add("is-revealed"));
        entry.st = ScrollTrigger.create({
          trigger: el,
          start: "top 90%",
          once: true,
          onEnter: () => {
            entry.played = true;
            entry.tl.play();
          },
        });
        timelines.set(el, entry);
      });
    }

    fontsReady.then(() => {
      build();
      let raf;
      let lastW = window.innerWidth;
      window.addEventListener("resize", () => {
        if (window.innerWidth === lastW) return; // ignore les resize verticaux (barre d'adresse mobile)
        lastW = window.innerWidth;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          texts.forEach((el) => {
            const e = timelines.get(el);
            if (e?.played && el.hasAttribute("data-split-lines")) {
              splitLines(el); // re-découpe sans rejouer l'animation
              el.querySelectorAll(".line").forEach((l) => (l.style.clipPath = "none"));
            }
          });
          build();
          ScrollTrigger.refresh();
        });
      });
    });

    // --- Icône (maillot n°10) : tracé à l'entrée (≈ casque Rive) ---
    const iconPaths = section.querySelectorAll("[data-impact-icon] path");
    const iconNumber = section.querySelector("[data-impact-icon] text");
    iconPaths.forEach((p) => {
      const len = p.getTotalLength();
      gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
    });
    gsap.set(iconNumber, { autoAlpha: 0, y: 6 });
    gsap
      .timeline({ scrollTrigger: { trigger: section.querySelector("[data-impact-icon]"), start: "top 90%", once: true } })
      .to(iconPaths, { strokeDashoffset: 0, duration: 1.2, ease: "power2.inOut", stagger: 0.1 })
      .to(iconNumber, { autoAlpha: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.6);

    // --- Marquages du terrain : tracés en scrub ---
    const circle = section.querySelector("[data-pitch-circle]");
    const spot = section.querySelector("[data-pitch-spot]");
    const halfway = section.querySelectorAll("[data-pitch-line]");
    if (circle) {
      const len = circle.getTotalLength();
      gsap.set(circle, { strokeDasharray: len, strokeDashoffset: len });
      gsap
        .timeline({
          scrollTrigger: { trigger: section, start: "top 75%", end: "center center", scrub: true },
        })
        .to(halfway, { scaleX: 1, ease: "power2.inOut", duration: 1 }, 0)
        .to(circle, { strokeDashoffset: 0, ease: "power1.inOut", duration: 1.2 }, 0.2)
        .fromTo(spot, { scale: 0 }, { scale: 1, ease: "back.out(3)", duration: 0.3, transformOrigin: "50% 50%" }, 1.1);
    }
  }

  initImpact();
})();
