/**
 * Manga Translator AI & Local - Popup Logic
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Éléments du DOM
  const fallbackModeSelect = document.getElementById("fallbackMode");
  const geminiApiKeyInput = document.getElementById("geminiApiKey");
  const btnToggleKeyVisibility = document.getElementById("btnToggleKeyVisibility");
  const btnTestGemini = document.getElementById("btnTestGemini");
  const geminiStatusMsg = document.getElementById("geminiStatusMsg");
  const geminiModelSelect = document.getElementById("geminiModel");

  const localServerUrlInput = document.getElementById("localServerUrl");
  const btnCheckLocal = document.getElementById("btnCheckLocal");
  const localServerPill = document.getElementById("localServerPill");
  const localStatusMsg = document.getElementById("localStatusMsg");

  const sourceLangSelect = document.getElementById("sourceLang");
  const targetLangSelect = document.getElementById("targetLang");

  const bubbleOpacityInput = document.getElementById("bubbleOpacity");
  const opacityVal = document.getElementById("opacityVal");

  const btnSave = document.getElementById("btnSave");
  const saveToast = document.getElementById("saveToast");

  // Charger la configuration sauvegardée
  const config = await chrome.storage.local.get({
    geminiApiKey: "",
    geminiModel: "gemini-3.8-flash",
    fallbackMode: "auto",
    localServerUrl: "http://127.0.0.1:5000",
    sourceLang: "auto",
    targetLang: "fr",
    bubbleOpacity: 95
  });

  // Auto-migration si l'ancien modèle était 2.5, 2.0 ou 1.5
  if (!config.geminiModel || config.geminiModel.includes("2.5") || config.geminiModel.includes("2.0") || config.geminiModel.includes("1.5")) {
    config.geminiModel = "gemini-3.8-flash";
    chrome.storage.local.set({ geminiModel: "gemini-3.8-flash" });
  }

  fallbackModeSelect.value = config.fallbackMode;
  geminiApiKeyInput.value = config.geminiApiKey;
  geminiModelSelect.value = config.geminiModel;
  localServerUrlInput.value = config.localServerUrl;
  sourceLangSelect.value = config.sourceLang;
  targetLangSelect.value = config.targetLang;
  bubbleOpacityInput.value = config.bubbleOpacity;
  opacityVal.textContent = `${config.bubbleOpacity}%`;

  // Vérifier automatiquement l'état du serveur local au démarrage
  checkLocalServerStatus(config.localServerUrl);

  // Basculer l'affichage de la clé API
  btnToggleKeyVisibility.addEventListener("click", () => {
    if (geminiApiKeyInput.type === "password") {
      geminiApiKeyInput.type = "text";
      btnToggleKeyVisibility.textContent = "🙈";
    } else {
      geminiApiKeyInput.type = "password";
      btnToggleKeyVisibility.textContent = "👁️";
    }
  });

  // Slider d'opacité avec mise à jour immédiate en temps réel sur la page
  bubbleOpacityInput.addEventListener("input", () => {
    const val = parseInt(bubbleOpacityInput.value, 10);
    opacityVal.textContent = `${val}%`;
    chrome.storage.local.set({ bubbleOpacity: val });
  });

  // Tester la clé Gemini
  btnTestGemini.addEventListener("click", async () => {
    const key = geminiApiKeyInput.value.trim();
    if (!key) {
      showStatus(geminiStatusMsg, "Veuillez entrer une clé API.", "error");
      return;
    }

    btnTestGemini.disabled = true;
    btnTestGemini.textContent = "Test en cours...";
    showStatus(geminiStatusMsg, "Vérification auprès de Google...", "");

    const resp = await chrome.runtime.sendMessage({
      action: "TEST_GEMINI_KEY",
      apiKey: key,
      model: geminiModelSelect.value
    });

    btnTestGemini.disabled = false;
    btnTestGemini.textContent = "Tester la clé";

    if (resp && resp.success) {
      showStatus(geminiStatusMsg, "✅ " + resp.message, "success");
    } else {
      showStatus(geminiStatusMsg, "❌ " + (resp ? resp.error : "Erreur de validation"), "error");
    }
  });

  // Tester le serveur local
  btnCheckLocal.addEventListener("click", async () => {
    await checkLocalServerStatus(localServerUrlInput.value.trim());
  });

  async function checkLocalServerStatus(url) {
    btnCheckLocal.disabled = true;
    localServerPill.className = "status-pill offline";
    localServerPill.textContent = "Vérification...";

    const resp = await chrome.runtime.sendMessage({
      action: "CHECK_LOCAL_SERVER",
      serverUrl: url
    });

    btnCheckLocal.disabled = false;

    if (resp && resp.online) {
      localServerPill.className = "status-pill online";
      localServerPill.textContent = "En ligne";
      showStatus(localStatusMsg, "✅ Serveur local actif (RapidOCR prêt).", "success");
    } else {
      localServerPill.className = "status-pill offline";
      localServerPill.textContent = "Hors-ligne";
      showStatus(
        localStatusMsg,
        "❌ Serveur inaccessible. Lancez 'start_server.bat' dans votre dossier Traduc.",
        "error"
      );
    }
  }

  // Sauvegarde automatique immédiate lors du changement de sélection
  geminiModelSelect.addEventListener("change", () => {
    chrome.storage.local.set({ geminiModel: geminiModelSelect.value });
  });
  fallbackModeSelect.addEventListener("change", () => {
    chrome.storage.local.set({ fallbackMode: fallbackModeSelect.value });
  });
  sourceLangSelect.addEventListener("change", () => {
    chrome.storage.local.set({ sourceLang: sourceLangSelect.value });
  });
  targetLangSelect.addEventListener("change", () => {
    chrome.storage.local.set({ targetLang: targetLangSelect.value });
  });

  // Enregistrer les modifications
  btnSave.addEventListener("click", async () => {
    const newConfig = {
      geminiApiKey: geminiApiKeyInput.value.trim(),
      geminiModel: geminiModelSelect.value,
      fallbackMode: fallbackModeSelect.value,
      localServerUrl: localServerUrlInput.value.trim() || "http://127.0.0.1:5000",
      sourceLang: sourceLangSelect.value,
      targetLang: targetLangSelect.value,
      bubbleOpacity: parseInt(bubbleOpacityInput.value, 10)
    };

    await chrome.storage.local.set(newConfig);

    saveToast.classList.add("visible");
    setTimeout(() => {
      saveToast.classList.remove("visible");
    }, 2000);
  });

  function showStatus(element, message, type) {
    element.className = `status-msg ${type}`;
    element.textContent = message;
    element.style.display = message ? "block" : "none";
  }
});
