// La popup réinjecte ce fichier dans les onglets déjà ouverts.
if (!globalThis.__visionHoldClickerLoaded) {
globalThis.__visionHoldClickerLoaded = true;

let activationCode = "KeyF";
let activationMode = "hold";
let pageHeld = false;
let externalHeld = false;
let observer = null;
let clickPending = false;
let generation = 0;
let selecting = false;
let reactionFrameId = 0;
let reactionWasVisible = false;
let gridshotFrameId = 0;
let gridshotScanQueued = false;
let gridshotBusy = false;
let gridshotModeSwitching = false;
const gridshotPositions = new WeakMap();
let gridshotStartClicked = false;

chrome.storage.local.get(["activationCode", "activationMode", "secondClickEnabled", "secondClickPoint"]).then(data => {
  activationCode = data.activationCode || "KeyF";
  activationMode = data.activationMode || "hold";
  renderSecondClickMarker(data.secondClickPoint, data.secondClickEnabled);
});
chrome.storage.onChanged.addListener(changes => {
  if (changes.activationCode) activationCode = changes.activationCode.newValue;
  if (changes.activationMode) activationMode = changes.activationMode.newValue;
  if (changes.secondClickEnabled || changes.secondClickPoint) {
    chrome.storage.local.get(["secondClickEnabled", "secondClickPoint"]).then(data => {
      renderSecondClickMarker(data.secondClickPoint, data.secondClickEnabled);
    });
  }
});

window.addEventListener("keydown", event => {
  if (selecting || event.code !== activationCode || event.repeat) return;
  if (activationMode === "toggle") {
    if (isHeld()) {
      pageHeld = false;
      externalHeld = false;
      stopMonitoring();
    } else {
      pageHeld = true;
      startMonitoring();
    }
    return;
  }
  pageHeld = true;
  startMonitoring();
}, true);

window.addEventListener("keyup", event => {
  if (event.code !== activationCode) return;
  if (activationMode === "toggle") return;
  pageHeld = false;
  if (!externalHeld) stopMonitoring();
}, true);

window.addEventListener("blur", () => {
  if (activationMode === "toggle") return;
  pageHeld = false;
  if (!externalHeld) stopMonitoring();
}, true);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { pageHeld = false; externalHeld = false; stopMonitoring(); }
}, true);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "external-hold-start") {
    externalHeld = true; startMonitoring(); sendResponse({ ok: true });
  } else if (message.type === "external-hold-stop") {
    externalHeld = false; if (!pageHeld) stopMonitoring(); sendResponse({ ok: true });
  } else if (message.type === "is-held") {
    sendResponse({ held: isHeld() });
  } else if (message.type === "select-region") {
    beginRegionSelection(); sendResponse({ ok: true });
  } else if (message.type === "select-click-point") {
    beginPointSelection(); sendResponse({ ok: true });
  }
  return false;
});

function isHeld() {
  return !document.hidden && (externalHeld || (pageHeld && document.hasFocus()));
}

async function startMonitoring() {
  if (observer || !isHeld()) return;
  generation++;
  // Brancher l'observateur avant tout accès asynchrone : un changement très
  // rapide après keydown ne peut ainsi pas passer pendant l'écriture du statut.
  observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["class", "style", "hidden", "disabled", "aria-hidden", "src", "value"]
  });
  startReactionWatcher();
  startGridshotWatcher();
  await chrome.storage.local.set({ status: "TOUCHE MAINTENUE", error: "" });
}

function stopMonitoring() {
  generation++;
  observer?.disconnect();
  observer = null;
  cancelAnimationFrame(reactionFrameId);
  reactionFrameId = 0;
  cancelAnimationFrame(gridshotFrameId);
  gridshotFrameId = 0;
  gridshotScanQueued = false;
  gridshotBusy = false;
  gridshotModeSwitching = false;
  gridshotStartClicked = false;
  reactionWasVisible = false;
  clickPending = false;
  if (location.hostname === "aimscientist.com" || location.hostname.endsWith(".aimscientist.com")) {
    void chrome.runtime.sendMessage({ type: "native-click-stop" }).catch(() => {});
  }
  void chrome.storage.local.set({ status: "INACTIF" });
}

