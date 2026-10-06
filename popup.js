const DEFAULTS = { activationCode: "KeyF", activationLabel: "F", activationMode: "hold", minDelay: 150, maxDelay: 400, sensitivity: .88, searchMode: "full", secondClickEnabled: false, secondClickDelay: 100, secondClickPoint: null };
const $ = id => document.getElementById(id);
let capturingKey = false;
let activeTab = null;
let popupHeld = false;
let activationMode = "hold";

document.addEventListener("DOMContentLoaded", async () => {
  // Rend l'extension immédiatement utilisable sur les onglets qui étaient
  // déjà ouverts au moment de son installation/rechargement.
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id && /^https?:/.test(activeTab.url || "")) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] });
    } catch (error) {
      console.warn("Initialisation de l'onglet impossible", error);
    }
  }
  const data = { ...DEFAULTS, ...(await chrome.storage.local.get(null)) };
  $("keyButton").textContent = data.activationLabel;
  activationMode = data.activationMode;
  $("activationMode").value = activationMode;
  $("minDelay").value = data.minDelay;
  $("maxDelay").value = data.maxDelay;
  $("sensitivity").value = Math.round(data.sensitivity * 100);
  $("sensitivityValue").textContent = `${Math.round(data.sensitivity * 100)} %`;
  $("searchMode").value = data.searchMode;
  $("secondClickEnabled").value = String(Boolean(data.secondClickEnabled));
  $("secondClickDelay").value = data.secondClickDelay ?? 100;
  updateRegionButton();
  updateSecondClickUI(data);
  renderRuntime(data);
});

chrome.storage.onChanged.addListener(async changes => {
  const runtime = {};
  for (const key of ["status", "detections", "clicks", "lastDelay", "requestedDelay", "measuredDelay", "browserOverhead", "error"]) if (changes[key]) runtime[key] = changes[key].newValue;
  renderRuntime(runtime);
  if (changes.secondClickPoint || changes.secondClickEnabled) {
    const data = await chrome.storage.local.get(["secondClickEnabled", "secondClickPoint"]);
    updateSecondClickUI(data);
  }
});

$("keyButton").addEventListener("click", () => {
  capturingKey = true;
  $("keyButton").textContent = "…";
  $("keyHint").textContent = "Appuyez maintenant sur une touche";
});
window.addEventListener("keydown", async e => {
  if (capturingKey) {
    e.preventDefault();
    capturingKey = false;
    const label = friendlyKey(e);
    await chrome.storage.local.set({ activationCode: e.code, activationLabel: label });
    $("keyButton").textContent = label;
    $("keyHint").textContent = "Cliquez pour choisir une autre touche.";
    notifySettings();
    return;
  }
  const { activationCode = "KeyF" } = await chrome.storage.local.get("activationCode");
  if (e.code !== activationCode || e.repeat || !activeTab?.id) return;
  e.preventDefault();
  if (activationMode === "toggle") {
    await toggleTabMonitoring();
    return;
  }
  popupHeld = true;
  await sendDirect("external-hold-start");
});
window.addEventListener("keyup", async e => {
  if (activationMode === "toggle") return;
  const { activationCode = "KeyF" } = await chrome.storage.local.get("activationCode");
  if (e.code === activationCode) stopPopupHold();
});
window.addEventListener("blur", () => { if (activationMode === "hold") stopPopupHold(); });
window.addEventListener("pagehide", () => { if (activationMode === "hold") stopPopupHold(); });

$("activationMode").addEventListener("change", async () => {
  activationMode = $("activationMode").value;
  stopPopupHold();
  await chrome.storage.local.set({ activationMode });
  notifySettings();
});

$("toggleButton").addEventListener("click", toggleTabMonitoring);

for (const id of ["minDelay", "maxDelay"]) {
  $(id).addEventListener("change", async () => {
    let min = clamp(0, Number($("minDelay").value), 10000);
    let max = clamp(0, Number($("maxDelay").value), 10000);
    if (min > max) [min, max] = [max, min];
    $("minDelay").value = min; $("maxDelay").value = max;
    await chrome.storage.local.set({ minDelay: min, maxDelay: max });
    notifySettings();
  });
}

