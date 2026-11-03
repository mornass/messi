/* =========================================================
   PRELOADER — "LM10"
   1. lettres une par une  2. trait grenat  3. compteur 0 → 100 %
   4. sortie en rideau (clip-path) qui enchaîne sur l'entrée du hero

   API utilisée par hero.js :
     Preloader.setLoaded()  → les assets du hero sont prêts
     Preloader.onExit(cb)   → appelé quand le rideau commence à monter
     Preloader.onDone(cb)   → appelé quand le preloader a disparu
   ========================================================= */
window.Preloader = (() => {
  const el = document.querySelector("[data-preloader]");

  let resolveLoaded, resolveExit, resolveDone;
  const loaded = new Promise((r) => (resolveLoaded = r));
  const exit = new Promise((r) => (resolveExit = r));
  const done = new Promise((r) => (resolveDone = r));
  const api = {
    setLoaded: () => resolveLoaded(),
    onExit: (cb) => exit.then(cb),
    onDone: (cb) => done.then(cb),
  };

  if (!el || !window.gsap) {
    el?.remove();
    resolveExit();
    resolveDone();
    return api;
  }

  // toujours repartir du haut de la page
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);
  document.documentElement.classList.add("is-loading");

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const letters = el.querySelectorAll(".preloader-letter > span");
  const line = el.querySelector(".preloader-line path");
  const counterEl = el.querySelector("[data-preloader-count]");
  const counter = { value: 0 };
  const renderCount = () => (counterEl.textContent = Math.round(counter.value));

  const lineLength = line.getTotalLength();
  gsap.set(letters, { yPercent: 110 });
  gsap.set(line, { strokeDasharray: lineLength, strokeDashoffset: lineLength });
  gsap.set(".preloader-count", { autoAlpha: 0, y: 8 });

  // sécurité : si le hero ne signale rien, on sort quand même
  const failsafe = new Promise((r) => setTimeout(r, 6000));

  // on attend la police (max 400 ms) pour ne pas animer une police de secours
  const fontsReady = Promise.race([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((r) => setTimeout(r, 400)),
  ]);

  fontsReady.then(() => {
    const k = reduce ? 0.4 : 1; // durées réduites si "réduire les animations"

    // ---- Entrée ----
    const intro = gsap.timeline();
    intro
      .to(letters, { yPercent: 0, duration: 0.9 * k, stagger: 0.08 * k, ease: "power4.out" }, 0.1)
      .to(line, { strokeDashoffset: 0, duration: 0.9 * k, ease: "power2.inOut" }, 0.55 * k)
      .to(".preloader-count", { autoAlpha: 1, y: 0, duration: 0.5 * k, ease: "power3.out" }, 0.25 * k)
      .to(counter, { value: 90, duration: 1.3 * k, ease: "power2.inOut", onUpdate: renderCount }, 0.25 * k);

    // ---- Fin du compteur quand l'intro est jouée ET que le hero est prêt ----
    Promise.all([intro.then(), Promise.race([loaded, failsafe])]).then(() => {
      gsap.to(counter, {
        value: 100,
        duration: 0.3 * k,
        ease: "power1.out",
        onUpdate: renderCount,
        onComplete: leave,
      });
    });

    // ---- Sortie ----
    function leave() {
      const out = gsap.timeline({
        onComplete: () => {
          el.remove();
          document.documentElement.classList.remove("is-loading");
          resolveDone();
        },
      });
      out
        .to(".preloader-count", { autoAlpha: 0, y: -8, duration: 0.3, ease: "power2.in" }, 0)
        .to(line, { strokeDashoffset: -lineLength, duration: 0.5, ease: "power2.in" }, 0)
        .to(letters, { yPercent: -110, duration: 0.55, stagger: 0.05, ease: "power3.in" }, 0.05)
        // rideau : le bord bas remonte, légèrement arrondi
        .fromTo(
          el,
          { clipPath: "ellipse(150% 150% at 50% 0%)" },
          { clipPath: "ellipse(150% 0% at 50% 0%)", duration: 1, ease: "power4.inOut" },
          0.35
        )
        .call(resolveExit, null, 0.45); // le hero entre pendant que le rideau monte
    }
  });

  return api;
})();