const SETTINGS_KEYS = ["minDelay", "maxDelay", "sensitivity", "searchMode", "searchRegion", "detections", "clicks", "secondClickEnabled", "secondClickDelay", "secondClickPoint"];

async function handleMutations(mutations) {
  if (!isHeld() || clickPending) return;
  // Sur le jeu Réaction, seul le bouton cible explicite doit déclencher un clic.
  // Les changements de HUD et de message d'attente sont volontairement ignorés.
  if (document.querySelector('[data-reaction-target],[data-gridshot-target]')) return;
  const settings = await chrome.storage.local.get(SETTINGS_KEYS);
  const candidate = chooseCandidate(mutations, settings);
  if (candidate) await triggerCandidate(candidate, settings);
}

function startGridshotWatcher() {
  cancelAnimationFrame(gridshotFrameId);
  const tick = () => {
    if (!observer || !isHeld()) return;
    scanGridshotTargets();
    gridshotFrameId = requestAnimationFrame(tick);
  };
  gridshotFrameId = requestAnimationFrame(tick);
}

function scanGridshotTargets() {
  if (gridshotScanQueued || gridshotBusy || !isHeld()) return;
  gridshotScanQueued = true;
  queueMicrotask(async () => {
    gridshotScanQueued = false;
    if (!isHeld()) return;

    const game = document.querySelector('#rp-game');
    const start = document.querySelector('[data-gridshot-start]');
    const fpsMode = document.querySelector('[data-fps-mode]');
    if (!gridshotModeSwitching && game?.dataset.activeGame === "gridshot" &&
        (fpsMode?.value === "fps" || document.pointerLockElement)) {
      gridshotModeSwitching = true;
      try {
        document.querySelector('[data-gridshot-reset]')?.click();
        if (document.pointerLockElement) await document.exitPointerLock?.();
        if (fpsMode) {
          fpsMode.disabled = false;
          fpsMode.value = "classic";
          fpsMode.dispatchEvent(new Event("change", { bubbles: true }));
        }
        gridshotPositions.clear?.();
        gridshotStartClicked = false;
        await chrome.storage.local.set({
          status: "PASSAGE EN CLASSIQUE",
          error: "Mode FPS detecte : passage automatique au curseur classique."
        });
        await sleep(150);
      } finally {
        gridshotModeSwitching = false;
      }
      return;
    }
    if (!gridshotStartClicked && game?.dataset.activeGame === "gridshot" && start) {
      const startRect = start.getBoundingClientRect();
      if (isVisibleRect(startRect)) {
        gridshotStartClicked = true;
        start.click();
      }
    }

    gridshotBusy = true;
    let batchHits = 0;
    try {
      for (const target of document.querySelectorAll('[data-gridshot-target]')) {
        if (!isHeld()) break;
        if (target.hidden || target.disabled) {
          gridshotPositions.delete(target);
          continue;
        }
        const rect = target.getBoundingClientRect();
        if (!isVisibleRect(rect)) {
          gridshotPositions.delete(target);
          continue;
        }

        const position = `${target.dataset.cell || ""}:${target.style.left}:${target.style.top}`;
        if (gridshotPositions.get(target) === position) continue;
        gridshotPositions.set(target, position);

        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (await dispatchGridshotClick(target, x, y)) batchHits++;
      }

      if (batchHits) {
        const stats = await chrome.storage.local.get(["detections", "clicks"]);
        void chrome.storage.local.set({
          status: `GRIDSHOT TURBO x${batchHits}`,
          detections: (stats.detections || 0) + batchHits,
          clicks: (stats.clicks || 0) + batchHits,
          error: ""
        });
      }
    } finally {
      gridshotBusy = false;
    }
  });
}

async function dispatchGridshotClick(target, x, y) {
  const onAimScientist = location.hostname === "aimscientist.com" || location.hostname.endsWith(".aimscientist.com");
  if (!onAimScientist) {
    dispatchClick(target, x, y);
    return true;
  }

  const fpsMode = document.querySelector('[data-fps-mode]')?.value;
  if (fpsMode === "fps" || document.pointerLockElement) {
    gridshotPositions.delete(target);
    await chrome.storage.local.set({
      status: "PASSAGE EN CLASSIQUE",
      error: "Mode FPS encore actif : conversion automatique en cours."
    });
    return false;
  }

  try {
    const response = await sendNativeScreenClick(x, y);
    if (!response?.ok) throw new Error(response?.error || "Clic natif refuse");
    // Le prochain cycle relit toujours la cible. Aucune attente de confirmation :
    // si le DOM n'a pas encore bouge, le clic est simplement retente a l'image suivante.
    gridshotPositions.delete(target);
    return true;
  } catch (error) {
    gridshotPositions.delete(target);
    await chrome.storage.local.set({ status: "ERREUR GRIDSHOT", error: error.message });
    return false;
  }
}

