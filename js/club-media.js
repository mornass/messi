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
   - data-media-youtube="ID" / data-media-facebook="URL" : vidéo intégrée (API
     IFrame YouTube / SDK Facebook), muette, en boucle, sans interface visible ;
     data-media-poster = image de couverture pendant le chargement
     (data-media-poster-pos = son cadrage, ex. « 50% 70% ») ;
     data-media sert de repli
   - data-media-pos="50% 15%" : cadrage de la photo (object-position), ex. photo
     verticale dans un emplacement paysage

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
        if (slot.dataset.mediaPos) img.style.objectPosition = slot.dataset.mediaPos; // cadrage
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

  /* ---------- Vidéos intégrées (YouTube, Facebook) ----------
     Conteneur en overflow hidden : image de couverture derrière, lecteur
     agrandi (×1,2) pour couper titre et boutons, pointer-events: none, et
     lecteur invisible (opacity 0) jusqu'au début réel de la lecture. */
  const loadScript = (src) => new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.onload = ok; s.onerror = ko;
    document.head.appendChild(s);
  });
  function embedShell(slot) {
    const wrap = document.createElement("div");
    wrap.className = "media-embed";
    wrap.setAttribute("aria-hidden", "true");
    const poster = slot.dataset.mediaPoster;
    if (poster) {
      const img = new Image();
      img.className = "media-embed-poster";
      img.alt = "";
      img.decoding = "async";
      img.src = poster;
      if (slot.dataset.mediaPosterPos) img.style.objectPosition = slot.dataset.mediaPosterPos; // cadrage (photo verticale)
      wrap.appendChild(img);
    }
    const stage = document.createElement("div");
    stage.className = "media-embed-stage";
    wrap.appendChild(stage);
    slot.appendChild(wrap);
    return { wrap, stage };
  }

  // YouTube : API IFrame officielle
  let ytApi = null;
  const youtubeApi = () => ytApi || (ytApi = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    loadScript("https://www.youtube.com/iframe_api").catch(reject);
  }));
  function mountYoutube(slot, id) {
    return new Promise((resolve) => {
      const { wrap, stage } = embedShell(slot);
      const target = document.createElement("div");
      stage.appendChild(target);
      const fail = () => { resolve(null); };
      const timer = setTimeout(fail, 15000);
      youtubeApi().then((YT) => {
        const player = new YT.Player(target, {
          host: "https://www.youtube-nocookie.com",
          videoId: id,
          playerVars: {
            autoplay: 1, mute: 1, loop: 1, playlist: id, playsinline: 1, controls: 0, rel: 0,
            modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0, origin: location.origin,
          },
          events: {
            onReady: (e) => {
              clearTimeout(timer);
              e.target.mute();
              const f = e.target.getIframe();
              f.setAttribute("tabindex", "-1");
              f.title = "Vidéo";
              resolve({
                el: wrap,
                play: () => { player.mute(); player.playVideo(); },
                pause: () => player.pauseVideo(),
              });
            },
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.PLAYING) wrap.classList.add("is-playing");
              if (e.data === YT.PlayerState.ENDED) player.playVideo(); // boucle de secours
            },
            onError: () => wrap.classList.remove("is-playing"),
          },
        });
      }).catch(() => { clearTimeout(timer); fail(); });
    });
  }

  // Facebook : SDK officiel (lecteur vidéo intégré)
  let fbSdk = null;
  const facebookSdk = () => fbSdk || (fbSdk = new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    if (!document.getElementById("fb-root")) {
      const r = document.createElement("div");
      r.id = "fb-root";
      document.body.appendChild(r);
    }
    window.fbAsyncInit = () => {
      window.FB.init({ xfbml: false, version: "v19.0" });
      resolve(window.FB);
    };
    loadScript("https://connect.facebook.net/fr_FR/sdk.js").catch(reject);
  }));
  let fbCount = 0;
  function mountFacebook(slot, url) {
    return new Promise((resolve) => {
      const { wrap, stage } = embedShell(slot);
      const id = `fb-video-${++fbCount}`;
      const W = 1280; // largeur du lecteur ; mis à l'échelle en CSS pour couvrir le panneau
      stage.classList.add("is-facebook");
      stage.innerHTML = `<div class="fb-video" id="${id}" data-href="${url.replace(/"/g, "&quot;")}" data-width="${W}" data-autoplay="true" data-allowfullscreen="false" data-show-text="false" data-show-captions="false"></div>`;
      const fit = () => {
        const k = Math.max(wrap.clientWidth / W, wrap.clientHeight / (W * 9 / 16)) * 1.2;
        stage.style.setProperty("--fb-scale", k.toFixed(3));
      };
      fit();
      window.addEventListener("resize", fit);
      const timer = setTimeout(() => resolve(null), 15000);
      facebookSdk().then((FB) => {
        FB.Event.subscribe("xfbml.ready", (msg) => {
          if (msg.type !== "video" || msg.id !== id) return;
          clearTimeout(timer);
          const player = msg.instance;
          player.mute();
          player.subscribe("startedPlaying", () => wrap.classList.add("is-playing"));
          player.subscribe("finishedPlaying", () => { player.seek(0); player.play(); }); // boucle
          stage.querySelector("iframe")?.setAttribute("tabindex", "-1");
          resolve({ el: wrap, play: () => { player.mute(); player.play(); }, pause: () => player.pause() });
        });
        FB.XFBML.parse(stage);
      }).catch(() => { clearTimeout(timer); resolve(null); });
    });
  }

  function attach(section) {
    const slots = Array.from(section.querySelectorAll("[data-media]"));
    const state = new Map(); // slot → { el, video, want }
    slots.forEach((s) => state.set(s, { el: null, video: false, want: false }));
    let loading = false;

    const sync = (slot) => {
      const st = state.get(slot);
      if (!st.video || !st.el) return;
      if (st.embed) {
        if (st.want && !reduce) st.embed.play();
        else st.embed.pause();
        return;
      }
      if (st.want && !reduce) st.el.play().catch(() => {});
      else st.el.pause();
    };

    async function loadSlot(slot) {
      const yt = slot.dataset.mediaYoutube, fbv = slot.dataset.mediaFacebook;
      if (yt || fbv) {
        const embed = yt ? await mountYoutube(slot, yt) : await mountFacebook(slot, fbv);
        if (embed) {
          const st = state.get(slot);
          st.el = embed.el; st.video = true; st.embed = embed;
          slot.classList.add("is-loaded");
          sync(slot);
          return;
        }
        // échec (lecteur bloqué, vidéo non intégrable…) : on garde l'image de couverture
        const shell = slot.querySelector(".media-embed");
        shell?.querySelector(".media-embed-stage")?.remove();
        if (shell?.querySelector(".media-embed-poster")) {
          slot.classList.add("is-loaded");
          return;
        }
        shell?.remove(); // pas de couverture : repli sur data-media
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
