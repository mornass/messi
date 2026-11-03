/* =========================================================
   Utilitaires partagés (texte)
   - splitLines(el) : découpe en lignes réelles (selon le retour à la ligne),
                      en gardant <strong>/<em>
   - highLines(el)  : "high-line reveal" de l'original — chaque ligne s'ouvre
                      (clip-path) pendant qu'un bloc de couleur se retire
   ========================================================= */
window.MessiUtils = (() => {
  const COLORS = {
    barca: "var(--barca)",
    navy: "var(--navy)",
    offwhite: "var(--offwhite)",
    grenat: "var(--grenat)",
  };

  function splitLines(el) {
    if (el._splitSource === undefined) el._splitSource = el.innerHTML;
    el.innerHTML = el._splitSource;

    // 1. mots (on garde la balise d'origine pour <strong>, <em>…)
    const tokens = [];
    el.childNodes.forEach((node) => {
      const tag = node.nodeType === 1 ? node.tagName.toLowerCase() : null;
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) tokens.push({ space: true });
        else tokens.push({ text: part, tag });
      });
    });

    el.innerHTML = "";
    const words = [];
    let pendingSpace = false;
    tokens.forEach((t) => {
      if (t.space) {
        el.appendChild(document.createTextNode(" "));
        pendingSpace = true;
        return;
      }
      const w = document.createElement("span");
      w.className = "word";
      // une espace seulement s'il y en avait une dans le texte (pas devant "." collé à un <strong>)
      w._spaceBefore = pendingSpace;
      pendingSpace = false;
      if (t.tag) {
        const inner = document.createElement(t.tag);
        inner.textContent = t.text;
        w.appendChild(inner);
      } else {
        w.textContent = t.text;
      }
      el.appendChild(w);
      words.push(w);
    });

    // 2. regroupement par position verticale
    const lines = [];
    let top = null;
    words.forEach((w) => {
      const y = w.offsetTop;
      if (top === null || Math.abs(y - top) > 2) {
        lines.push([]);
        top = y;
      }
      lines[lines.length - 1].push(w);
    });

    // 3. reconstruction en .line
    el.innerHTML = "";
    lines.forEach((ws) => {
      const line = document.createElement("span");
      line.className = "line";
      ws.forEach((w, i) => {
        if (i > 0 && w._spaceBefore) line.appendChild(document.createTextNode(" "));
        line.appendChild(w);
      });
      el.appendChild(line);
    });
    return el.querySelectorAll(".line");
  }

  // data-anim-high="right, barca"  (direction, couleur) — mêmes durées que l'original
  function highLines(el, onComplete) {
    const [dirRaw, colorRaw] = (el.getAttribute("data-anim-high") || "right, barca").split(",").map((s) => s.trim());
    const fromRight = dirRaw !== "left";
    const color = COLORS[colorRaw] || COLORS.barca;
    const Q = 0.6, B = 0.6, E = 0.15;

    const tl = gsap.timeline({ paused: true, onComplete });
    el.querySelectorAll(".line").forEach((line, i) => {
      line.style.position = "relative";
      gsap.set(line, { clipPath: fromRight ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)", autoAlpha: 1 });
      const block = document.createElement("div");
      block.className = "high-line-reveal";
      Object.assign(block.style, {
        position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
        backgroundColor: color, transformOrigin: fromRight ? "right center" : "left center", zIndex: "5",
      });
      line.appendChild(block);
      gsap.set(block, { scaleX: 1 });
      const at = i * E;
      tl.to(line, { clipPath: fromRight ? "inset(0 0% 0 0)" : "inset(0 0 0 0%)", duration: Q, ease: "power2.out" }, at);
      tl.to(block, { scaleX: 0, duration: B, ease: "power2.inOut" }, at + Q / 2);
    });
    return tl;
  }

  return { splitLines, highLines };
})();
