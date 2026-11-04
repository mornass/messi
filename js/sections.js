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

  /* -------------------------------------------------------
     FIN DE PAGE — « Coup de sifflet final »
       - « LM10 » (scène collée, scrub) : contour tracé lettre par lettre,
         puis rempli de marine depuis le bas ; surtitre et « Merci Leo » en fondu
       - pied : liens et chiffres en fondu à l'arrivée
       - liens : défilement doux vers la section (clubs : scrollToClub)
       - ballon « Retour en haut » : frappé, remonte la page, rejoue l'intro du hero
     Le fond (blanc cassé + curseur fluide) est géré par js/background.js.
     ------------------------------------------------------- */
  function initFooter() {
    const footer = document.querySelector("[data-footer]");
    if (!footer) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---- finale LM10 ----
    const finale = footer.querySelector("[data-finale]");
    const strokes = Array.from(footer.querySelectorAll("[data-finale-stroke] path"));
    const fill = footer.querySelector("[data-finale-fill]");
    const fades = footer.querySelectorAll("[data-finale-fade]");
    if (finale && !reduce) {
      strokes.forEach((p) => {
        const len = Math.ceil(p.getTotalLength()) + 2;
        gsap.set(p, { strokeDasharray: `${len} ${len}`, strokeDashoffset: len });
      });
      gsap.set(fill, { scaleY: 0, transformOrigin: "50% 100%" });
      gsap.set(fades, { autoAlpha: 0, y: 24 });
      gsap
        .timeline({
          defaults: { ease: "none" },
          // calculé après les épinglages au-dessus (clubs, Ballons d'Or)
          scrollTrigger: { trigger: finale, start: "top 70%", end: "bottom bottom", scrub: 1, refreshPriority: -1 },
        })
        .to(fades[0], { autoAlpha: 1, y: 0, duration: 0.25, ease: "power2.out" }, 0)
        .to(strokes, { strokeDashoffset: 0, duration: 0.55, stagger: 0.12, ease: "power1.inOut" }, 0.05)
        .to(fill, { scaleY: 1, duration: 0.4, ease: "power2.inOut" }, 0.75)
        .to(fades[1], { autoAlpha: 1, y: 0, duration: 0.2, ease: "power2.out" }, 1)
        .to({}, { duration: 0.15 });
    }

    // ---- pied ----
    const reveals = footer.querySelectorAll(".footer-reveal, .footer-link, .footer-bottom");
    if (!reduce) {
      gsap.set(reveals, { autoAlpha: 0, y: 24 });
      ScrollTrigger.batch(reveals, {
        start: "top 92%",
        refreshPriority: -1,
        onEnter: (els) => gsap.to(els, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.07, ease: "power3.out", overwrite: true }),
        onLeaveBack: (els) => gsap.to(els, { autoAlpha: 0, y: 24, duration: 0.3, overwrite: true }),
      });
    }

    // ---- liens vers les sections ----
    const EASE = (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t));
    footer.querySelectorAll("[data-footer-link]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const id = a.dataset.footerLink;
        if (window.scrollToClub && document.querySelector(`[data-club="${id}"]`)) return window.scrollToClub(id);
        const el = id === "top" ? 0 : document.getElementById(id);
        if (window.lenis) window.lenis.scrollTo(el, { duration: 2, easing: EASE });
        else if (el === 0) window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
        else el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
        history.replaceState(null, "", id === "top" ? location.pathname : `#${id}`);
      });
    });

    // ---- ballon « Retour en haut » ----
    const up = footer.querySelector("[data-footer-up]");
    up?.addEventListener("click", () => {
      history.replaceState(null, "", location.pathname);
      document.querySelector("[data-topbar-brand]")?.focus({ preventScroll: true }); // le clavier repart du haut
      if (reduce) {
        window.scrollTo(0, 0);
        return;
      }
      up.classList.add("is-kicked");
      setTimeout(() => up.classList.remove("is-kicked"), 1200);
      const done = () => window.heroReplay?.();
      if (window.lenis) window.lenis.scrollTo(0, { duration: 2.4, easing: (t) => 1 - Math.pow(1 - t, 4), onComplete: done });
      else {
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(done, 1200);
      }
    });
  }

  initImpact();
  initFooter();
})();
