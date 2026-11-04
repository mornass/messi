/* =========================================================
   MÉDIAS DES CLUBS — photos et vidéos de la galerie et du plein écran
   Chaque emplacement porte son fichier dans le HTML :
     <div class="club-photo-media ph" data-media="assets/clubs/barca/barca-photo-1.jpg">
     <div class="club-cover-media ph" data-media="…-cover.mp4" data-media-fallback="…-cover.jpg"
          data-media-role="cover">
   - rien n'est téléchargé avant que le club approche (load() appelé par js/clubs.js)
   - vidéos : sans son, en boucle, en ligne (iOS), lues seulement quand le club
     est à l'écran ; en pause sinon ("réduire les animations" : jamais lues)
   - fichier absent : le placeholder reste affiché (fallback essayé d'abord)
   - data-media-youtube="ID" : lecteur YouTube intégré (youtube-nocookie, muet,
     en boucle, sans contrôles), prioritaire ; data-media sert alors de repli

   API (utilisée par js/clubs.js) :
     const media = ClubMedia.attach(section)
     media.load() · media.setGallery(true|false) · media.setCover(true|false)
     media.setSlot(élément, true|false)   (un seul emplacement)
   ========================================================= */
window.ClubMedia = (() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isVideo = (url) => /\.(mp4|webm|mov)(\?|$)/i.test(url);

  function mountImage(slot, url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.alt = slot.closest("figure")?.querySelector("figcaption")?.textContent.trim() || "";
      img.onload = () => {
        slot.appendChild(img);
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function mountVideo(slot, url) {
    return new Promise((resolve) => {
      const v = document.createElement("video");
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      v.setAttribute("aria-hidden", "true");
      v.preload = "auto";
      const done = (ok) => {
        v.onloadeddata = v.onerror = null;
        if (!ok) {
          v.removeAttribute("src");
          v.load();
          return resolve(null);
        }
        slot.appendChild(v);
        resolve(v);
      };
      v.onloadeddata = () => done(true);
      v.onerror = () => done(false);
      v.src = url;
    });
  }

  // Lecteur YouTube intégré : muet, en boucle, sans contrôles ; piloté par postMessage
  function mountYoutube(slot, id) {
    return new Promise((resolve) => {
      const f = document.createElement("iframe");
      const q = new URLSearchParams({
        autoplay: "0", mute: "1", controls: "0", loop: "1", playlist: id, playsinline: "1",
        rel: "0", modestbranding: "1", iv_load_policy: "3", disablekb: "1", enablejsapi: "1",
        origin: location.origin,
      });
      f.className = "media-yt";
      f.src = `https://www.youtube-nocookie.com/embed/${id}?${q}`;
      f.title = "Vidéo";
      f.allow = "autoplay; encrypted-media; picture-in-picture";
      f.setAttribute("tabindex", "-1");
      f.setAttribute("aria-hidden", "true");
      const timer = setTimeout(() => { f.remove(); resolve(null); }, 12000);
      f.addEventListener("load", () => {
        clearTimeout(timer);
        // laisse le lecteur s'initialiser avant d'accepter des commandes
        setTimeout(() => resolve(f), 700);
      }, { once: true });
      slot.appendChild(f);
    });
  }
  const ytCommand = (f, func) => f.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");

  function attach(section) {
    const slots = Array.from(section.querySelectorAll("[data-media]"));
    const state = new Map(); // slot → { el, video, want }
    slots.forEach((s) => state.set(s, { el: null, video: false, want: false }));
    let loading = false;

    const sync = (slot) => {
      const st = state.get(slot);
      if (!st.video || !st.el) return;
      if (st.yt) {
        if (st.want && !reduce) { ytCommand(st.el, "mute"); ytCommand(st.el, "playVideo"); }
        else ytCommand(st.el, "pauseVideo");
        return;
      }
      if (st.want && !reduce) st.el.play().catch(() => {});
      else st.el.pause();
    };

    async function loadSlot(slot) {
      const yt = slot.dataset.mediaYoutube;
      if (yt) {
        const f = await mountYoutube(slot, yt);
        if (f) {
          const st = state.get(slot);
          st.el = f; st.video = true; st.yt = true;
          slot.classList.add("is-loaded");
          sync(slot);
          return;
        }
      }
      const url = slot.dataset.media;
      let el = isVideo(url) ? await mountVideo(slot, url) : await mountImage(slot, url);
      const fb = slot.dataset.mediaFallback;
      if (!el && fb) el = isVideo(fb) ? await mountVideo(slot, fb) : await mountImage(slot, fb);
      if (!el) {
        slot.classList.add("is-missing"); // placeholder conservé
        return;
      }
      const st = state.get(slot);
      st.el = el;
      st.video = el.tagName === "VIDEO";
      slot.classList.add("is-loaded");
      sync(slot);
    }

    const setRole = (cover, on) =>
      slots.forEach((s) => {
        if ((s.dataset.mediaRole === "cover") !== cover) return;
        state.get(s).want = on;
        sync(s);
      });

    return {
      load() {
        if (loading) return;
        loading = true;
        slots.forEach(loadSlot);
      },
      setGallery: (on) => setRole(false, on),
      setCover: (on) => setRole(true, on),
      // lecture d'un seul emplacement (ex. la fiche affichée dans la section Ballons d'Or)
      setSlot(slot, on) {
        const st = state.get(slot);
        if (!st || st.want === on) return;
        st.want = on;
        sync(slot);
      },
    };
  }

  return { attach };
})();
