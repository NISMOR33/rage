const DEFAULTS = {
  activationCode: "KeyF", activationLabel: "F",
  activationMode: "hold",
  minDelay: 150, maxDelay: 400, sensitivity: 0.88,
  searchMode: "full", searchRegion: null,
  requestedDelay: null, measuredDelay: null, browserOverhead: null
};

const debuggerTabs = new Set();
const nativeClickQueues = new Map();
let mouseHost = null;
let mouseRequestId = 0;
const mouseRequests = new Map();

function getMouseHost() {
  if (mouseHost) return mouseHost;
  mouseHost = chrome.runtime.connectNative("com.vision_hold_clicker.mouse");
  mouseHost.onMessage.addListener(message => {
    const pending = mouseRequests.get(message.id);
    if (!pending) return;
    mouseRequests.delete(message.id);
    message.ok ? pending.resolve(message) : pending.reject(new Error(message.error || "Erreur du compagnon Windows"));
  });
  mouseHost.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || "Compagnon Windows deconnecte";
    for (const pending of mouseRequests.values()) pending.reject(new Error(error));
    mouseRequests.clear();
    mouseHost = null;
  });
  return mouseHost;
}

function sendWindowsClick(x, y) {
  return new Promise((resolve, reject) => {
    const id = ++mouseRequestId;
    const timeout = setTimeout(() => {
      mouseRequests.delete(id);
      reject(new Error("Le compagnon Windows ne repond pas (delai de 2 s)."));
    }, 2000);
    mouseRequests.set(id, {
      resolve: value => { clearTimeout(timeout); resolve(value); },
      reject: error => { clearTimeout(timeout); reject(error); }
    });
    try {
      getMouseHost().postMessage({ id, type: "click", x: Math.round(x), y: Math.round(y) });
    } catch (error) {
      mouseRequests.delete(id);
      clearTimeout(timeout);
      reject(error);
    }
  });
}

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId != null) debuggerTabs.delete(source.tabId);
});

async function ensureDebugger(tabId) {
  if (debuggerTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  debuggerTabs.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    await chrome.debugger.sendCommand({ tabId }, "Network.setBlockedURLs", {
      urls: ["*ragepad-classement.ayoubgor811487.chatgpt.site/api/ragepad*"]
    });
  } catch (error) {
    await detachDebugger(tabId);
    throw error;
  }
}

function enqueueNativeClick(tabId, x, y, screenX, screenY) {
  const previous = nativeClickQueues.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await ensureDebugger(tabId);
    await sendWindowsClick(screenX, screenY);
  });
  nativeClickQueues.set(tabId, next);
  next.finally(() => {
    if (nativeClickQueues.get(tabId) === next) nativeClickQueues.delete(tabId);
  });
  return next;
}

async function detachDebugger(tabId) {
  nativeClickQueues.delete(tabId);
  if (!debuggerTabs.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch {}
  debuggerTabs.delete(tabId);
}

chrome.runtime.onInstalled.addListener(async details => {
  const saved = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const migration = details.reason === "update" ? { searchMode: "full", searchRegion: null } : {};
  await chrome.storage.local.set({ ...DEFAULTS, ...saved, ...migration, status: "INACTIF", detections: 0, clicks: 0, lastDelay: null, requestedDelay: null, measuredDelay: null, browserOverhead: null, error: "" });
});

// La popup n'est pas dans la page : le service worker relaie simplement son
// appui et son relâchement vers le content script de l'onglet actif.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "native-click" && sender.tab?.id != null) {
    enqueueNativeClick(sender.tab.id, Number(message.x), Number(message.y), Number(message.screenX), Number(message.screenY)).then(
      () => sendResponse({ ok: true }),
      error => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  if (message.type === "native-click-stop" && sender.tab?.id != null) {
    detachDebugger(sender.tab.id).then(() => sendResponse({ ok: true }));
    return true;
  }
  if ((message.type === "hold-start" || message.type === "hold-stop") && message.tabId != null) {
    const type = message.type === "hold-start" ? "external-hold-start" : "external-hold-stop";
    chrome.tabs.sendMessage(message.tabId, { type }).then(
      response => sendResponse(response || { ok: true }),
      error => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  if (message.type === "settings-changed") {
    chrome.storage.local.set({ status: "INACTIF" }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
