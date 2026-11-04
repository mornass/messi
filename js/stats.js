/* =========================================================
   4. EN CHIFFRES
   - la feuille claire monte par-dessus la section noire : coins arrondis
     et léger retrait qui s'effacent au scroll
   - titre : révélation ligne par ligne (même effet que le manifeste)
   - les 672 buts au Barça : un point par but, une colonne par saison
     (somme vérifiée = 672) ; remplissage au scroll + compteur 0 → 672 ;
     colonne record 2011-12 (73 buts) en bleu Barça
   - les 8 records : révélation de landonorris.com (data-stat-list :
     découpe inset + bloc de couleur qui se retire, cascade), puis compteur
   - médias (vidéo ou photo) : js/club-media.js, chargés à l'approche
   ========================================================= */
(() => {
  const section = document.querySelector("[data-stats]");
  if (!section || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // buts avec le FC Barcelone, par saison (2004-05 → 2020-21)
  const SEASONS = [
    ["04-05", 1], ["05-06", 8], ["06-07", 17], ["07-08", 16], ["08-09", 38], ["09-10", 47],
    ["10-11", 53], ["11-12", 73], ["12-13", 60], ["13-14", 41], ["14-15", 58], ["15-16", 41],
    ["16-17", 54], ["17-18", 45], ["18-19", 51], ["19-20", 31], ["20-21", 38],
  ];
  const TOTAL = SEASONS.reduce((n, s) => n + s[1], 0); // 672
  const RECORD = 7; // 2011-12

  // l'initialisation attend les polices (comme les autres sections), pour des mesures justes
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(init);

  function init() {
    /* ---------- 1. la feuille arrive ---------- */
    const sheet = section.querySelector("[data-stats-sheet]");
    gsap.fromTo(sheet, { borderRadius: "3rem 3rem 0 0", scaleX: 0.94 }, {
      borderRadius: "0rem 0rem 0 0",
      scaleX: 1,
      ease: "none",
      scrollTrigger: { trigger: section, start: "top bottom", end: "top 20%", scrub: true },
    });

    /* ---------- 2. titre ---------- */
    const title = section.querySelector("[data-stats-title]");
    if (window.MessiUtils && !reduce) {
      const tl = MessiUtils.highLines(title);
      ScrollTrigger.create({ trigger: title, start: "top 85%", once: true, onEnter: () => tl.play() });
    }

    /* ---------- 3. les 672 buts ---------- */
    const chart = section.querySelector("[data-stats-chart]");
    const countEl = section.querySelector("[data-stats-goals-n]");
    let dots = [], cols = [], shown = 0;

    function build() {
      const mobile = window.innerWidth <= 767;
      const per = mobile ? 3 : 5;     // points par rangée, dans une colonne
      const p = 10, r = mobile ? 3.6 : 3.4, gap = p * 1.6;
      const colW = per * p;
      const rows = Math.ceil(73 / per);
      const W = SEASONS.length * colW + (SEASONS.length - 1) * gap;
      // taille du texte en unités du dessin, pour ~11 px à l'écran
      const px = Math.max(0.1, W / Math.max(1, chart.clientWidth));
      const fs = 11 * px;
      const top = fs * 2.2, bottom = fs * 2.6;
      const H = top + rows * p + bottom;
      let svg = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
      SEASONS.forEach(([label, n], c) => {
        const x0 = c * (colW + gap);
        svg += `<g class="col${c === RECORD ? " is-record" : ""}" data-col="${c}">`;
        for (let i = 0; i < n; i++) {
          const row = Math.floor(i / per), k = i % per;
          const cx = x0 + k * p + p / 2;
          const cy = top + (rows - row - 1) * p + p / 2;
          svg += `<circle class="dot" cx="${cx}" cy="${cy}" r="${r}" />`;
        }
        const yTop = top + (rows - Math.ceil(n / per)) * p - fs * 0.6;
        const lab = mobile ? label.slice(0, 2) : label;
        svg += `<text class="value" x="${x0 + colW / 2}" y="${yTop}" text-anchor="middle" style="font-size:${fs}px">${c === RECORD ? n + " ★" : n}</text>`;
        svg += `<text class="season" x="${x0 + colW / 2}" y="${H - fs * 0.6}" text-anchor="middle" style="font-size:${fs}px">${lab}</text>`;
        svg += `</g>`;
      });
      chart.innerHTML = svg + "</svg>";
      dots = Array.from(chart.querySelectorAll(".dot"));
      cols = Array.from(chart.querySelectorAll(".col"));
      const keep = shown;
      shown = 0;
      paint(keep);
    }

    // allume / éteint les points de façon incrémentale (rien n'est retouché inutilement)
    function paint(n) {
      n = Math.max(0, Math.min(TOTAL, Math.round(n)));
      if (n > shown) for (let i = shown; i < n; i++) dots[i].classList.add("is-on");
      else for (let i = n; i < shown; i++) dots[i].classList.remove("is-on");
      shown = n;
      countEl.textContent = n;
      let acc = 0;
      cols.forEach((g, c) => {
        acc += SEASONS[c][1];
        g.classList.toggle("is-done", n >= acc);
      });
    }

    build();
    let lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      build();
    });
    if (reduce) paint(TOTAL);
    else
      ScrollTrigger.create({
        trigger: chart,
        start: "top 80%",
        end: "bottom 50%",
        scrub: 0.6,
        onUpdate: (self) => paint(self.progress * TOTAL),
      });

    /* ---------- 4. les 8 records (révélation landonorris.com) ---------- */
    const list = section.querySelector("[data-stat-list]");
    const items = Array.from(list.querySelectorAll("[data-stat-item]"));
    const count = (el) => {
      const target = +el.dataset.count;
      if (reduce) return (el.textContent = target);
      const o = { v: 0 };
      gsap.to(o, { v: target, duration: target > 100 ? 1.8 : 1.3, ease: "power3.out", onUpdate: () => (el.textContent = Math.round(o.v)) });
    };
    const reveal = gsap.timeline({ paused: true });
    items.forEach((item, i) => {
      if (reduce) return;
      const block = document.createElement("div");
      block.className = "item-reveal";
      Object.assign(block.style, { position: "absolute", inset: "0", background: "var(--barca)", transformOrigin: "right center", zIndex: "5" });
      item.appendChild(block);
      gsap.set(item, { clipPath: "inset(0 100% 0 0)" });
      const at = i * 0.08;
      reveal.to(item, { clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "power2.out" }, at);
      reveal.to(block, { scaleX: 0, duration: 0.6, ease: "power2.inOut" }, at + 0.3);
      reveal.call(() => count(item.querySelector("[data-count]")), null, at + 0.45);
    });
    if (reduce) items.forEach((it) => count(it.querySelector("[data-count]")));
    else ScrollTrigger.create({ trigger: list, start: "top 85%", once: true, onEnter: () => reveal.play() });

    /* ---------- 5. médias ---------- */
    if (window.ClubMedia) {
      const media = ClubMedia.attach(section);
      ScrollTrigger.create({ trigger: section, start: "top bottom+=100%", once: true, onEnter: () => media.load() });
      ScrollTrigger.create({ trigger: list, start: "top bottom", end: "bottom top", onToggle: (self) => media.setGallery(self.isActive) });
    }
    ScrollTrigger.refresh();
  }
})();
