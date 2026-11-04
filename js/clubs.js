/* =========================================================
   2. CLUBS — port de la section "maillots" d'ousmaneballondor.fr (da())
   Une section par club, épinglée, scrub 1, durée = distance horizontale + 2000 px.

   Timeline (mêmes durées / eases que l'original) :
     0              nom du club tracé (contour puis remplissage) + maillot en fondu
     paths+0.3      bandes de tonte qui s'ouvrent depuis le centre
     paths+0.5      le nom s'efface
     paths+0.8      les deux chiffres arrivent (haut / bas)
     moveStart      la bande défile jusqu'à centrer le panneau C
     hold (1.2)     image révélée plein écran, maillot qui descend, textes 1 qui s'effacent
     +0.2           textes 2 qui montent (2 s)
   Pendant le passage du panneau B : parallaxe des photos (scrub 3 / 2),
   lettres du titre qui montent (toggle play / reverse).
   ========================================================= */
(() => {
  if (!window.gsap || !window.ScrollTrigger || !window.JerseyPlayer) return;
  gsap.registerPlugin(ScrollTrigger);

  const EXTRA_SCROLL = 2000;           // marge validée (original : 3000)
  const D = {
    paths: 1, pathsStagger: 0.1,       // zs, Bs
    nameDraw: 1.6, nameStagger: 0.14,  // tracé lettre par lettre, lié au scroll
    nameFill: 0.5,                     // remplissage une fois le contour fini
    jerseyIn: 0.8,                     // Vs
    nameOut: 0.5,                      // Gs
    digits: 0.8,                       // qs
    stripes: 1,                        // Xs
    move: 2,                           // Ns
    hold: 1.2,                         // Ds
    info2: 2,                          // Fs
  };
  const EASE_IO = "power2.inOut";      // Us
  const EASE_OUT = "power2.out";       // Hs
  const COVER_CLOSED = "polygon(25% 36%, 70% 36%, 70% 55%, 25% 55%)";
  const COVER_OPEN = "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)";
  const isMobile = () => window.innerWidth <= 991;

  /* -------------------------------------------------------
     PALETTES — une par club, à partir des couleurs du maillot
     (couleurs officielles → teintes profondes pour les fonds)
       base   : fond le plus sombre (bords, vignette)
       deep   : 1re couleur du club, assombrie (cœur des dégradés)
       second : 2e couleur du club (second halo, bandes de tonte alternées)
       accent : traits fins, soulignés
       spark  : 3e couleur / petits détails (points, traits courts)
       ink    : textes
       glow   : halo de l'image plein écran
       stage  : cœur du fond du panneau d'ouverture (derrière le maillot)
       name   : couleur du nom tracé derrière le maillot
     "site" = palette Barça du reste du site (avant le premier club).
     ------------------------------------------------------- */
  const PALETTES = {
    site:      { stage: "#0B1F3A", name: "#F6F5F0", base: "#0B1F3A", deep: "#0B1F3A", second: "#0B1F3A", accent: "#A50044", spark: "#A50044", ink: "#F6F5F0", glow: "#004D98" },
    // rouge #D7001E · noir #111111
    newells:   { stage: "#1A1314", name: "#D7001E", base: "#0A0909", deep: "#6E0614", second: "#111111", accent: "#D7001E", spark: "#D7001E", ink: "#F4F0EC", glow: "#8A0418" },
    // bleu #004D98 · grenat #A50044 · jaune #EDBB00
    barca:     { stage: "#004D98", name: "#EDBB00", base: "#061A36", deep: "#004D98", second: "#7A0033", accent: "#A50044", spark: "#EDBB00", ink: "#F6F5F0", glow: "#004D98" },
    // bleu marine #0A1F44 · rouge #DA291C
    psg:       { stage: "#14336B", name: "#DA291C", base: "#050F24", deep: "#14336B", second: "#8E1A12", accent: "#DA291C", spark: "#DA291C", ink: "#F4F3F0", glow: "#1A3A73" },
    // rose #F5B6CD · noir #111111
    miami:     { stage: "#161214", name: "#F5B6CD", base: "#0E0C0D", deep: "#6B3A4C", second: "#111111", accent: "#F5B6CD", spark: "#F5B6CD", ink: "#F7EFF2", glow: "#7A4358" },
    // bleu ciel #75AADB · blanc #FFFFFF
    argentine: { stage: "#3F6F9C", name: "#FFFFFF", base: "#0D2238", deep: "#3F6F9C", second: "#C9D9EA", accent: "#75AADB", spark: "#FFFFFF", ink: "#FFFFFF", glow: "#75AADB" },
  };
  const THEME_KEYS = ["base", "deep", "second", "accent", "spark", "ink", "glow", "stage", "name"];
  const DIP_KEYS = ["deep", "second", "glow", "stage"];   // teintes qui "plongent" dans le noir pendant la transition
  const THEME_DIP = "#08080A";
  const THEME_LAG = 0.8;                // lissage de la transition (s)
  let jerseyOwner = null;              // club qui contrôle le canvas du maillot

  const maxX = (wrapper) => Math.max(0, wrapper.scrollWidth - window.innerWidth);

  function splitLetters(el, cls = "ltr") {
    const text = el.textContent.trim();
    el.setAttribute("aria-label", text);
    el.innerHTML = text
      .split("")
      .map((c) => (c === " " ? `<span class="${cls} space" aria-hidden="true">&nbsp;</span>` : `<span class="${cls}" aria-hidden="true">${c}</span>`))
      .join("");
    return Array.from(el.querySelectorAll("." + cls));
  }

  function wrapClip(el) {
    const w = document.createElement("div");
    w.className = "club-clip";
    el.parentNode.insertBefore(w, el);
    w.appendChild(el);
  }

  // scrub "maison" : même lissage que ScrollTrigger (tween de progress, ease power3)
  function smoothProgress(anim, lag) {
    let tween;
    return (p) => {
      tween && tween.kill();
      tween = gsap.to(anim, { progress: p, duration: lag, ease: "power3", overwrite: true });
    };
  }

  function initClub(section) {
    const id = section.dataset.club;
    const wrapper = section.querySelector("[data-club-wrapper]");
    const open = section.querySelector("[data-club-open]");
    const nameSvg = open.querySelector("[data-club-name]");
    const nameParts = nameSvg.querySelectorAll("text, path");
    const pitch = open.querySelectorAll("[data-club-pitch] line, [data-club-pitch] circle:not(.is-spot)");
    const spot = open.querySelector("[data-club-pitch] .is-spot");
    const stripes = open.querySelector("[data-club-stripes]");
    const digits = open.querySelector("[data-club-number]")?.children || [];
    const gallery = section.querySelector("[data-club-gallery]");
    const immersion = section.querySelector("[data-club-immersion]");
    const cover = immersion.querySelector("[data-club-cover]");
    const coverFrame = immersion.querySelector("[data-club-cover-frame]");
    const coverVideo = cover.querySelector("video");
    const info1 = immersion.querySelector("[data-club-info1]");
    const info2 = immersion.querySelector("[data-club-info2]");

    const player = JerseyPlayer.get(section.closest("[data-clubs]"));
    if (!player) return;
    // maillot : une image de face (data-jersey-src), ou une séquence lue autour
    // de la face (data-jersey-frames="dossier" + data-jersey-range="début,fin,face")
    const ds = section.dataset;
    const spec = ds.jerseyFrames
      ? (() => {
          const [start, end, front] = (ds.jerseyRange || "1,152,1").split(",").map(Number);
          return { frames: { dir: ds.jerseyFrames, start, end, front, ext: ds.jerseyExt || "webp" } };
        })()
      : { src: ds.jerseySrc || `assets/maillots/maillot-${id}.png` };

    // ---------- états initiaux ----------
    // nom : une lettre = un <path> (vraie longueur) ; ancien <text> en repli
    nameParts.forEach((p) => {
      const len = p.getTotalLength ? Math.ceil(p.getTotalLength()) + 2 : 3000;
      gsap.set(p, { strokeDasharray: `${len} ${len}`, strokeDashoffset: len, fillOpacity: 0 });
    });
    pitch.forEach((p) => {
      const len = p.getTotalLength();
      gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
    });
    gsap.set(spot, { scale: 0, transformOrigin: "50% 50%" });
    if (digits.length >= 2) {
      gsap.set(digits[0], { yPercent: -100, opacity: 0 });
      gsap.set(digits[1], { yPercent: 100, opacity: 0 });
    }
    gsap.set(stripes, { width: "0%" });
    gsap.set(cover, { clipPath: COVER_CLOSED });
    gsap.set(info2, { yPercent: 200 });

    // titres du panneau C : lettres qui montent (desktop uniquement, comme l'original)
    let vLetters = [];
    if (!isMobile()) {
      immersion.querySelectorAll("[data-club-vtitle]").forEach((el) => {
        wrapClip(el);
        vLetters.push(...splitLetters(el));
      });
      gsap.set(vLetters, { yPercent: 150 });
    }
    // titre du panneau B
    const hTitle = gallery.querySelector("[data-club-htitle]");
    const hLetters = hTitle ? splitLetters(hTitle) : [];
    gsap.set(hLetters, { yPercent: 150 });

    // ---------- maillot (canvas global) ----------
    const jersey = { y: -50, o: 0 };
    let active = false;
    const applyJersey = () => {
      if (!active || jerseyOwner !== id) return;
      gsap.set(player.canvas, { xPercent: -50, yPercent: jersey.y, opacity: jersey.o });
    };
    // un seul canvas pour tous les clubs : seul le club "propriétaire" le pilote,
    // pour qu'une sortie tardive (saut via la barre) n'éteigne pas le club suivant
    const activate = async () => {
      active = true;
      jerseyOwner = id;
      document.documentElement.setAttribute("data-gl-covered", "");
      await player.load(id, spec);
      if (!active || jerseyOwner !== id || !player.setSection(id)) return;
      applyJersey();
      requestAnimationFrame(() => active && jerseyOwner === id && player.start());
    };
    const deactivate = () => {
      active = false;
      if (jerseyOwner !== id) return;
      jerseyOwner = null;
      document.documentElement.removeAttribute("data-gl-covered");
      player.stop();
      player.clear();
      gsap.set(player.canvas, { opacity: 0 });
    };

    // ---------- timeline principale ----------
    const extra = () => maxX(wrapper) + EXTRA_SCROLL;
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: () => `+=${extra()}`,
        scrub: 1,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });

    // nom : contour tracé lettre par lettre au fil du scroll (scrub → s'efface à l'envers
    // quand on remonte), puis remplissage une fois le contour fini
    // décalage entre formes réduit pour les noms très découpés (PSG : 17 formes) → même durée totale
    const stagger = nameParts.length > 1 ? Math.min(D.nameStagger, 1 / (nameParts.length - 1)) : 0;
    const drawEnd = D.nameDraw + (nameParts.length - 1) * stagger;
    tl.to(nameParts, { strokeDashoffset: 0, duration: D.nameDraw, stagger, ease: "power1.inOut" }, 0);
    tl.to(nameParts, { fillOpacity: 1, duration: D.nameFill, stagger: 0.04, ease: EASE_OUT }, drawEnd);
    tl.to(pitch, { strokeDashoffset: 0, duration: D.paths * 1.2, ease: EASE_IO }, 0);
    tl.to(spot, { scale: 1, duration: 0.3, ease: "back.out(3)" }, D.paths);
    const pathsComplete = drawEnd + D.nameFill;
    tl.add("pathsComplete", pathsComplete);
    tl.to(jersey, { o: 1, duration: D.jerseyIn, ease: EASE_IO, onUpdate: applyJersey }, 0);
    tl.to(nameSvg, { opacity: 0, duration: D.nameOut, ease: EASE_OUT }, "pathsComplete+=0.5");
    if (digits.length >= 2) {
      tl.to(digits, { yPercent: 0, opacity: 1, duration: D.digits, stagger: D.pathsStagger, ease: EASE_OUT }, "pathsComplete+=0.8");
    }
    tl.to(stripes, { width: "100%", duration: D.stripes, ease: EASE_IO }, "pathsComplete+=0.3");
    tl.add("moveStart");

    // position où le panneau C est centré (stickyX)
    const sticky = () => {
      const total = maxX(wrapper);
      let x = -(immersion.offsetLeft + immersion.offsetWidth / 2 - window.innerWidth / 2);
      x = Math.max(-total, Math.min(0, x));
      return { x, total, pre: Math.abs(x), post: Math.max(0, total - Math.abs(x)) };
    };
    const s0 = sticky();
    const preDur = s0.total ? D.move * (s0.pre / s0.total) : D.move;
    const postDur = s0.total ? D.move * (s0.post / s0.total) : 0;

    tl.to(wrapper, { x: () => sticky().x, duration: preDur, ease: "none" }, "moveStart");
    tl.to(wrapper, { x: () => sticky().x, duration: D.hold, ease: "none" }, ">");
    tl.to(cover, { clipPath: COVER_OPEN, duration: D.hold, ease: EASE_IO }, "<");
    tl.to(coverFrame, { opacity: 0, duration: D.hold * 0.4, ease: "none" }, "<");
    tl.to(jersey, {
      y: 125, o: 0, duration: D.hold, ease: EASE_IO, onUpdate: applyJersey,
    }, "<");
    tl.to(info1, { opacity: 0, duration: D.hold * 0.6, ease: "none" }, "<+=0.4");
    tl.to(wrapper, { x: () => -maxX(wrapper), duration: postDur, ease: "none" }, ">");
    tl.to(info2, { yPercent: 0, duration: D.info2, ease: EASE_OUT }, "+=0.2");

    // lettres du panneau C + vidéo éventuelle : quand le panneau arrive (≈ P de l'original)
    const lettersAt = tl.labels.moveStart + 0.97 * preDur;
    let lettersIn = false;
    tl.eventCallback("onUpdate", () => {
      const t = tl.time();
      if (t >= lettersAt && !lettersIn) {
        lettersIn = true;
        if (vLetters.length) gsap.to(vLetters, { yPercent: 0, duration: 0.8, ease: "expo.out", stagger: 0.04, overwrite: true });
        coverVideo?.play().catch(() => {});
      } else if (t < lettersAt && lettersIn) {
        lettersIn = false;
        if (vLetters.length) gsap.to(vLetters, { yPercent: 120, duration: 0.4, ease: "expo.out", stagger: 0.04, overwrite: true });
        coverVideo?.pause();
      }
      updateGallery();
    });

    // ---------- panneau B : parallaxe (≈ containerAnimation de l'original) ----------
    // Les déclencheurs sont calculés sur la position réelle du panneau à l'écran.
    const photosWrap = gallery.querySelector("[data-club-photos]");
    const photos = gallery.querySelectorAll("[data-club-photo]");
    const run = gallery.querySelector("[data-club-run]");
    gsap.set(photosWrap, { xPercent: 20 });
    gsap.set(photos, { xPercent: 50 });
    gsap.set(run, { clipPath: "inset(0 100% 0 0)" });

    const wrapAnim = gsap.to(photosWrap, { xPercent: -30, ease: "power1.out", paused: true });
    const photosAnim = gsap.to(photos, { xPercent: -50, ease: "power1.out", stagger: 0.05, paused: true });
    const runAnim = gsap.to(run, { clipPath: "inset(0 0% 0 0)", ease: "none", paused: true });
    const scrubWrap = smoothProgress(wrapAnim, 3);
    const scrubPhotos = smoothProgress(photosAnim, 2);
    const scrubRun = smoothProgress(runAnim, 1);
    const titleTl = gsap.to(hLetters, { yPercent: 0, duration: 1, ease: "expo.out", stagger: 0.01, paused: true });

    let lastP = -1;
    let titleIn = false;
    function updateGallery() {
      const x = gsap.getProperty(wrapper, "x");
      const left = gallery.offsetLeft + x;       // bord gauche du panneau à l'écran
      const w = gallery.offsetWidth;
      const vw = window.innerWidth;
      // start "left left" → end "right left-=25%"
      const p = gsap.utils.clamp(0, 1, -left / (w + 0.25 * vw));
      if (Math.abs(p - lastP) > 0.0005) {
        lastP = p;
        scrubWrap(p);
        scrubPhotos(p);
      }
      // course pointillée : se trace pendant que le panneau traverse l'écran
      const pr = gsap.utils.clamp(0, 1, (vw - left) / (w + vw * 0.2));
      scrubRun(pr);
      // titre : "left+=9% left", play / reverse
      const tIn = left <= -0.09 * w;
      if (tIn !== titleIn) {
        titleIn = tIn;
        tIn ? titleTl.play() : titleTl.reverse();
      }
    }

    // ---------- activation du maillot / préchargement ----------
    ScrollTrigger.create({
      trigger: section,
      start: "top top",
      end: () => `+=${extra()}`,
      onEnter: activate,
      onEnterBack: activate,
      onLeave: deactivate,
      onLeaveBack: deactivate,
    });
    // les images du maillot se chargent bien avant l'arrivée de la section
    ScrollTrigger.create({
      trigger: section,
      start: "top bottom+=150%",
      once: true,
      onEnter: () => player.load(id, spec),
    });
  }

  /* -------------------------------------------------------
     BARRE DES CLUBS (≈ .nav-c de l'original)
     - liens révélés à l'arrivée du bloc (≈ [h-fadeup] : y 120% → 0, 1 s, stagger .07, power3.out)
     - couleur de la barre = couleur du club en cours (tween .35 s power2.out, comme Ys())
     - lien actif souligné ; clic → lenis.scrollTo(début du club, 1.5 s, expo)
     ------------------------------------------------------- */
  const NAV_EASE = (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)); // Ma de l'original

  function initNav(block) {
    const nav = block.querySelector("[data-clubs-nav]");
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll("[data-club-link]"));
    const pins = new Map(); // id → ScrollTrigger épinglé du club

    ScrollTrigger.getAll().forEach((st) => {
      const id = st.trigger?.dataset?.club;
      if (id && st.pin) pins.set(id, st);
    });

    // défilement jusqu'au début d'un club (barre, carte du hero, footer…)
    const jump = (id) => {
      const st = pins.get(id);
      if (!st) return false;
      const y = st.start + 1; // juste après le début : le club est déjà épinglé
      if (window.lenis) window.lenis.scrollTo(y, { duration: 1.5, easing: NAV_EASE });
      else window.scrollTo({ top: y, behavior: "smooth" });
      history.replaceState(null, "", `#${id}`);
      return true;
    };
    window.scrollToClub = jump;

    links.forEach((a) => {
      if (!pins.has(a.dataset.clubLink)) {
        a.classList.add("is-soon");
        a.setAttribute("aria-disabled", "true");
        a.tabIndex = -1;
      }
      a.addEventListener("click", (e) => {
        e.preventDefault();
        jump(a.dataset.clubLink);
      });
    });
    // tout autre lien vers un club, ailleurs dans la page : <a href="#miami" data-club-jump="miami">
    document.querySelectorAll("[data-club-jump]").forEach((a) => {
      a.addEventListener("click", (e) => {
        if (jump(a.dataset.clubJump)) e.preventDefault();
      });
    });

    let current = null;
    const setActive = (id) => {
      current = id;
      links.forEach((a) => a.classList.toggle("is-active", a.dataset.clubLink === id));
    };

    // club actif = celui dont la piste (épinglage) contient le scroll
    pins.forEach((st, id) => {
      ScrollTrigger.create({
        trigger: st.trigger,
        start: () => st.start - 1,
        end: () => st.end,
        onToggle: (self) => {
          if (self.isActive) setActive(id);
          else if (current === id) setActive(null);
        },
      });
    });

    // apparition des noms à l'arrivée du bloc
    const spans = links.map((a) => a.querySelector("span"));
    gsap.set(spans, { yPercent: 120 });
    gsap.to(spans, {
      yPercent: 0,
      duration: 1,
      stagger: 0.07,
      ease: "power3.out",
      scrollTrigger: { trigger: block, start: "top 70%", toggleActions: "play none none reverse" },
    });
  }

  /* -------------------------------------------------------
     THÈME DU BLOC — les couleurs suivent le club affiché.
     Position continue t : 0 = palette du site, 1 = 1er club, 2 = 2e club…
     Chaque club "arrive" pendant que son haut monte du bas au haut de l'écran
     (au moment où le club précédent sort) : t avance de 0 à 1 sur ce trajet.
     t est lissé par GSAP, puis les 5 couleurs sont interpolées et posées en
     variables CSS sur le bloc (tout le reste en dérive en CSS).
     ------------------------------------------------------- */
  function initTheme(block) {
    const sections = Array.from(block.querySelectorAll("[data-club]"));
    if (!sections.length) return;
    const stops = [PALETTES.site, ...sections.map((s) => PALETTES[s.dataset.club] || PALETTES.site)];
    const state = { t: 0 };
    let lastKey = "";

    const apply = () => {
      const i = Math.max(0, Math.min(stops.length - 2, Math.floor(state.t)));
      const f = gsap.utils.clamp(0, 1, state.t - i);
      const key = i + ":" + f.toFixed(4);
      if (key === lastKey) return;
      lastKey = key;
      const a = stops[i], b = stops[i + 1];
      THEME_KEYS.forEach((k) => {
        let c;
        if (DIP_KEYS.includes(k)) {
          // les couleurs de club passent par le noir à mi-chemin (pas de violet boueux entre rouge et bleu)
          c = f < 0.5
            ? gsap.utils.interpolate(a[k], THEME_DIP, f * 2)
            : gsap.utils.interpolate(THEME_DIP, b[k], (f - 0.5) * 2);
        } else {
          c = gsap.utils.interpolate(a[k], b[k], f);
        }
        block.style.setProperty(`--c-${k}`, c);
      });
    };

    const target = () => {
      const vh = window.innerHeight;
      return sections.reduce((t, s) => t + gsap.utils.clamp(0, 1, (vh - s.getBoundingClientRect().top) / vh), 0);
    };

    let first = true;
    const update = () => {
      const t = target();
      if (first) {
        first = false;
        state.t = t;
        apply();
        return;
      }
      gsap.to(state, { t, duration: THEME_LAG, ease: "power3.out", overwrite: true, onUpdate: apply });
    };

    ScrollTrigger.create({
      trigger: block,
      start: "top bottom",
      end: "bottom top",
      onUpdate: update,
      onRefresh: update,
    });
    update();
  }

  const start = () => {
    document.querySelectorAll("[data-club]").forEach(initClub);
    document.querySelectorAll("[data-clubs]").forEach(initNav);
    document.querySelectorAll("[data-clubs]").forEach(initTheme);
    ScrollTrigger.refresh();
  };
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(start);
})();