function sendNativeScreenClick(x, y) {
  const chromeLeft = window.screenX + Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const chromeTop = window.screenY + Math.max(0, window.outerHeight - window.innerHeight);
  return chrome.runtime.sendMessage({
    type: "native-click", x, y,
    screenX: chromeLeft + x,
    screenY: chromeTop + y
  });
}

function startReactionWatcher() {
  cancelAnimationFrame(reactionFrameId);
  const tick = () => {
    if (!observer || !isHeld()) return;
    const target = document.querySelector('[data-reaction-target]');
    const visible = Boolean(target && !target.hidden && isVisibleRect(target.getBoundingClientRect()));
    if (visible && !reactionWasVisible && !clickPending) {
      chrome.storage.local.get(SETTINGS_KEYS)
        .then(settings => triggerCandidate(target, settings));
    }
    reactionWasVisible = visible;
    reactionFrameId = requestAnimationFrame(tick);
  };
  reactionFrameId = requestAnimationFrame(tick);
}

async function triggerCandidate(candidate, settings) {
  if (!candidate || !isHeld() || clickPending) return;

  clickPending = true;
  const myGeneration = generation;
  const detections = (settings.detections || 0) + 1;
  const isReactionTarget = candidate.matches?.('[data-reaction-target]');
  // Le jeu classe explicitement une réaction < 100 ms comme faux départ.
  const configuredMin = Number(settings.minDelay ?? 150);
  const delay = randomInt(isReactionTarget ? Math.max(100, configuredMin) : configuredMin, settings.maxDelay ?? 400);
  const detectedAt = performance.now();
  const clickDeadline = detectedAt + delay;
  // Les écritures de statistiques ne doivent pas ajouter de latence au clic.
  void chrome.storage.local.set({ status: "CIBLE DÉTECTÉE", detections, lastDelay: delay });
  await sleep(Math.max(0, clickDeadline - performance.now()));
  const measuredDelay = performance.now() - detectedAt;
  const browserOverhead = Math.max(0, measuredDelay - delay);

  // Vérification impérative juste avant le clic.
  if (!isHeld() || myGeneration !== generation || !candidate.isConnected) {
    clickPending = false;
    return;
  }
  const rect = candidate.getBoundingClientRect();
  if (!isVisibleRect(rect) || (!isReactionTarget && !insideConfiguredRegion(rect, settings))) {
    clickPending = false;
    return;
  }
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const onAimScientist = location.hostname === "aimscientist.com" || location.hostname.endsWith(".aimscientist.com");
  if (onAimScientist) {
    void chrome.storage.local.set({
      requestedDelay: delay,
      measuredDelay: Math.round(measuredDelay * 10) / 10,
      browserOverhead: Math.round(browserOverhead * 10) / 10,
      error: ""
    });
  }
  if (isReactionTarget) {
    try {
      const response = await sendNativeScreenClick(x, y);
      if (!response?.ok) throw new Error(response?.error || "Clic natif refuse");
    } catch (error) {
      clickPending = false;
      await chrome.storage.local.set({ status: "ERREUR REACTION", error: error.message });
      return;
    }
  } else {
    const target = document.elementFromPoint(x, y) || candidate;
    dispatchClick(target, x, y);
  }
  const clickCount = (settings.clicks || 0) + 1;
  void chrome.storage.local.set({ status: "CLIC EFFECTUÉ", clicks: clickCount });

  // Exécution du 2ème clic si configuré
  if (settings.secondClickEnabled && settings.secondClickPoint) {
    const secondDelay = Number(settings.secondClickDelay ?? 100);
    await sleep(secondDelay);
    if (isHeld() && myGeneration === generation) {
      const sx = Math.round(settings.secondClickPoint.x * innerWidth);
      const sy = Math.round(settings.secondClickPoint.y * innerHeight);
      const secondTarget = document.elementFromPoint(sx, sy) || document.body;
      dispatchClick(secondTarget, sx, sy);
      if (typeof secondTarget.click === "function") {
        try { secondTarget.click(); } catch {}
      }
      void chrome.storage.local.set({ status: "2ND CLIC EFFECTUÉ" });
    }
  }

  await sleep(50);
  clickPending = false;
  if (isHeld()) await chrome.storage.local.set({ status: "TOUCHE MAINTENUE" });
}

