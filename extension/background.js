/**
 * Manga Translator AI & Local - Background Service Worker
 * Gère les appels API (Gemini Flash), le contournement CORS et le basculement automatique
 * vers le serveur local en cas de quota dépassé.
 */

// Configuration par défaut
const DEFAULT_CONFIG = {
  geminiApiKey: "",
  geminiModel: "gemini-3.8-flash",
  fallbackMode: "auto", // "auto" (Gemini -> Local), "gemini_only", "local_only"
  localServerUrl: "http://127.0.0.1:5000",
  sourceLang: "auto",
  targetLang: "fr",
  bubbleOpacity: 95,
  fontSize: "auto"
};

// Initialisation au chargement
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(Object.keys(DEFAULT_CONFIG), (res) => {
    const toSet = {};
    for (const [key, val] of Object.entries(DEFAULT_CONFIG)) {
      if (res[key] === undefined) {
        toSet[key] = val;
      }
    }
    // Migration si l'ancien modèle était obsolète
    if (!res.geminiModel || res.geminiModel.includes("2.5") || res.geminiModel.includes("2.0") || res.geminiModel.includes("1.5")) {
      toSet.geminiModel = "gemini-3.8-flash";
    }
    if (Object.keys(toSet).length > 0) {
      chrome.storage.local.set(toSet);
    }
  });
});

