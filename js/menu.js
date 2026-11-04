/* =========================================================
   MENU PLEIN ÉCRAN — chorégraphie reprise de landonorris.com
   Ouverture (timeline, 0 → ~1,2 s) :
     0     fond : ellipse depuis le haut (0,8 s, power3.out)
     0,15  images : ellipse + montée, en cascade (0,06 s)
     0,35  liens : ellipse + montée, léger rebond (back.out(1.2), cascade 0,08 s)
     0,4   trait ondulé grenat sous la section en cours
     0,55  liens des clubs + pied ; 0,6 motif du terrain (opacité 0,1)
   Fermeture : même timeline à l'envers, 1,5 × plus vite.
   Pendant l'ouverture : scroll gelé (Lenis), colonnes d'images qui suivent
   la souris en sens opposés, image en couleur au survol de son lien.
   Clic sur un lien : le menu se ferme, puis défilement vers la section.
   ========================================================= */
(() => {
  const btn = document.querySelector("[data-menu-btn]");
  const menu = document.querySelector("[data-menu]");
  if (!btn || !menu || !window.gsap) return;

  const OPEN = "ellipse(120% 100% at 50% 20%)";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const bg = menu.querySelector("[data-menu-bg]");
  const cols = Array.from(menu.querySelectorAll("[data-menu-col]"));
  const imgs = Array.from(menu.querySelectorAll("[data-menu-img]")).sort((a, b) => a.dataset.menuImg - b.dataset.menuImg);
  const links = Array.from(menu.querySelectorAll("[data-menu-link]"));
  const subs = menu.querySelectorAll("[data-menu-sub]");
  const focusables = () => [btn, ...menu.querySelectorAll("a[href]")];

  // ---------- états initiaux ----------
  gsap.set(menu, { clipPath: "ellipse(120% 0% at 50% 0%)" });
  gsap.set(imgs, { clipPath: "ellipse(120% 0% at 50% 0%)", y: 25 });
  gsap.set(links, { clipPath: "ellipse(30% 0% at 50% 0%)", y: 20 });
  gsap.set(bg, { autoAlpha: 0 });
  gsap.set(subs, { autoAlpha: 0, y: 10 });

  // ---------- section en cours (trait ondulé) ----------
  const targets = {
    top: () => document.querySelector("[data-hero-track]"),
    manifeste: () => document.getElementById("manifeste"),
    newells: () => document.querySelector("[data-clubs]"),
    "ballons-dor": () => document.getElementById("ballons-dor"),
    merci: () => document.getElementById("merci"),
  };
  let wavePath = null;
  function markCurrent() {
    let current = "top";
    for (const [id, get] of Object.entries(targets)) {
      const el = get();
      if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.4) current = id;
    }
    links.forEach((a) => a.classList.toggle("is-current", a.dataset.menuLink === current));
    const link = links.find((a) => a.dataset.menuLink === current);
    wavePath = link?.querySelector(".menu-link-wave path") || null;
    if (wavePath) {
      const len = wavePath.getTotalLength();
      gsap.set(wavePath, { strokeDasharray: len, strokeDashoffset: len });
    }
  }

  // ---------- timeline ----------
  let isOpen = false;
  let pending = null; // section à rejoindre une fois le menu fermé
  const tl = gsap.timeline({
    paused: true,
    onStart: () => {
      menu.hidden = false;
      window.lenis?.stop();
      document.documentElement.classList.add("menu-open");
    },
    onReverseComplete: () => {
      menu.hidden = true;
      document.documentElement.classList.remove("menu-open");
      window.lenis?.start();
      gsap.to(cols, { y: 0, duration: 0.3, ease: "power2.inOut" });
      imgs.forEach((f) => f.classList.remove("is-hot"));
      if (pending) {
        go(pending);
        pending = null;
      }
    },
  });
  tl.to(menu, { clipPath: OPEN, duration: 0.8, ease: "power3.out" }, 0)
    .to(imgs, { clipPath: OPEN, y: 0, duration: 0.8, stagger: 0.06, ease: "power3.out" }, 0.15)
    .to(links, { clipPath: OPEN, y: 0, duration: 0.6, stagger: 0.08, ease: "back.out(1.2)" }, 0.35)
    .to(subs, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.05, ease: "power3.out" }, 0.55)
    .to(bg, { autoAlpha: 0.1, duration: 0.6 }, 0.6);
  // trait ondulé : ajouté à chaque ouverture sur le lien de la section en cours
  let waveTween = null;

  function open() {
    if (isOpen) return;
    isOpen = true;
    markCurrent();
    waveTween?.kill();
    if (wavePath) waveTween = gsap.to(wavePath, { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut", delay: reduce ? 0 : 0.4 });
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "Fermer le menu");
    tl.timeScale(reduce ? 3 : 1).play();
    setTimeout(() => links[0]?.focus({ preventScroll: true }), 450);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Ouvrir le menu");
    tl.timeScale(reduce ? 4 : 1.5).reverse();
    btn.focus({ preventScroll: true });
  }

  // ---------- navigation ----------
  const EASE = (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t));
  function go(id) {
    if (window.scrollToClub && document.querySelector(`[data-club="${id}"]`)) {
      window.scrollToClub(id);
      return;
    }
    const el = id === "top" ? 0 : document.getElementById(id);
    if (window.lenis) window.lenis.scrollTo(el, { duration: 1.6, easing: EASE });
    else if (el === 0) window.scrollTo({ top: 0, behavior: "smooth" });
    else el?.scrollIntoView({ behavior: "smooth" });
    history.replaceState(null, "", id === "top" ? location.pathname : `#${id}`);
  }
  menu.querySelectorAll("[data-menu-link], [data-menu-club]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      pending = a.dataset.menuLink || a.dataset.menuClub;
      close();
    });
  });

  btn.addEventListener("click", () => (isOpen ? close() : open()));
  document.addEventListener("keydown", (e) => {
    if (!isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      // le focus reste dans le menu
      const f = focusables();
      const i = f.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
      e.preventDefault();
      f[next].focus();
    }
  });

  // ---------- survol : image en couleur ----------
  links.forEach((a) => {
    const target = imgs.find((f) => f.dataset.menuImg === a.dataset.menuImgTarget);
    const on = () => target?.classList.add("is-hot");
    const off = () => target?.classList.remove("is-hot");
    a.addEventListener("pointerenter", on);
    a.addEventListener("pointerleave", off);
    a.addEventListener("focus", on);
    a.addEventListener("blur", off);
  });

  // ---------- colonnes d'images qui suivent la souris (sens opposés, ±6rem) ----------
  if (cols.length === 2 && !reduce) {
    document.addEventListener("mousemove", (e) => {
      if (!isOpen) return;
      const v = (e.clientY / window.innerHeight - 0.5) * 2 * 6;
      gsap.to(cols[0], { y: `${-v}rem`, duration: 2, ease: "power2.out", overwrite: "auto" });
      gsap.to(cols[1], { y: `${v}rem`, duration: 2, ease: "power2.out", overwrite: "auto" });
    }, { passive: true });
  }
})();