function chooseCandidate(mutations, settings) {
  const candidates = new Set();
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      if (mutation.target.parentElement && !isIgnoredMutation(mutation.target.parentElement)) {
        candidates.add(mutation.target.parentElement);
      }
    } else {
      if (mutation.target instanceof Element && !isIgnoredMutation(mutation.target)) candidates.add(mutation.target);
      for (const node of mutation.addedNodes || []) {
        if (node instanceof Element && !isIgnoredMutation(node)) candidates.add(node);
        else if (node.parentElement && !isIgnoredMutation(node.parentElement)) candidates.add(node.parentElement);
      }
    }
  }
  const sensitivity = Number(settings.sensitivity ?? .88);
  const minArea = Math.max(1, (1 - sensitivity) * 500);
  let best = null;
  for (const changedElement of candidates) {
    const element = clickableTarget(changedElement);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < minArea || !isVisibleRect(rect) || !insideConfiguredRegion(rect, settings)) continue;
    // Préférer l'élément modifié le plus précis plutôt qu'un grand conteneur.
    if (!best || area < best.area) best = { element, area };
  }
  return best?.element || null;
}

function isIgnoredMutation(element) {
  // Compteurs, horloges et régions live évoluent en permanence sans devenir
  // une nouvelle cible. Le HTML fourni contient précisément role="timer".
  return Boolean(element.closest('time,[role="timer"],[data-launch-countdown],[data-countdown-unit]'));
}

function clickableTarget(element) {
  const selector = 'button:not([disabled]),a[href],input:not([disabled]),[role="button"],[onclick]';
  const direct = element.closest(selector);
  if (direct && isActuallyEnabled(direct)) return direct;
  if (element.matches(selector) && isActuallyEnabled(element)) return element;

  // Les applications React/Vue mettent souvent le gestionnaire sur un div,
  // sans attribut onclick. Un curseur pointer est alors le meilleur indice DOM.
  let current = element;
  for (let depth = 0; current && depth < 4; depth++, current = current.parentElement) {
    if (getComputedStyle(current).cursor === "pointer" && isActuallyEnabled(current)) return current;
  }

  // Si un nouveau bloc contient un unique contrôle, cliquer ce contrôle.
  const children = [...element.querySelectorAll(selector)].filter(isActuallyEnabled);
  return children.length === 1 ? children[0] : null;
}

function isActuallyEnabled(element) {
  return !element.matches('[disabled],[aria-disabled="true"]');
}

function isVisibleRect(rect) {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

function insideConfiguredRegion(rect, settings) {
  if (settings.searchMode !== "custom" || !settings.searchRegion) return true;
  const r = settings.searchRegion;
  const cx = (rect.left + rect.right) / 2 / innerWidth;
  const cy = (rect.top + rect.bottom) / 2 / innerHeight;
  return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
}

function dispatchClick(element, x, y) {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    const EventClass = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventClass(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      button: 0, buttons: type.endsWith("down") ? 1 : 0,
      pointerId: 1, pointerType: "mouse", isPrimary: true
    }));
  }
}

