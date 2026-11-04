/* =========================================================
   HERO / INTERFACE
   - data/hero.json : « Prochain match » (si date à venir, sinon « Club actuel »)
     et les 3 chiffres de la carte stats
   - carte stats + invitation « Défiler » : apparaissent et disparaissent avec
     la carte du hero (intro, premier pixel de scroll) ; compteurs à l'apparition
   - barre du haut : LM10 + nom de la section en cours ; couleur qui suit la
     section (masquée sur les clubs, qui ont leur barre)
   - indicateur de scroll : progression dans la page, bord droit
   ========================================================= */
(() => {
  if (!window.gsap) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s) => document.querySelector(s);

  /* ---------- 1. données : prochain match + stats ---------- */
  const card = $("[data-match-card]");
  const statsCard = $("[data-hero-stats]");
  const cue = $("[data-hero-cue]");
  // remplace seulement le texte d'une ligne (le bloc de révélation reste en place)
  const setLine = (key, text) => {
    const el = card?.querySelector(`[data-card="${key}"]`);
    const node = el && [...el.childNodes].find((n) => n.nodeType === 3);
    if (node) node.nodeValue = text;
  };

  function applyData(data) {
    const m = data?.nextMatch;
    const when = m?.date ? new Date(m.date) : null;
    if (m?.opponent && when && !isNaN(when) && when > new Date()) {
      const day = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(when);
      const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(when);
      setLine("top", "Prochain match");
      setLine("a1", `vs ${m.opponent}`);
      setLine("a2", m.competition || "");
      setLine("b1", day);
      setLine("b2", time);
      setLine("b3", m.venue || "");
      card.querySelector('[data-card="link"]')?.setAttribute(
        "aria-label",
        `Prochain match : contre ${m.opponent}${m.competition ? ", " + m.competition : ""}, ${day} à ${time}`
      );
    }
    const st = data?.stats;
    if (st?.items?.length && statsCard) {
      statsCard.querySelector("[data-stats-title]").textContent = st.title || "";
      statsCard.querySelector("[data-hero-stats-list]").innerHTML = st.items
        .slice(0, 3)
        .map((it) => `<li><span class="hero-stats-n" data-n="${+it.value || 0}">${+it.value || 0}</span><span class="eyebrow eyebrow--muted">${String(it.label || "").replace(/</g, "&lt;")}</span></li>`)
        .join("");
    }
  }
  fetch("data/hero.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then(applyData)
    .catch(() => {}); // fichier absent / file:// : la carte garde son contenu par défaut

  /* ---------- 2. carte stats + « Défiler » suivent la carte du hero ---------- */
  let counted = false;
  function countUp() {
    if (counted || !statsCard) return;
    counted = true;
    statsCard.querySelectorAll("[data-n]").forEach((el, i) => {
      const target = +el.dataset.n;
      if (reduce) return (el.textContent = target);
      const o = { v: 0 };
      gsap.to(o, { v: target, duration: 1.4, delay: 0.25 + i * 0.12, ease: "power3.out", onUpdate: () => (el.textContent = Math.round(o.v)) });
    });
  }
  if (cue) gsap.set(cue, { autoAlpha: 0 });
  function mirror() {
    const hidden = card.classList.contains("is-hidden");
    statsCard?.classList.toggle("is-hidden", hidden);
    if (cue) gsap.to(cue, { autoAlpha: hidden ? 0 : 1, duration: hidden ? 0.25 : 0.6, delay: hidden ? 0 : 0.6, overwrite: true });
    if (!hidden) countUp();
  }
  if (card) new MutationObserver(mirror).observe(card, { attributes: true, attributeFilter: ["class"] });

  /* ---------- 3. barre du haut ---------- */
  const bar = $("[data-topbar]");
  const label = $("[data-topbar-label]");
  const SECTIONS = [
    { el: () => $("[data-hero-track]"), name: "Accueil", ink: "#0B1F3A" },
    { el: () => $("#manifeste"), name: "Manifeste", ink: "#F6F5F0" },
    { el: () => $("[data-clubs]"), name: "Les clubs", ink: null }, // barre des clubs à la place
    { el: () => $("#ballons-dor"), name: "Ballons d'Or", ink: "#E8D3A2" },
    { el: () => $("#chiffres"), name: "En chiffres", ink: "#0B1F3A" },
    { el: () => $("#merci"), name: "Merci Leo", ink: "#F6F5F0" },
  ];
  let current = null;
  function setSection(sec) {
    if (sec === current) return;
    const prev = current;
    current = sec;
    if (!sec.ink) {
      gsap.to(bar, { autoAlpha: 0, duration: 0.3, overwrite: "auto" });
      return;
    }
    gsap.to(bar, { autoAlpha: 1, "--bar-ink": sec.ink, duration: 0.5, ease: "power2.out", overwrite: "auto" });
    if (!prev || prev.name === sec.name) {
      label.textContent = sec.name;
      return;
    }
    if (reduce) {
      label.textContent = sec.name;
      return;
    }
    // le nom sort par le haut, le nouveau monte par le bas
    gsap.timeline()
      .to(label, { yPercent: -110, duration: 0.25, ease: "power2.in" })
      .call(() => (label.textContent = sec.name))
      .fromTo(label, { yPercent: 110 }, { yPercent: 0, duration: 0.4, ease: "power3.out" });
  }
  function updateSection() {
    const probe = 40; // hauteur de la barre
    let found = SECTIONS[0];
    for (const s of SECTIONS) {
      const r = s.el()?.getBoundingClientRect();
      if (r && r.top <= probe && r.bottom > probe) found = s;
    }
    // tout en bas : le footer, trop court pour atteindre le haut de l'écran
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (window.scrollY >= max - 4) found = SECTIONS[SECTIONS.length - 1];
    setSection(found);
  }
  $("[data-topbar-brand]")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (window.lenis) window.lenis.scrollTo(0, { duration: 1.6 });
    else window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });

  /* ---------- 4. indicateur de scroll ---------- */
  const ind = $("[data-scroll-indicator]");
  const indBar = $("[data-scroll-bar]");
  let shown = false;
  function updateIndicator() {
    const sh = document.documentElement.scrollHeight, vh = window.innerHeight;
    const max = Math.max(1, sh - vh);
    const p = Math.min(1, Math.max(0, window.scrollY / max));
    const trackH = ind.clientHeight;
    const barH = trackH * Math.min(0.25, Math.max(0.1, vh / sh));
    indBar.style.height = `${barH}px`;
    indBar.style.transform = `translate3d(0, ${p * (trackH - barH)}px, 0)`;
    const show = window.scrollY > 2 && !document.documentElement.classList.contains("menu-open");
    if (show !== shown) {
      shown = show;
      gsap.to(ind, { opacity: show ? 1 : 0, duration: 0.4, overwrite: true });
    }
  }

  // une seule boucle légère, déclenchée par le scroll (Lenis ou natif)
  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      updateSection();
      updateIndicator();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  window.lenis?.on?.("scroll", onScroll);
  new MutationObserver(onScroll).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  onScroll();
})();
