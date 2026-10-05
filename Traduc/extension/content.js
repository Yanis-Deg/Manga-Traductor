/**
 * Manga Translator AI & Local - Content Script
 * Détecte les scans de manga/webtoon et superpose les traductions avec un ancrage parfait.
 * Inclut : Traduction en lot (tout le chapitre), optimisation ultra-rapide (downscale 1200px),
 * et adaptation dynamique de la taille des bulles pour le français.
 */

(function () {
  if (window.__mangaTranslatorInitialized) return;
  window.__mangaTranslatorInitialized = true;

  console.log("[MangaTranslator] Content script actif !");

  let isOverlayVisible = true;
  let activeOverlays = []; // Liste des overlayLayers
  let cropModeActive = false;
  let isBatchTranslating = false;
  let cancelBatchRequested = false;

  // Gestion dynamique de l'opacité des bulles en temps réel via variable CSS
  function applyBubbleOpacity(val) {
    const num = Number(val);
    const opacity = (isNaN(num) ? 95 : Math.max(10, Math.min(100, num))) / 100;
    document.documentElement.style.setProperty("--manga-bubble-opacity", opacity.toString());
  }

  chrome.storage.local.get({ bubbleOpacity: 95 }, (res) => {
    applyBubbleOpacity(res.bubbleOpacity);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.bubbleOpacity) {
      applyBubbleOpacity(changes.bubbleOpacity.newValue);
    }
  });

  // Création du conteneur de notifications (toasts)
  const toastContainer = document.createElement("div");
  toastContainer.id = "manga-toast-container";
  document.body.appendChild(toastContainer);

  function showToast(title, message, type = "info", duration = 4000, actions = null) {
    const toast = document.createElement("div");
    toast.className = `manga-toast ${type}`;

    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "warning") icon = "⚠️";
    if (type === "error") icon = "❌";

    toast.innerHTML = `
      <div class="manga-toast-icon">${icon}</div>
      <div class="manga-toast-content">
        <div class="manga-toast-title">${title}</div>
        <div class="manga-toast-msg">${message}</div>
      </div>
      <div class="manga-toast-close">&times;</div>
    `;

    if (actions && Array.isArray(actions)) {
      const actContainer = document.createElement("div");
      for (const act of actions) {
        const btn = document.createElement("button");
        btn.className = act.className || "manga-toast-cancel-btn";
        btn.textContent = act.label;
        btn.addEventListener("click", () => act.onClick(toast));
        actContainer.appendChild(btn);
      }
      toast.querySelector(".manga-toast-content").appendChild(actContainer);
    }

    toast.querySelector(".manga-toast-close").addEventListener("click", () => {
      toast.remove();
    });

    toastContainer.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(50px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
    return toast;
  }

  /**
   * Récupère la véritable URL de l'image (support lazy-loading très fréquent sur les lecteurs de scan)
   */
  function getRealImageSource(img) {
    if (!img) return "";

    const candidates = [
      img.getAttribute("data-src"),
      img.getAttribute("data-lazy-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-url"),
      img.getAttribute("data-full-url"),
      img.getAttribute("data-lazy"),
      img.dataset ? img.dataset.src : null,
      img.dataset ? img.dataset.original : null,
      img.dataset ? img.dataset.lazySrc : null,
      img.currentSrc,
      img.src
    ];

    for (const src of candidates) {
      if (src && typeof src === "string") {
        const trimmed = src.trim();
        // Ignorer les placeholders SVG vides, 1x1 base64, ou gifs de chargement
        if (
          trimmed !== "" &&
          !trimmed.startsWith("data:image/svg+xml") &&
          !trimmed.includes("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7") &&
          !trimmed.endsWith("loading.gif") &&
          !trimmed.endsWith("placeholder.png")
        ) {
          return trimmed;
        }
      }
    }
    return img.currentSrc || img.src || "";
  }

  /**
   * Détecte si un élément <img> est un véritable scan de manga/webtoon dans le chapitre.
   * Élimine strictement les bannières de crédits (ex: credits-mgeko.png), logos, publicités et illustrations non-manga.
   */
  function isScanCandidate(img) {
    if (!img) return false;

    // 1. Rejeter formellement les éléments d'interface (header, navbar, footer, avatars, commentaires, pubs)
    if (img.closest("header, nav, footer, .sidebar, .comments, .avatar, #header, #footer, .ad, .advertisement, #disqus_thread, .comment-respond, .user-avatar, .nav-links, .social-share, .logo, .banner-ad, #disqus_recommendations, .footer")) {
      return false;
    }

    const realSrc = getRealImageSource(img);
    if (!realSrc) return false;

    // 2. Rejeter formellement les crédits de sites, pubs, bannières, logos, avatars, icônes, boutons
    const isExcludedPattern = /(credits?|banner|promo|radioads|vline|advert|donation|patreon|discord|recruitment|watermark|logo|avatar|icon|spinner|loading|button|badge|placeholder|favicon)/i;
    const id = img.id || "";
    const className = (typeof img.className === "string") ? img.className : "";
    const alt = img.alt || "";

    if (isExcludedPattern.test(realSrc) || isExcludedPattern.test(id) || isExcludedPattern.test(className) || isExcludedPattern.test(alt)) {
      return false;
    }

    // 3. Dimensions physiques et ratio d'aspect
    const naturalW = img.naturalWidth || 0;
    const naturalH = img.naturalHeight || 0;
    const rect = img.getBoundingClientRect();
    const dispW = rect.width || img.offsetWidth || 0;
    const dispH = rect.height || img.offsetHeight || 0;

    // Si l'image est déjà chargée en mémoire avec ses dimensions
    if (img.complete && naturalW > 0 && naturalH > 0) {
      // Trop petite pour être une page de scan (ex: séparateur ou icône)
      if (naturalW < 200 && naturalH < 200) return false;
      // Ratio d'aspect absurde pour un manga (ex: bannière ultra-large 1200x60 ou barre verticale 10x800)
      const ratio = naturalW / naturalH;
      if (ratio > 3.8 || ratio < 0.18) return false;
    } else if (dispW > 0 && dispH > 0) {
      if (dispW < 200 && dispH < 200) return false;
      const dispRatio = dispW / dispH;
      if (dispRatio > 3.8 || dispRatio < 0.18) return false;
    }

    // 4. Critères positifs d'identification d'une page de scan de manga :
    // A. Identifiant ou classe typique de scan (ex: id="image-1" sur mgeko.cc)
    const hasScanIdOrClass = (
      /^(image|page|scan|chapter)-?\d+$/i.test(id) ||
      /(image|page|scan|chapter)-?\d+/i.test(id) ||
      /(chapter|manga|reader|page|scan)-?(img|image|content|pic)/i.test(className) ||
      /wp-manga-chapter-img|reading-content-img|page-image/i.test(className)
    );
    if (hasScanIdOrClass) return true;

    // B. Image située à l'intérieur d'un conteneur de lecture de scan
    const isInsideReader = Boolean(
      img.closest(
        "#reader, #chapter-container, .reading-content, .reader-area, .page-break, #chapter-images, " +
        ".container-chapter-reader, .chapter-content, .viewer, .scan-page, .iv-card, #image-container, " +
        ".reader-images, .manga-reader, #readarea, .read-container, .chapter-images"
      )
    );
    if (isInsideReader) {
      return true;
    }

    // C. URL de scan de manga explicite avec dimensions minimales
    const isImageFile = /\.(jpe?g|webp|png|avif)(\?.*)?$/i.test(realSrc);
    const hasMangaUrlKeywords = /(upload|manga|chapter|scans?|imgsrv|mangaraw|cdn|read|comic)/i.test(realSrc);
    if (isImageFile && hasMangaUrlKeywords && (naturalW >= 300 || naturalH >= 300 || dispW >= 300 || dispH >= 300)) {
      return true;
    }

    return false;
  }

  /**
   * Détecte TOUTES les images de scans éligibles sur la page (y compris hors-écran et lazy-loaded)
   */
  function getEligibleMangaImages() {
    const allImages = Array.from(document.querySelectorAll("img"));
    return allImages.filter(isScanCandidate);
  }

  /**
   * S'assure qu'une image distante est chargée en mémoire avant analyse (sans blocage)
   */
  async function ensureImageLoaded(img) {
    if (!img) return false;

    // 1. Déjà complètement chargée avec dimensions réelles de scan
    if (img.complete && (img.naturalWidth >= 200 || img.offsetWidth >= 200)) {
      return true;
    }

    const realSrc = getRealImageSource(img);
    if (!realSrc) return false;

    // Désactiver le chargement différé natif
    img.setAttribute("loading", "eager");
    if (img.src !== realSrc) {
      img.src = realSrc;
    }

    // Décodage natif ultra-rapide si supporté par le navigateur
    if (typeof img.decode === "function") {
      try {
        await Promise.race([
          img.decode(),
          new Promise(r => setTimeout(r, 1500))
        ]);
        if (img.complete && (img.naturalWidth >= 200 || img.offsetWidth >= 200)) {
          return true;
        }
      } catch (_) {}
    }

    if (img.complete && (img.naturalWidth >= 200 || img.offsetWidth >= 200)) {
      return true;
    }

    return new Promise((resolve) => {
      let timeoutId = setTimeout(() => {
        cleanup();
        resolve(true);
      }, 2000);

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        img.removeEventListener("load", onDone);
        img.removeEventListener("error", onDone);
      };

      const onDone = () => {
        cleanup();
        resolve(true);
      };

      img.addEventListener("load", onDone, { once: true });
      img.addEventListener("error", onDone, { once: true });
    });
  }

  /**
   * Tente un export direct par canvas en local (prend 2ms si même domaine ou CORS direct)
   */
  function tryDirectCanvasExport(img) {
    try {
      if (!img.complete || img.naturalWidth <= 50 || img.naturalHeight <= 50) {
        return null;
      }
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const maxW = 1280;
      const maxH = 3600;

      let scale = 1.0;
      if (w > maxW) scale = maxW / w;
      if (h * scale > maxH) {
        const scaleH = maxH / h;
        if (w * scaleH >= 750) scale = scaleH;
        else scale = Math.max(750 / w, scaleH);
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.85);
    } catch (_) {
      // CORS restreint (Tainted canvas) -> bascule sur le background
      return null;
    }
  }

  /**
   * Optimisation ultra-rapide côté client :
   * Redimensionne l'image sans bloquer et préserve la netteté du texte (largeur >= 750px).
   */
  async function getOptimizedImageBase64(img) {
    // 1. Tenter l'export direct instantané (2ms)
    const directBase64 = tryDirectCanvasExport(img);
    if (directBase64) {
      return directBase64;
    }

    const realSrc = getRealImageSource(img);
    if (!realSrc) throw new Error("Source de l'image introuvable.");

    // Transformer en URL absolue si nécessaire (pour fetch dans le background)
    let absoluteUrl = realSrc;
    try {
      absoluteUrl = new URL(realSrc, window.location.href).href;
    } catch (_) {}

    // Récupérer les données de l'image via background si cross-origin
    let sourceData = absoluteUrl;
    if (!absoluteUrl.startsWith("data:image")) {
      const resp = await chrome.runtime.sendMessage({
        action: "FETCH_IMAGE_BASE64",
        url: absoluteUrl
      });
      if (!resp || !resp.success) {
        throw new Error(resp ? resp.error : "Impossible de charger les données du scan.");
      }
      sourceData = resp.data;
    }

    // Si le service worker a déjà optimisé l'image en base64 JPEG, la renvoyer directement (évite la double compression)
    if (sourceData && typeof sourceData === "string" && sourceData.startsWith("data:image/")) {
      return sourceData;
    }

    return new Promise((resolve) => {
      let isDone = false;
      // Sécurité absolue : timeout de 2.5s pour ne JAMAIS geler la traduction
      const timeoutId = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          resolve(sourceData);
        }
      }, 2500);

      const temp = new Image();
      temp.onload = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutId);

        let w = temp.naturalWidth || temp.width;
        let h = temp.naturalHeight || temp.height;

        if (w <= 0 || h <= 0) {
          resolve(sourceData);
          return;
        }

        const maxW = 1280;
        const maxH = 3600;

        let scale = 1.0;
        if (w > maxW) {
          scale = maxW / w;
        }
        if (h * scale > maxH) {
          const scaleH = maxH / h;
          if (w * scaleH >= 750) {
            scale = scaleH;
          } else {
            scale = Math.max(750 / w, scaleH);
          }
        }

        const finalW = Math.round(w * scale);
        const finalH = Math.round(h * scale);

        try {
          const canvas = document.createElement("canvas");
          canvas.width = finalW;
          canvas.height = finalH;
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(temp, 0, 0, finalW, finalH);

          const optimized = canvas.toDataURL("image/jpeg", 0.85);
          resolve(optimized);
        } catch (_) {
          resolve(sourceData);
        }
      };

      temp.onerror = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutId);
        resolve(sourceData);
      };

      temp.src = sourceData;
    });
  }

  /**
   * Trouve le scan qui occupe la plus grande surface visible à l'écran
   */
  function getMostVisibleMangaImage() {
    const images = getEligibleMangaImages();
    if (images.length === 0) return null;

    const vpW = window.innerWidth || document.documentElement.clientWidth;
    const vpH = window.innerHeight || document.documentElement.clientHeight;

    let bestImg = null;
    let maxVisibleArea = -1;

    for (const img of images) {
      const rect = img.getBoundingClientRect();

      // Intersection entre l'image et l'écran actuel
      const visibleLeft = Math.max(0, rect.left);
      const visibleTop = Math.max(0, rect.top);
      const visibleRight = Math.min(vpW, rect.right);
      const visibleBottom = Math.min(vpH, rect.bottom);

      const visibleW = Math.max(0, visibleRight - visibleLeft);
      const visibleH = Math.max(0, visibleBottom - visibleTop);
      const visibleArea = visibleW * visibleH;

      if (visibleArea > maxVisibleArea) {
        maxVisibleArea = visibleArea;
        bestImg = img;
      }
    }

    if (!bestImg || maxVisibleArea <= 0) {
      let minDist = Infinity;
      const centerY = vpH / 2;
      for (const img of images) {
        const rect = img.getBoundingClientRect();
        const imgCenter = rect.top + rect.height / 2;
        const dist = Math.abs(centerY - imgCenter);
        if (dist < minDist) {
          minDist = dist;
          bestImg = img;
        }
      }
    }

    return bestImg || images[0];
  }

  /**
   * Crée ou récupère le wrapper dédié autour de l'image
   */
  function getOrCreateWrapper(img) {
    let wrapper = img.parentElement;
    if (wrapper && wrapper.classList.contains("manga-wrapper-box")) {
      return wrapper;
    }

    wrapper = document.createElement("div");
    wrapper.className = "manga-wrapper-box";

    const compDisplay = window.getComputedStyle(img).display;
    if (compDisplay === "block" || compDisplay === "flex") {
      wrapper.classList.add("block-display");
    }

    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);

    attachHoverBadgeToWrapper(wrapper, img);
    return wrapper;
  }

  /**
   * Bouton de survol épinglé en haut à droite du scan
   */
  function attachHoverBadgeToWrapper(wrapper, img) {
    if (wrapper.querySelector(".manga-hover-action-btn")) return;

    const badge = document.createElement("div");
    badge.className = "manga-hover-action-btn";
    badge.innerHTML = `<span>🌐 Traduire ce scan</span>`;
    badge.style.display = "none";

    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      translateMangaImage(img);
    });

    wrapper.appendChild(badge);

    wrapper.addEventListener("mouseenter", () => {
      badge.style.display = "flex";
    });
    wrapper.addEventListener("mouseleave", () => {
      badge.style.display = "none";
    });
  }

  function prepareAllMangaScans() {
    const images = getEligibleMangaImages();
    for (const img of images) {
      if (!img.parentElement || !img.parentElement.classList.contains("manga-wrapper-box")) {
        getOrCreateWrapper(img);
      }
    }
  }

  const observer = new MutationObserver(() => {
    prepareAllMangaScans();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  prepareAllMangaScans();

  /**
   * Traduit le scan le plus visible à l'écran
   */
  async function translateCurrentVisiblePage() {
    const img = getMostVisibleMangaImage();
    if (!img) {
      showToast("Aucun scan détecté", "Faites défiler la page jusqu'au scan de manga et réessayez.", "warning");
      return;
    }
    await translateMangaImage(img);
  }

  /**
   * Traduit le scan suivant dans le chapitre
   */
  async function translateNextScan() {
    const images = getEligibleMangaImages();
    const current = getMostVisibleMangaImage();
    if (!current || images.length === 0) return;

    const idx = images.indexOf(current);
    if (idx !== -1 && idx + 1 < images.length) {
      const nextImg = images[idx + 1];
      nextImg.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => translateMangaImage(nextImg), 500);
    } else {
      showToast("Fin du chapitre", "Aucun scan suivant détecté sur cette page.", "info");
    }
  }

  /**
   * Traduit TOUS les scans du chapitre en un seul clic !
   */
  async function translateAllChapterScans() {
    if (isBatchTranslating) {
      showToast("Traduction en cours", "La traduction du chapitre est déjà en train de tourner.", "info");
      return;
    }

    const allImages = getEligibleMangaImages();
    if (allImages.length === 0) {
      showToast("Aucun scan détecté", "Aucune page de scan n'a été détectée sur cette page de lecture.", "warning");
      return;
    }

    const toTranslate = allImages.filter(img => img.dataset.mangaTranslated !== "true");

    if (toTranslate.length === 0) {
      showToast("Déjà traduit", `Tous les ${allImages.length} scans de ce chapitre sont déjà traduits !`, "success", 3000);
      return;
    }

    isBatchTranslating = true;
    cancelBatchRequested = false;

    let progressToast = showToast(
      "📚 Traduction du chapitre en cours...",
      `Démarrage de la traduction (0 / ${toTranslate.length} scans)...`,
      "info",
      0,
      [
        {
          label: "Arrêter",
          onClick: (t) => {
            cancelBatchRequested = true;
            t.remove();
            showToast("Arrêt demandé", "La traduction s'arrêtera au scan en cours.", "warning", 2500);
          }
        }
      ]
    );

    let completed = 0;
    let failed = 0;

    for (let i = 0; i < toTranslate.length; i++) {
      if (cancelBatchRequested) {
        break;
      }

      const img = toTranslate[i];

      if (progressToast) {
        const msgEl = progressToast.querySelector(".manga-toast-msg");
        if (msgEl) {
          msgEl.textContent = `Traduction du scan ${i + 1} sur ${toTranslate.length}...`;
        }
      }

      try {
        // Faire défiler vers le scan pour que l'utilisateur suive la traduction
        img.scrollIntoView({ behavior: "smooth", block: "center" });

        // Traduire le scan (translateMangaImage gère le chargement)
        await translateMangaImage(img, false);
        completed++;
      } catch (err) {
        console.warn(`[MangaTranslator] Échec sur le scan ${i + 1}:`, err);
        failed++;
      }

      // Pause de 700ms pour respecter les quotas de l'API Gemini et éviter les 503/429
      if (i + 1 < toTranslate.length && !cancelBatchRequested) {
        await new Promise(r => setTimeout(r, 700));
      }
    }

    isBatchTranslating = false;
    if (progressToast) progressToast.remove();

    if (cancelBatchRequested) {
      showToast("Traduction interrompue", `${completed} scans traduits sur ${toTranslate.length}.`, "warning", 4000);
    } else if (failed > 0 && completed === 0) {
      showToast("Erreur", "Impossible de traduire les scans. Vérifiez votre clé API ou modèle.", "error", 5000);
    } else {
      showToast("🎉 Chapitre traduit !", `Les ${completed} scans du chapitre sont prêts à la lecture !`, "success", 5000);
    }
  }

  /**
   * Traduit un scan d'image précis
   */
  async function translateMangaImage(img, showNotification = true) {
    // S'assurer que le scan est chargé en mémoire avant l'analyse
    await ensureImageLoaded(img);

    const wrapper = getOrCreateWrapper(img);

    img.classList.add("manga-scan-target-highlight");
    setTimeout(() => img.classList.remove("manga-scan-target-highlight"), 2500);

    let toast = null;
    if (showNotification) {
      toast = showToast("Analyse du scan...", "Extraction des dialogues et traduction...", "info", 0);
    }

    try {
      // 1. Récupération optimisée (downscale rapide à 1200px pour un temps de réponse divisé par 4)
      const base64 = await getOptimizedImageBase64(img);

      // 2. Appel au background
      const transResp = await chrome.runtime.sendMessage({
        action: "TRANSLATE_IMAGE",
        imageBase64: base64
      });

      if (toast) toast.remove();

      if (!transResp || !transResp.success) {
        throw new Error(transResp ? transResp.error : "Échec de la traduction.");
      }

      const bubbles = transResp.bubbles || [];

      if (bubbles.length === 0) {
        // Marquer comme traité pour que 'Tout Traduire' n'essaie pas de retraduire en boucle
        img.dataset.mangaTranslated = "true";
        if (showNotification) {
          showToast(
            "Scan analysé",
            "Cette page ne contient aucun dialogue (illustration visuelle ou double page d'action).",
            "info",
            3500
          );
        }
        return;
      }

      img.dataset.mangaTranslated = "true";

      // 3. Superposer les bulles avec dimensionnement adaptatif
      renderBubblesOnImage(img, wrapper, bubbles, transResp.engineName);

      if (showNotification) {
        if (transResp.notice) {
          showToast(
            "Traduit (Secours Local)",
            `⚡ ${bubbles.length} bulles traduites avec le serveur local !\n(${transResp.notice})`,
            "warning",
            5000
          );
        } else {
          showToast(
            "Scan traduit !",
            `✨ ${bubbles.length} bulles traduites avec ${transResp.engineName}.`,
            "success",
            3000
          );
        }
      }
    } catch (err) {
      if (toast) toast.remove();
      console.error("[MangaTranslator] Erreur:", err);
      if (showNotification) {
        showToast("Erreur de traduction", err.message, "error", 6000);
      }
      throw err;
    }
  }

  /**
   * Insère les bulles traduites avec adaptation dynamique de la taille pour le français
   */
  /**
   * Ajoute les poignées interactives de redimensionnement manuel sur la bulle
   * Permet d'agrandir en largeur (gauche/droite) et en longueur/hauteur (vers le bas) à la souris.
   */
  function attachBubbleResizers(bubbleDiv) {
    // 1. Poignée coin inférieur droit (largeur + hauteur)
    const cornerResizer = document.createElement("div");
    cornerResizer.className = "manga-bubble-resizer";
    cornerResizer.title = "Glisser pour redimensionner (largeur & hauteur) • Double-clic : +25%";

    // 2. Poignée bord droit (élargir vers la droite)
    const rightResizer = document.createElement("div");
    rightResizer.className = "manga-bubble-resizer-w";
    rightResizer.title = "Glisser pour élargir vers la droite";

    // 3. Poignée bord gauche (élargir vers la gauche)
    const leftResizer = document.createElement("div");
    leftResizer.className = "manga-bubble-resizer-left";
    leftResizer.title = "Glisser pour élargir vers la gauche";

    // Gestion du glisser-déposer pour le coin et le bord droit
    const handleDragRight = (e, resizeW, resizeH) => {
      e.stopPropagation();
      e.preventDefault();

      bubbleDiv.classList.add("is-resizing");
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = bubbleDiv.offsetWidth;
      const startH = bubbleDiv.offsetHeight;

      const onMouseMove = (moveEvt) => {
        moveEvt.preventDefault();
        if (resizeW) {
          const dx = moveEvt.clientX - startX;
          const newW = Math.max(30, startW + dx);
          bubbleDiv.style.width = `${newW}px`;
        }
        if (resizeH) {
          const dy = moveEvt.clientY - startY;
          const newH = Math.max(20, startH + dy);
          bubbleDiv.style.minHeight = `${newH}px`;
          bubbleDiv.style.height = `${newH}px`;
        }
      };

      const onMouseUp = (upEvt) => {
        upEvt.stopPropagation();
        bubbleDiv.classList.remove("is-resizing");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    // Gestion du glisser-déposer pour le bord gauche (élargissement vers la gauche)
    const handleDragLeft = (e) => {
      e.stopPropagation();
      e.preventDefault();

      bubbleDiv.classList.add("is-resizing");
      const startX = e.clientX;
      const startW = bubbleDiv.offsetWidth;
      const startLeft = bubbleDiv.offsetLeft;

      const onMouseMove = (moveEvt) => {
        moveEvt.preventDefault();
        const dx = startX - moveEvt.clientX;
        const newW = Math.max(30, startW + dx);
        bubbleDiv.style.width = `${newW}px`;
        bubbleDiv.style.left = `${startLeft - dx}px`;
      };

      const onMouseUp = (upEvt) => {
        upEvt.stopPropagation();
        bubbleDiv.classList.remove("is-resizing");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    cornerResizer.addEventListener("mousedown", (e) => handleDragRight(e, true, true));
    rightResizer.addEventListener("mousedown", (e) => handleDragRight(e, true, false));
    leftResizer.addEventListener("mousedown", handleDragLeft);

    // Double-clic pour un agrandissement rapide (+25%)
    cornerResizer.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const curW = bubbleDiv.offsetWidth;
      bubbleDiv.style.width = `${Math.round(curW * 1.25)}px`;
    });

    bubbleDiv.appendChild(cornerResizer);
    bubbleDiv.appendChild(rightResizer);
    bubbleDiv.appendChild(leftResizer);
  }

  /**
   * Insère les bulles traduites avec adaptation dynamique de la taille pour le français
   */
  async function renderBubblesOnImage(img, wrapper, bubbles, engineName) {
    const oldLayer = wrapper.querySelector(".manga-overlay-layer");
    if (oldLayer) {
      const idx = activeOverlays.indexOf(oldLayer);
      if (idx !== -1) activeOverlays.splice(idx, 1);
      oldLayer.remove();
    }

    const overlayLayer = document.createElement("div");
    overlayLayer.className = "manga-overlay-layer";
    overlayLayer.style.display = isOverlayVisible ? "block" : "none";

    const renderedW = img.offsetWidth || img.naturalWidth || 800;
    const renderedH = img.offsetHeight || img.naturalHeight || 1200;

    for (const b of bubbles) {
      if (!b.box_2d || b.box_2d.length !== 4) continue;

      const [ymin, xmin, ymax, xmax] = b.box_2d;

      // Coordonnées de base en pourcentage (%)
      let topPct = ymin / 10;
      let leftPct = xmin / 10;
      let widthPct = (xmax - xmin) / 10;
      let heightPct = (ymax - ymin) / 10;

      const textLen = (b.translation || "").length || 1;

      // 1. Si la bulle originale est étroite (typique du japonais vertical),
      // élargir la bulle pour le français horizontal afin d'éviter que le texte ne se coupe mot par mot
      let finalWidthPct = widthPct;
      let finalHeightPct = heightPct;

      if (finalWidthPct < 15 && textLen > 12) {
        finalWidthPct = Math.min(30, Math.max(16, finalWidthPct * 1.6));
      }

      // 2. Expansion dynamique selon la densité du texte en français (+25% en moyenne)
      const pixelW = (finalWidthPct / 100) * renderedW;
      const pixelH = (finalHeightPct / 100) * renderedH;
      const initialArea = pixelW * pixelH;

      const neededArea = textLen * 22;
      let scaleFactor = 1.0;
      if (initialArea < neededArea) {
        scaleFactor = Math.min(1.35, Math.max(1.08, Math.sqrt(neededArea / initialArea)));
        finalWidthPct = Math.min(94, finalWidthPct * scaleFactor);
        finalHeightPct = Math.min(94, finalHeightPct * scaleFactor);
      }

      // Appliquer l'expansion centrée
      const origCenterX = leftPct + widthPct / 2;
      const origCenterY = topPct + heightPct / 2;
      const finalLeft = Math.max(1, Math.min(98 - finalWidthPct, origCenterX - finalWidthPct / 2));
      const finalTop = Math.max(1, Math.min(98 - finalHeightPct, origCenterY - finalHeightPct / 2));

      const bubbleDiv = document.createElement("div");
      bubbleDiv.className = "manga-translated-bubble";
      bubbleDiv.style.top = `${finalTop.toFixed(2)}%`;
      bubbleDiv.style.left = `${finalLeft.toFixed(2)}%`;
      bubbleDiv.style.width = `${finalWidthPct.toFixed(2)}%`;
      bubbleDiv.style.minHeight = `${finalHeightPct.toFixed(2)}%`;
      bubbleDiv.style.height = "auto"; // Permet à la bulle de grandir vers le bas si le paragraphe est long

      // Calcul dynamique et ajustement de la taille de police pour remplir confortablement la bulle
      const adjustedPixelArea = ((finalWidthPct / 100) * renderedW) * ((finalHeightPct / 100) * renderedH);
      const optimalFontSize = Math.min(19, Math.max(10, Math.round(Math.sqrt(adjustedPixelArea / (textLen * 1.4)))));
      bubbleDiv.style.fontSize = `${optimalFontSize}px`;

      // Texte traduit
      const spanText = document.createElement("span");
      spanText.className = "manga-bubble-text";
      spanText.textContent = b.translation || "";
      bubbleDiv.appendChild(spanText);

      // Poignées de redimensionnement manuel (longueur / largeur)
      attachBubbleResizers(bubbleDiv);

      // Tooltip d'informations au survol
      const tooltip = document.createElement("div");
      tooltip.className = "manga-bubble-tooltip";
      tooltip.innerHTML = `
        <div class="manga-tooltip-orig"><strong>Original :</strong> ${escapeHtml(b.original_text || "")}</div>
        <div class="manga-tooltip-trans"><strong>Traduction :</strong> ${escapeHtml(b.translation || "")}</div>
        <div class="manga-tooltip-engine">${escapeHtml(engineName || "Traducteur")}</div>
      `;
      bubbleDiv.appendChild(tooltip);

      // Clic sur la bulle pour alterner entre original et français
      let isShowingOrig = false;
      bubbleDiv.addEventListener("click", (e) => {
        // Ignorer si on vient de cliquer sur une poignée de redimensionnement
        if (e.target.classList.contains("manga-bubble-resizer") || e.target.classList.contains("manga-bubble-resizer-w") || e.target.classList.contains("manga-bubble-resizer-left")) {
          return;
        }
        e.stopPropagation();
        isShowingOrig = !isShowingOrig;
        spanText.textContent = isShowingOrig ? (b.original_text || "") : (b.translation || "");
        bubbleDiv.style.color = isShowingOrig ? "#4338ca" : "#111111";
      });

      overlayLayer.appendChild(bubbleDiv);
    }

    wrapper.appendChild(overlayLayer);
    activeOverlays.push(overlayLayer);
  }

  /**
   * Bascule l'affichage de toutes les bulles traduites
   */
  function toggleOverlays() {
    isOverlayVisible = !isOverlayVisible;
    for (const layer of activeOverlays) {
      if (document.body.contains(layer)) {
        layer.style.display = isOverlayVisible ? "block" : "none";
      }
    }
    const icon = document.getElementById("manga-toggle-icon");
    if (icon) icon.textContent = isOverlayVisible ? "👁️" : "🙈";
    showToast("Affichage", isOverlayVisible ? "Traductions affichées" : "Traductions masquées", "info", 1500);
  }

  // Barre d'outils flottante
  function initGlobalToolbar() {
    if (document.getElementById("manga-translate-global-toolbar")) return;

    const toolbar = document.createElement("div");
    toolbar.id = "manga-translate-global-toolbar";
    toolbar.innerHTML = `
      <button class="manga-toolbar-btn" id="manga-btn-translate-all" title="Traduire tout le chapitre d'un coup (Alt+A)">
        <span>📚</span>
        <span class="manga-btn-label">Tout Traduire</span>
      </button>
      <button class="manga-toolbar-btn" id="manga-btn-translate-page" title="Traduire le scan visible (Alt+T)">
        <span>⚡</span>
        <span class="manga-btn-label">Traduire Scan</span>
      </button>
      <button class="manga-toolbar-btn" id="manga-btn-translate-next" title="Traduire le scan suivant">
        <span>📜</span>
        <span class="manga-btn-label">Suivant</span>
      </button>
      <button class="manga-toolbar-btn" id="manga-btn-crop" title="Traduire une bulle ou zone précise (Alt+S)">
        <span>🎯</span>
        <span class="manga-btn-label">Zone</span>
      </button>
      <button class="manga-toolbar-btn" id="manga-btn-toggle" title="Masquer / Afficher les traductions (Alt+H)">
        <span id="manga-toggle-icon">👁️</span>
      </button>
      <button class="manga-toolbar-toggle-btn" id="manga-btn-minimize" title="Réduire la barre">
        <span>❯</span>
      </button>
    `;
    document.body.appendChild(toolbar);

    toolbar.querySelector("#manga-btn-translate-all").addEventListener("click", () => {
      translateAllChapterScans();
    });

    toolbar.querySelector("#manga-btn-translate-page").addEventListener("click", () => {
      translateCurrentVisiblePage();
    });

    toolbar.querySelector("#manga-btn-translate-next").addEventListener("click", () => {
      translateNextScan();
    });

    toolbar.querySelector("#manga-btn-crop").addEventListener("click", () => {
      startCropSelection();
    });

    toolbar.querySelector("#manga-btn-toggle").addEventListener("click", () => {
      toggleOverlays();
    });

    const minBtn = toolbar.querySelector("#manga-btn-minimize");

    function setToolbarMinimized(isMin) {
      if (isMin) {
        toolbar.classList.add("minimized");
        minBtn.innerHTML = `<span>🌐</span><span style="margin-left:3px;font-weight:900;">❮</span>`;
        minBtn.title = "Agrandir la barre de traduction";
      } else {
        toolbar.classList.remove("minimized");
        minBtn.innerHTML = `<span>❯</span>`;
        minBtn.title = "Réduire la barre";
      }
    }

    // Cliquer sur la barre réduite permet également de la ré-agrandir
    toolbar.addEventListener("click", () => {
      if (toolbar.classList.contains("minimized")) {
        setToolbarMinimized(false);
      }
    });

    minBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isMin = !toolbar.classList.contains("minimized");
      setToolbarMinimized(isMin);
    });
  }

  initGlobalToolbar();

  // Outil de sélection de zone (Crop Snipping Tool)
  function startCropSelection() {
    if (cropModeActive) return;
    cropModeActive = true;

    const backdrop = document.createElement("div");
    backdrop.id = "manga-crop-backdrop";

    const banner = document.createElement("div");
    banner.id = "manga-crop-guide-banner";
    banner.textContent = "Glissez votre souris pour sélectionner une bulle à traduire (Échap pour annuler)";

    const selectionBox = document.createElement("div");
    selectionBox.id = "manga-crop-selection-box";
    selectionBox.style.display = "none";

    backdrop.appendChild(banner);
    backdrop.appendChild(selectionBox);
    document.body.appendChild(backdrop);

    let startX = 0, startY = 0;
    let isDragging = false;

    const onMouseDown = (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      selectionBox.style.left = `${startX}px`;
      selectionBox.style.top = `${startY}px`;
      selectionBox.style.width = "0px";
      selectionBox.style.height = "0px";
      selectionBox.style.display = "block";
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const currentX = e.clientX;
      const currentY = e.clientY;
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const w = Math.abs(currentX - startX);
      const h = Math.abs(currentY - startY);
      selectionBox.style.left = `${x}px`;
      selectionBox.style.top = `${y}px`;
      selectionBox.style.width = `${w}px`;
      selectionBox.style.height = `${h}px`;
    };

    const onMouseUp = async (e) => {
      if (!isDragging) return;
      isDragging = false;
      const endX = e.clientX;
      const endY = e.clientY;
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const w = Math.abs(endX - startX);
      const h = Math.abs(endY - startY);

      cleanup();

      if (w < 20 || h < 15) return;
      await processSelectedCropZone(x, y, w, h);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") cleanup();
    };

    const cleanup = () => {
      backdrop.remove();
      window.removeEventListener("keydown", onKeyDown);
      cropModeActive = false;
    };

    backdrop.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
  }

  // Traitement d'une zone sélectionnée à la souris
  async function processSelectedCropZone(screenX, screenY, width, height) {
    const elements = document.elementsFromPoint(screenX + width / 2, screenY + height / 2);
    const img = elements.find(el => el.tagName === "IMG");

    if (!img) {
      showToast("Zone hors scan", "Veuillez sélectionner une bulle située sur un scan de manga.", "warning");
      return;
    }

    const toast = showToast("Traduction de la bulle...", "Traitement de la zone...", "info", 0);

    try {
      const imgRect = img.getBoundingClientRect();
      const cropX = Math.max(0, screenX - imgRect.left);
      const cropY = Math.max(0, screenY - imgRect.top);
      const cropW = Math.min(width, imgRect.width - cropX);
      const cropH = Math.min(height, imgRect.height - cropY);

      const canvas = document.createElement("canvas");
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext("2d");

      const tempImg = new Image();
      tempImg.crossOrigin = "anonymous";

      const realSrc = getRealImageSource(img);
      const base64Data = await new Promise(async (resolve, reject) => {
        const resp = await chrome.runtime.sendMessage({
          action: "FETCH_IMAGE_BASE64",
          url: realSrc
        });
        if (!resp || !resp.success) {
          reject(new Error("Impossible de charger le scan"));
          return;
        }
        tempImg.onload = () => {
          const scaleX = tempImg.naturalWidth / imgRect.width;
          const scaleY = tempImg.naturalHeight / imgRect.height;
          ctx.drawImage(
            tempImg,
            cropX * scaleX, cropY * scaleY, cropW * scaleX, cropH * scaleY,
            0, 0, cropW, cropH
          );
          resolve(canvas.toDataURL("image/jpeg", 0.9));
        };
        tempImg.onerror = reject;
        tempImg.src = resp.data;
      });

      const transResp = await chrome.runtime.sendMessage({
        action: "TRANSLATE_IMAGE",
        imageBase64: base64Data
      });

      toast.remove();

      if (!transResp || !transResp.success) {
        throw new Error(transResp ? transResp.error : "Erreur lors de la traduction.");
      }

      const bubbles = transResp.bubbles || [];
      if (bubbles.length === 0) {
        showToast("Aucun texte trouvé", "Aucun texte n'a été reconnu dans la bulle sélectionnée.", "info");
        return;
      }

      // Convertir en coordonnées relatives au scan complet
      const adjustedBubbles = bubbles.map(b => {
        const [ymin, xmin, ymax, xmax] = b.box_2d;
        const bAbsLeft = cropX + (xmin / 1000) * cropW;
        const bAbsTop = cropY + (ymin / 1000) * cropH;
        const bAbsW = ((xmax - xmin) / 1000) * cropW;
        const bAbsH = ((ymax - ymin) / 1000) * cropH;

        return {
          box_2d: [
            Math.round((bAbsTop / imgRect.height) * 1000),
            Math.round((bAbsLeft / imgRect.width) * 1000),
            Math.round(((bAbsTop + bAbsH) / imgRect.height) * 1000),
            Math.round(((bAbsLeft + bAbsW) / imgRect.width) * 1000)
          ],
          original_text: b.original_text,
          translation: b.translation
        };
      });

      const wrapper = getOrCreateWrapper(img);
      renderBubblesOnImage(img, wrapper, adjustedBubbles, transResp.engineName);
      showToast("Bulle traduite !", `Traduit avec ${transResp.engineName}`, "success", 2500);

    } catch (err) {
      toast.remove();
      console.error("[MangaTranslator] Erreur crop:", err);
      showToast("Erreur", err.message, "error", 4000);
    }
  }

  // Raccourcis Clavier : Alt+T (Scan visible), Alt+A (Tout le chapitre), Alt+S (Zone), Alt+H (Masquer)
  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "t" || e.key === "T")) {
      e.preventDefault();
      translateCurrentVisiblePage();
    } else if (e.altKey && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      translateAllChapterScans();
    } else if (e.altKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      startCropSelection();
    } else if (e.altKey && (e.key === "h" || e.key === "H")) {
      e.preventDefault();
      toggleOverlays();
    }
  });

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