$("sensitivity").addEventListener("input", () => $("sensitivityValue").textContent = `${$("sensitivity").value} %`);
$("sensitivity").addEventListener("change", async () => {
  await chrome.storage.local.set({ sensitivity: Number($("sensitivity").value) / 100 });
  notifySettings();
});
$("searchMode").addEventListener("change", async () => {
  await chrome.storage.local.set({ searchMode: $("searchMode").value });
  updateRegionButton();
  notifySettings();
});
$("selectRegion").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "select-region" });
    window.close();
  } catch { $("error").textContent = "Ouvrez une page web normale puis réessayez."; }
});

$("secondClickEnabled").addEventListener("change", async () => {
  const enabled = $("secondClickEnabled").value === "true";
  await chrome.storage.local.set({ secondClickEnabled: enabled });
  const data = await chrome.storage.local.get(["secondClickEnabled", "secondClickPoint"]);
  updateSecondClickUI(data);
  notifySettings();
});
$("secondClickDelay").addEventListener("change", async () => {
  const val = clamp(0, Number($("secondClickDelay").value), 10000);
  $("secondClickDelay").value = val;
  await chrome.storage.local.set({ secondClickDelay: val });
  notifySettings();
});
$("selectClickPoint").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "select-click-point" });
    window.close();
  } catch { $("error").textContent = "Ouvrez une page web normale puis réessayez."; }
});

function renderRuntime(data) {
  if (data.status !== undefined) $("status").textContent = data.status;
  if (data.detections !== undefined) $("detections").textContent = data.detections;
  if (data.clicks !== undefined) $("clicks").textContent = data.clicks;
  if (data.lastDelay !== undefined) $("lastDelay").textContent = data.lastDelay == null ? "—" : `${data.lastDelay} ms`;
  if (data.requestedDelay !== undefined) $("requestedDelay").textContent = data.requestedDelay == null ? "—" : `${data.requestedDelay} ms`;
  if (data.measuredDelay !== undefined) $("measuredDelay").textContent = data.measuredDelay == null ? "—" : `${data.measuredDelay} ms`;
  if (data.browserOverhead !== undefined) $("browserOverhead").textContent = data.browserOverhead == null ? "—" : `+${data.browserOverhead} ms`;
  if (data.error !== undefined) $("error").textContent = data.error || "";
  $("statusDot").className = ($("status").textContent === "INACTIF") ? "" : "active";
  $("toggleButton").textContent = ($("status").textContent === "INACTIF") ? "Démarrer maintenant" : "Arrêter";
}
function friendlyKey(e) { return e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.key.toUpperCase(); }
function clamp(min, value, max) { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
function notifySettings() { chrome.runtime.sendMessage({ type: "settings-changed" }).catch(() => {}); }
function updateRegionButton() {
  $("selectRegion").style.display = $("searchMode").value === "custom" ? "block" : "none";
}
function updateSecondClickUI(data) {
  const enabled = $("secondClickEnabled").value === "true";
  $("secondClickGroup").style.display = enabled ? "block" : "none";
  if (data?.secondClickPoint) {
    const xPct = Math.round(data.secondClickPoint.x * 100);
    const yPct = Math.round(data.secondClickPoint.y * 100);
    $("secondClickPointHint").textContent = `Point placé : X=${xPct}%, Y=${yPct}%`;
  } else {
    $("secondClickPointHint").textContent = "Aucun point placé (cliquez ci-dessus pour le placer)";
  }
}

function stopPopupHold() {
  if (!popupHeld || !activeTab?.id) return;
  popupHeld = false;
  void sendDirect("external-hold-stop");
}

async function toggleTabMonitoring() {
  if (!activeTab?.id) return;
  try {
    const state = await chrome.tabs.sendMessage(activeTab.id, { type: "is-held" });
    const starting = state?.held !== true;
    popupHeld = starting;
    await sendDirect(starting ? "external-hold-start" : "external-hold-stop");
  } catch (error) {
    $("error").textContent = `Communication impossible : ${error.message}`;
  }
}

async function sendDirect(type) {
  if (!activeTab?.id) throw new Error("Aucun onglet actif");
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type });
    if (response?.ok === false) throw new Error(response.error || "Commande refusée");
    $("error").textContent = "";
    return response;
  } catch (firstError) {
    // Répare automatiquement un onglet ouvert avant l'installation/rechargement.
    await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] });
    const response = await chrome.tabs.sendMessage(activeTab.id, { type });
    $("error").textContent = "";
    return response;
  }
}