function beginRegionSelection() {
  if (selecting) return;
  selecting = true; pageHeld = false; externalHeld = false; stopMonitoring();
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(18,24,38,.18);user-select:none";
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;border:2px solid #6d5dfc;background:rgba(109,93,252,.15);display:none";
  const hint = document.createElement("div");
  hint.textContent = "Cliquez-glissez pour choisir la zone • Échap pour annuler";
  hint.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:9px;background:#111827;color:white;font:14px system-ui;box-shadow:0 8px 30px #0004";
  overlay.append(box, hint); document.documentElement.appendChild(overlay);
  let start = null;
  const cleanup = () => { selecting = false; overlay.remove(); };
  overlay.addEventListener("mousedown", e => { start = { x:e.clientX, y:e.clientY }; box.style.display="block"; });
  overlay.addEventListener("mousemove", e => {
    if (!start) return;
    const x=Math.min(start.x,e.clientX), y=Math.min(start.y,e.clientY);
    Object.assign(box.style,{left:`${x}px`,top:`${y}px`,width:`${Math.abs(e.clientX-start.x)}px`,height:`${Math.abs(e.clientY-start.y)}px`});
  });
  overlay.addEventListener("mouseup", async e => {
    if (!start) return;
    const x=Math.min(start.x,e.clientX), y=Math.min(start.y,e.clientY), width=Math.abs(e.clientX-start.x), height=Math.abs(e.clientY-start.y);
    if (width>=10 && height>=10) await chrome.storage.local.set({searchMode:"custom",searchRegion:{x:x/innerWidth,y:y/innerHeight,width:width/innerWidth,height:height/innerHeight}});
    cleanup();
  });
  window.addEventListener("keydown", function cancel(e){ if(e.code==="Escape"&&selecting){cleanup();window.removeEventListener("keydown",cancel,true);}},true);
}

function beginPointSelection() {
  if (selecting) return;
  selecting = true; pageHeld = false; externalHeld = false; stopMonitoring();
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(18,24,38,.25);user-select:none";
  const hint = document.createElement("div");
  hint.textContent = "Cliquez n'importe où sur l'écran pour définir le 2ème point de clic • Échap pour annuler";
  hint.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:9px;background:#111827;color:white;font:14px system-ui;box-shadow:0 8px 30px #0004;pointer-events:none";
  overlay.appendChild(hint); document.documentElement.appendChild(overlay);

  const cleanup = () => { selecting = false; overlay.remove(); };
  overlay.addEventListener("click", async e => {
    e.preventDefault(); e.stopPropagation();
    const point = { x: e.clientX / innerWidth, y: e.clientY / innerHeight };
    renderSecondClickMarker(point, true);
    await chrome.storage.local.set({ secondClickEnabled: true, secondClickPoint: point });
    cleanup();
  }, true);

  window.addEventListener("keydown", function cancel(e){ if(e.code==="Escape"&&selecting){cleanup();window.removeEventListener("keydown",cancel,true);}},true);
}

function renderSecondClickMarker(point, enabled) {
  let marker = document.getElementById("vision-clicker-second-point-marker");
  if (!enabled || !point) {
    marker?.remove();
    return;
  }
  if (!marker) {
    if (!document.getElementById("vision-clicker-styles")) {
      const style = document.createElement("style");
      style.id = "vision-clicker-styles";
      style.textContent = `@keyframes visionPulse { 0% { transform: scale(1); opacity: 0.95; } 50% { transform: scale(1.3); opacity: 0.4; } 100% { transform: scale(1); opacity: 0.95; } }`;
      (document.head || document.documentElement).appendChild(style);
    }
    marker = document.createElement("div");
    marker.id = "vision-clicker-second-point-marker";
    marker.title = "Point du 2ème clic (Vision Clicker)";
    marker.innerHTML = `<div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(126,108,246,0.3);border:2px solid #7e6cf6;box-shadow:0 0 14px #7e6cf6;animation:visionPulse 2s infinite;"></div>
      <div style="position:absolute;width:8px;height:8px;border-radius:50%;background:#ffffff;box-shadow:0 0 6px #ffffff;"></div>
      <span style="position:absolute;bottom:-20px;font:bold 10px system-ui,sans-serif;color:#8c7dff;background:#0d1325;padding:2px 6px;border-radius:4px;border:1px solid #303a58;white-space:nowrap;box-shadow:0 2px 8px #0008;pointer-events:none;">Clic 2</span>
    </div>`;
    marker.style.cssText = "position:fixed;z-index:2147483645;pointer-events:none;transform:translate(-50%,-50%);transition:left 0.15s ease, top 0.15s ease;";
    document.documentElement.appendChild(marker);
  }
  marker.style.left = `${point.x * 100}%`;
  marker.style.top = `${point.y * 100}%`;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randomInt(a,b) { const min=Math.max(0,Math.min(Number(a)||0,Number(b)||0)); const max=Math.max(min,Math.max(Number(a)||0,Number(b)||0)); return Math.floor(Math.random()*(max-min+1))+min; }
}