// Écoute des messages venant du content-script ou du popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request.action;

  if (action === "FETCH_IMAGE_BASE64") {
    fetchImageAsBase64(request.url)
      .then((b64) => sendResponse({ success: true, data: b64 }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Asynchrone
  }

  if (action === "TRANSLATE_IMAGE") {
    handleTranslation(request.imageBase64, request.sourceLang, request.targetLang)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === "CHECK_LOCAL_SERVER") {
    checkLocalServer(request.serverUrl)
      .then((status) => sendResponse(status))
      .catch((err) => sendResponse({ online: false, error: err.message }));
    return true;
  }

  if (action === "TEST_GEMINI_KEY") {
    testGeminiKey(request.apiKey, request.model)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

/**
 * Télécharge une image distante et l'optimise directement dans le Service Worker
 * (Divise le poids par 30 et le temps de transfert par 10)
 */
async function fetchImageAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Échec de récupération de l'image (HTTP ${resp.status})`);
  }
  const blob = await resp.blob();

  // Optimisation directe dans le Service Worker
  try {
    if (typeof createImageBitmap === "function" && typeof OffscreenCanvas !== "undefined") {
      const bitmap = await createImageBitmap(blob);
      let w = bitmap.width;
      let h = bitmap.height;
      const maxW = 1280;
      const maxH = 3600;

      let scale = 1.0;
      if (w > maxW) scale = maxW / w;
      if (h * scale > maxH) {
        const scaleH = maxH / h;
        if (w * scaleH >= 750) scale = scaleH;
        else scale = Math.max(750 / w, scaleH);
      }

      const canvasW = Math.round(w * scale);
      const canvasH = Math.round(h * scale);
      const canvas = new OffscreenCanvas(canvasW, canvasH);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, canvasW, canvasH);
      bitmap.close();

      const optBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
      return await blobToDataUrl(optBlob);
    }
  } catch (e) {
    console.warn("[MangaTranslator] OffscreenCanvas non utilisé, fallback direct:", e);
  }

  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Pipeline principal de traduction avec basculement automatique
 */
async function handleTranslation(imageBase64, customSourceLang, customTargetLang) {
  const config = await chrome.storage.local.get(DEFAULT_CONFIG);
  const sourceLang = customSourceLang || config.sourceLang || "auto";
  const targetLang = customTargetLang || config.targetLang || "fr";
  const mode = config.fallbackMode || "auto";
  const localUrl = config.localServerUrl || "http://127.0.0.1:5000";

  // Si l'utilisateur a configuré "Serveur Local uniquement"
  if (mode === "local_only") {
    return await callLocalServer(imageBase64, sourceLang, targetLang, localUrl);
  }

  // Si pas de clé Gemini configurée
  if (!config.geminiApiKey || config.geminiApiKey.trim() === "") {
    if (mode === "auto") {
      console.log("[MangaTranslator] Pas de clé Gemini configurée -> Basculement direct sur le serveur local");
      return await callLocalServer(imageBase64, sourceLang, targetLang, localUrl, "Aucune clé Gemini renseignée : utilisation directe du serveur local");
    } else {
      throw new Error("Clé API Gemini non configurée. Cliquez sur l'icône de l'extension pour l'ajouter.");
    }
  }

  // Nettoyer et mettre à jour le modèle si obsolète
  let activeModel = config.geminiModel || "gemini-3.8-flash";
  if (activeModel.includes("2.5") || activeModel.includes("2.0") || activeModel.includes("1.5")) {
    activeModel = "gemini-3.8-flash";
    chrome.storage.local.set({ geminiModel: "gemini-3.8-flash" });
  }

  // Tenter en priorité Gemini Flash (Solution 1) avec retry intelligent sur le modèle choisi
  try {
    console.log(`[MangaTranslator] Traitement via Gemini (${activeModel})...`);
    const geminiResult = await callGeminiVision(imageBase64, config.geminiApiKey, activeModel, sourceLang, targetLang);
    return {
      success: true,
      engine: "gemini",
      engineName: `Gemini IA (${geminiResult.actualModel || activeModel})`,
      bubbles: geminiResult.bubbles
    };
  } catch (geminiError) {
    console.warn("[MangaTranslator] Erreur ou saturation sur Gemini:", geminiError.message);

    // Si on est en mode "auto", basculer immédiatement sur le Serveur Local (Solution 2)
    if (mode === "auto") {
      console.log("[MangaTranslator] Basculement automatique vers la Solution 2 (Serveur local)...");
      try {
        const localResult = await callLocalServer(
          imageBase64,
          sourceLang,
          targetLang,
          localUrl,
          `Serveurs Google saturés ou quota atteint (${geminiError.message}). Relais automatique assuré par le serveur local.`
        );
        return localResult;
      } catch (localError) {
        throw new Error(
          `Les serveurs Google sont temporairement saturés (${geminiError.message}), ET votre serveur local n'est pas encore démarré.\n` +
          `👉 Pour continuer votre lecture sans aucune interruption, double-cliquez simplement sur 'start_server.bat' dans votre dossier Traduc !`
        );
      }
    } else {
      // Mode gemini_only sans secours
      throw new Error(`Erreur Gemini: ${geminiError.message}`);
    }
  }
}

/**
 * Appelle l'API Multimodale de Google Gemini avec retry persistant sur le modèle choisi (anti-503)
 */
async function callGeminiVision(imageBase64, apiKey, initialModel = "gemini-3.8-flash", sourceLang = "auto", targetLang = "fr") {
  // Extraire le base64 pur et le mimeType
  let mimeType = "image/jpeg";
  let cleanBase64 = imageBase64;

  if (imageBase64.includes(";base64,")) {
    const parts = imageBase64.split(";base64,");
    const mimeMatch = parts[0].match(/data:(.*?);/);
    if (mimeMatch) mimeType = mimeMatch[1];
    cleanBase64 = parts[1];
  }

  // Modèle principal choisi par l'utilisateur (par défaut gemini-3.8-flash)
  let primaryModel = initialModel || "gemini-3.8-flash";
  if (primaryModel.includes("2.5") || primaryModel.includes("2.0") || primaryModel.includes("1.5")) {
    primaryModel = "gemini-3.8-flash";
  }

  const langPrompt = sourceLang === "ja"
    ? "from Japanese (traditional manga/vertical/horizontal) to French"
    : sourceLang === "en"
    ? "from English to French"
    : "from Japanese or English to French";

  const systemPrompt = `You are an expert manga and comic translator translating ${langPrompt}.
Analyze this manga page carefully. Detect ALL dialogue text, speech bubbles, thought balloons, narration boxes, system windows, status screens, RPG skill menus, map labels, architectural diagrams, signboards, floating text, sound effects (onomatopoeia/SFX), and commentary.
Even small, handwritten, vertical, or borderless text must be detected and translated.

For each text element found:
1. Locate its bounding box as [ymin, xmin, ymax, xmax] in normalized coordinates from 0 to 1000.
2. Read the original text accurately (handle Japanese vertical text, kanji, furigana, and English comic fonts).
3. Translate into natural, expressive, modern French. Keep French dialogues CONCISE and impactful to fit inside speech bubbles.

Respond strictly with a valid JSON array of objects:
[
  {
    "box_2d": [ymin, xmin, ymax, xmax],
    "original_text": "text in scan",
    "translation": "traduction concise en français"
  }
]`;

  const responseSchema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        box_2d: {
          type: "ARRAY",
          items: { type: "INTEGER" }
        },
        original_text: { type: "STRING" },
        translation: { type: "STRING" }
      },
      required: ["box_2d", "original_text", "translation"]
    }
  };

  const payload = {
    contents: [
      {
        parts: [
          { text: systemPrompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: cleanBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      max_output_tokens: 4096,
      response_mime_type: "application/json",
      response_schema: responseSchema
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ]
  };

  // Respect STRICT du modèle sélectionné par l'utilisateur (pas de rétrogradation silencieuse)
  // En cas de pic de charge temporaire (503 ou 429), on réessaie sur CE MÊME modèle avec backoff court.
  const attempts = [
    { model: primaryModel, delay: 0 },
    { model: primaryModel, delay: 800 },
    { model: primaryModel, delay: 1800 }
  ];

  let lastError = null;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const currentModel = attempt.model;

    if (attempt.delay > 0) {
      console.log(`[MangaTranslator] Pic de charge 503 sur Google. Nouvelle tentative ${i + 1}/${attempts.length} sur ${currentModel} dans ${attempt.delay}ms...`);
      await new Promise(r => setTimeout(r, attempt.delay));
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

    try {
      console.log(`[MangaTranslator] Envoi de la requête à ${currentModel} (tentative ${i + 1}/${attempts.length})...`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(22000) // Sécurité anti-blocage (22s max)
      });

      if (response.ok) {
        const resultData = await response.json();
        const candidate = resultData.candidates?.[0];
        const rawText = candidate?.content?.parts?.[0]?.text;

        if (!rawText) {
          console.warn("[MangaTranslator] Réponse Gemini sans texte. finishReason:", candidate?.finishReason);
          if (candidate?.finishReason === "SAFETY") {
            lastError = new Error("Le contenu du scan a été bloqué par les filtres de sécurité Google.");
            continue;
          }
          return { bubbles: [], actualModel: currentModel };
        }

        const bubbles = extractBubblesFromGeminiResponse(rawText);
        console.log(`[MangaTranslator] ${bubbles.length} bulles extraites avec succès via ${currentModel}`);
        return {
          bubbles,
          actualModel: currentModel
        };
      }

      // Gestion des erreurs
      const errorText = await response.text();
      let parsedErr = errorText;
      try {
        const errJson = JSON.parse(errorText);
        parsedErr = errJson.error?.message || errorText;
      } catch (_) {}

      console.warn(`[MangaTranslator] Tentative ${i + 1} (${currentModel}) a retourné HTTP ${response.status}: ${parsedErr}`);
      lastError = new Error(`HTTP ${response.status} (${currentModel}): ${parsedErr}`);

      // Erreur de clé API (400 ou 403) : arrêter immédiatement
      if (response.status === 400 || response.status === 403) {
        throw lastError;
      }

      // Si erreur 503 (Spike temporaire) ou 429 (Rate limit), on continue la boucle de retry
      if (response.status === 503 || response.status === 429) {
        continue;
      }

      // Si 404 (modèle non disponible), on passe
      if (response.status === 404) {
        continue;
      }

    } catch (netErr) {
      lastError = netErr;
    }
  }

  throw lastError || new Error(`Le modèle ${primaryModel} est temporairement indisponible chez Google.`);
}

/**
 * Appelle le Serveur Local Python (Solution 2 - Secours)
 */
async function callLocalServer(imageBase64, sourceLang, targetLang, serverUrl = "http://127.0.0.1:5000", fallbackNotice = "") {
  const url = `${serverUrl.replace(/\/$/, "")}/translate`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageBase64,
        source_lang: sourceLang,
        target_lang: targetLang
      })
    });

    if (!resp.ok) {
      throw new Error(`Le serveur local a répondu avec le statut HTTP ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.success) {
      throw new Error(data.error || "Erreur interne du serveur local");
    }

    return {
      success: true,
      engine: "local_server",
      engineName: "Serveur Local (RapidOCR)",
      notice: fallbackNotice,
      bubbles: data.bubbles || []
    };
  } catch (e) {
    throw new Error(`Serveur local injoignable sur ${url} : ${e.message}`);
  }
}

/**
 * Vérifie l'état de santé du serveur local
 */
async function checkLocalServer(serverUrl = "http://127.0.0.1:5000") {
  const target = `${serverUrl.replace(/\/$/, "")}/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(target, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      return { online: true, data };
    }
    return { online: false, status: resp.status };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

/**
 * Teste la validité d'une clé Gemini avec le modèle sélectionné
 */
async function testGeminiKey(apiKey, modelName = "gemini-3.8-flash") {
  let model = modelName || "gemini-3.8-flash";
  if (!model || model.includes("2.5") || model.includes("2.0") || model.includes("1.5")) {
    model = "gemini-3.8-flash";
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "OK" }] }]
      })
    });

    if (resp.ok) {
      return { success: true, message: `Clé API valide et opérationnelle avec le modèle ${model} !` };
    }

    const errText = await resp.text();
    let errMsg = errText;
    try {
      const parsed = JSON.parse(errText);
      errMsg = parsed.error?.message || errText;
    } catch (_) {}

    return { success: false, error: `HTTP ${resp.status} (${model}): ${errMsg}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Extrait et normalise les bulles de texte de la réponse Gemini de manière ultra-robuste.
 * Supporte : tableaux bruts, objets { bubbles: [...] }, fences markdown,
 * clés box/bbox, et réparation de JSON tronqué.
 */
function extractBubblesFromGeminiResponse(rawText) {
  if (!rawText || typeof rawText !== "string") return [];

  let text = rawText.trim();

  // 1. Détecter et extraire le bloc ```json ... ``` s'il existe
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  } else {
    // Isoler le premier [ ou { et le dernier ] ou }
    const firstBracket = text.indexOf("[");
    const firstBrace = text.indexOf("{");
    let startIdx = -1;
    if (firstBracket !== -1 && firstBrace !== -1) {
      startIdx = Math.min(firstBracket, firstBrace);
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
    } else if (firstBrace !== -1) {
      startIdx = firstBrace;
    }

    const lastBracket = text.lastIndexOf("]");
    const lastBrace = text.lastIndexOf("}");
    const endIdx = Math.max(lastBracket, lastBrace);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      text = text.substring(startIdx, endIdx + 1).trim();
    }
  }

  // 2. Parser le JSON avec secours en cas de troncature
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (parseErr) {
    // Tentative de réparation de JSON tronqué par la limite de tokens
    try {
      const lastBrace = text.lastIndexOf("}");
      if (lastBrace !== -1) {
        let salvaged = text.substring(0, lastBrace + 1).trim();
        if (salvaged.startsWith("[") && !salvaged.endsWith("]")) {
          salvaged += "]";
        }
        parsed = JSON.parse(salvaged);
      }
    } catch (_) {
      // Extraction regex des objets JSON individuels { "box_2d": ... }
      const objectMatches = text.match(/\{[^{}]*?"(?:box_2d|box|translation)"[^{}]*?\}/g);
      if (objectMatches && objectMatches.length > 0) {
        parsed = [];
        for (const objStr of objectMatches) {
          try {
            parsed.push(JSON.parse(objStr));
          } catch (_) {}
        }
      }
    }
  }

  if (!parsed) return [];

  // 3. Normaliser la liste des bulles
  let items = [];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (typeof parsed === "object") {
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
        items = parsed[key];
        break;
      }
    }
    if (items.length === 0 && (parsed.box_2d || parsed.box || parsed.translation)) {
      items = [parsed];
    }
  }

  // 4. Valider et normaliser chaque bulle
  const validBubbles = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    let box = item.box_2d || item.box || item.bbox || item.coordinates;
    let trans = item.translation || item.fr || item.french || item.text_fr || item.translated_text || "";
    let orig = item.original_text || item.original || item.text || item.source_text || "";

    // Cas où Gemini imbrique [ [ymin, xmin, ymax, xmax], orig, trans ]
    if (Array.isArray(box) && box.length >= 2 && Array.isArray(box[0]) && box[0].length === 4) {
      if (!orig && typeof box[1] === "string") orig = box[1];
      if (!trans && typeof box[2] === "string") trans = box[2];
      box = box[0];
    }

    if (box && typeof box === "object" && !Array.isArray(box)) {
      const ymin = box.ymin ?? box.top ?? 0;
      const xmin = box.xmin ?? box.left ?? 0;
      const ymax = box.ymax ?? box.bottom ?? 0;
      const xmax = box.xmax ?? box.right ?? 0;
      box = [ymin, xmin, ymax, xmax];
    }

    if (!Array.isArray(box) || box.length !== 4) continue;

    const numBox = box.map(n => Math.round(Number(n) || 0));

    if (trans.trim() || orig.trim()) {
      validBubbles.push({
        box_2d: numBox,
        original_text: orig.trim(),
        translation: trans.trim() || orig.trim()
      });
    }
  }

  return validBubbles;
}
