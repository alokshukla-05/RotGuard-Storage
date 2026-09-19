// ============================================================
// SILO GUARD - APP.JS (v5 schema: nested status tree + HMAC-signed commands)
// ============================================================
//
// Matches firmware.ino v5.0.1. Two command paths exist on the
// device side:
//
//   1. LEGACY UNSIGNED — /siloSystem/control/{mode,fan,buzzer,emergency}
//      and /siloSystem/settings/{gasThreshold,warningThreshold,
//      harvestTimestamp,calibrateMQ,calibrateBattery,
//      batteryReferenceVoltage,restoreConfig}. readControl()/
//      readSettings() on the device read these directly — no
//      signature required. Fan, buzzer, mode, emergency, thresholds,
//      harvest date, MQ calibration, battery calibration and config
//      restore all use this path.
//
//   2. SIGNED ENVELOPE — /siloSystem/control/command and
//      /siloSystem/firmware/command. Every field is HMAC-SHA256
//      signed with a secret that must match OTA_HMAC_SECRET in the
//      firmware. Reboot, enabling/disabling the AI engine, and any
//      firmware deploy go through this path.
//
// The HMAC secret lives ONLY in the `hmacSecret` variable below —
// entered by the user each session via Settings, never written to
// Firebase, never persisted to disk. This is a workable model for a
// solo/hobby deployment; anything shared with other people should
// move signing into a small trusted backend instead.

import {
  auth,
  db,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  ref,
  onValue,
  update,
  remove
} from "./firebase-config.js";

// ============================================================
// CONFIG
// ============================================================

const DEVICE_ID = "silo-guard-01";
const OFFLINE_TIMEOUT = 15000;
const SENSOR_COUNT = 9;

const ZONES = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9]
};

// ============================================================
// STATE
// ============================================================

const state = {
  status: {},
  control: {},
  settings: {},
  events: {},
  history: {},
  firmware: {}
};

let started = false;
let hmacSecret = "";

let liveGasChart = null;
let zoneChart = null;
let gasHistoryChart = null;
let temperatureChart = null;
let humidityChart = null;
let batteryChart = null;

// ============================================================
// SHORTCUTS
// ============================================================

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setWidth(id, percent) {
  const el = $(id);
  if (el) el.style.width = Math.max(0, Math.min(100, percent)) + "%";
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Safe nested-path getter for the deeply nested v5 status tree,
// e.g. get(state.status, "gas.sensor1.raw", 0).
function get(obj, path, fallback) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return fallback;
    cur = cur[p];
  }
  return cur === undefined || cur === null ? fallback : cur;
}

// ============================================================
// TIME
// ============================================================

function formatTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "--";
  const date = new Date(n);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function formatClock(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "--";
  return new Date(n).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

// ============================================================
// TOAST
// ============================================================

function toast(message, type = "") {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.className = "toast show " + type;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = "toast"; }, 3500);
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = "Please wait...";
  } else if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
  }
}

// ============================================================
// MOBILE SIDEBAR
// ============================================================

function closeSidebar() {
  $("sidebar")?.classList.remove("open");
  $("sidebarOverlay")?.classList.add("hidden");
  $("menuToggle")?.setAttribute("aria-expanded", "false");
}

function openSidebar() {
  $("sidebar")?.classList.add("open");
  $("sidebarOverlay")?.classList.remove("hidden");
  $("menuToggle")?.setAttribute("aria-expanded", "true");
}

$("menuToggle")?.addEventListener("click", () => {
  $("sidebar")?.classList.contains("open") ? closeSidebar() : openSidebar();
});
$("sidebarOverlay")?.addEventListener("click", closeSidebar);

// ============================================================
// LOGIN / LOGOUT / AUTH
// ============================================================

$("loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const errorEl = $("loginError");
  const submitBtn = $("loginSubmit");
  if (errorEl) errorEl.textContent = "";

  const email = $("email")?.value.trim() || "";
  const password = $("password")?.value || "";

  if (!email || !password) {
    if (errorEl) errorEl.textContent = "Enter email and password.";
    return;
  }

  setBusy(submitBtn, true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(error);
    if (errorEl) errorEl.textContent = error.message || "Login failed.";
  } finally {
    setBusy(submitBtn, false);
  }
});

$("logoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    started = false;
  } catch (error) {
    toast(error.message || "Logout failed", "error");
  }
});

onAuthStateChanged(auth, user => {
  if (user) {
    $("loginScreen")?.classList.add("hidden");
    $("app")?.classList.remove("hidden");
    if (!started) {
      started = true;
      startDatabaseListeners();
    }
  } else {
    $("loginScreen")?.classList.remove("hidden");
    $("app")?.classList.add("hidden");
  }
});

// ============================================================
// NAVIGATION
// ============================================================

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
    closeSidebar();
  });
});

function openPage(page) {
  document.querySelectorAll(".page").forEach(s => s.classList.remove("active"));
  $(page)?.classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page === page));

  const titles = {
    dashboard: "System Dashboard", zones: "3-Zone Monitor", sensors: "Gas Sensors",
    analytics: "Analytics", control: "System Controls", history: "System History",
    settings: "System Settings", diagnostics: "Diagnostics", firmware: "Firmware Management"
  };
  setText("pageTitle", titles[page] || "SILO GUARD");
}

// ============================================================
// DATABASE LISTENERS
//
// Only four top-level nodes matter now: status (the whole nested
// tree), control (legacy fields the ack also lands under),
// settings (read-back for the input fields), and firmware
// (device/history — no more "latest" staging node). events and
// history are separate lists.
// ============================================================

function onDbError(label) {
  return error => {
    console.error(label + ":", error);
    toast("Cannot read " + label, "error");
  };
}

function startDatabaseListeners() {
  onValue(ref(db, "siloSystem/status"), snapshot => {
    state.status = snapshot.val() || {};
    renderAll();
  }, onDbError("status"));

  onValue(ref(db, "siloSystem/control"), snapshot => {
    state.control = snapshot.val() || {};
    renderControls();
  }, onDbError("control"));

  onValue(ref(db, "siloSystem/settings"), snapshot => {
    state.settings = snapshot.val() || {};
    renderSettingsInputs();
  }, onDbError("settings"));

  onValue(ref(db, "siloSystem/events"), snapshot => {
    state.events = snapshot.val() || {};
    renderEvents();
  }, onDbError("events"));

  onValue(ref(db, "siloSystem/history"), snapshot => {
    state.history = snapshot.val() || {};
    renderHistory();
    updateHistoryCharts();
  }, onDbError("history"));

  onValue(ref(db, "siloSystem/firmware"), snapshot => {
    state.firmware = snapshot.val() || {};
    renderFirmware();
  }, onDbError("firmware"));
}

function renderAll() {
  renderStatus();
  renderRiskAI();
  renderMQ();
  renderCuring();
  updateConnection();
  renderSensors();
  renderZones();
  updateLiveChart();
  renderFirmware();
}

// ============================================================
// STATUS
// ============================================================

function renderStatus() {
  const s = state.status;

  const dangerThreshold = num(state.settings.gasThreshold, 2000);
  const warningThreshold = num(state.settings.warningThreshold, 1500);
  const maxGas = num(get(s, "gas.max", 0));

  setText("maxGas", Math.round(maxGas));
  setText("averageGas", Math.round(num(get(s, "gas.average", 0))));
  setText("thresholdText", dangerThreshold);

  const trend = num(get(s, "gas.trendPerMinute", 0));
  setText("gasTrendText", `Trend: ${trend > 0 ? "+" : ""}${trend.toFixed(0)}/min`);

  const gasDanger = Boolean(get(s, "gas.detected", false));
  const warning = !gasDanger && maxGas >= warningThreshold;

  setWidth("gasProgress", (maxGas / 4095) * 100);
  const gasBar = $("gasProgress");
  if (gasBar) gasBar.className = gasDanger ? "danger" : warning ? "warning" : "";

  const battery = num(get(s, "battery.percentage", 0));
  setText("batteryVoltage", num(get(s, "battery.voltage", 0)).toFixed(2) + " V");
  setText("batteryPercentage", Math.round(battery) + "%");
  setWidth("batteryProgress", battery);
  const batteryBar = $("batteryProgress");
  if (batteryBar) batteryBar.className = get(s, "battery.critical", false) ? "danger" : get(s, "battery.low", false) ? "warning" : "";

  setText("internalTemp", num(get(s, "climate.internalTemperature", 0)).toFixed(1) + "°C");
  setText("internalHumidity", Math.round(num(get(s, "climate.internalHumidity", 0))) + "%");
  setText("externalTemp", num(get(s, "climate.externalTemperature", 0)).toFixed(1) + "°C");
  setText("externalHumidity", Math.round(num(get(s, "climate.externalHumidity", 0))) + "%");

  setText("fanStatus", get(s, "control.fan", false) ? "ACTIVE" : "STANDBY");
  setText("activeReason", get(s, "control.fanReason", "STANDBY"));
  setText("fillStatus", get(s, "fill.status", "0% (EMPTY)"));

  const zone = num(get(s, "localization.zone", -1));
  setText("activeZone", zone < 0 ? "None" : "Zone " + zone);
  setText("rotAngle", num(get(s, "localization.angle", 0)).toFixed(1) + "°");
  setText("localizationConfidence", Math.round(num(get(s, "localization.confidence", 0))) + "%");

  const manualOverride = Boolean(get(s, "control.hardwareSwitch", false));
  setText("manualOverride", manualOverride ? "ACTIVE (SWITCH ON)" : "OFF");
  setText("controlManualOverride", manualOverride ? "ACTIVE" : "OFF");

  const dhtFault = Boolean(get(s, "climate.dhtSafetyFault", false));
  setText("dhtSafetyFault", dhtFault ? "FAULT — FAN FORCED ON" : "OK");
  const dhtEl = $("dhtSafetyFault");
  if (dhtEl) dhtEl.className = dhtFault ? "danger-text" : "safe-text";

  setText("ipAddress", get(s, "diagnostics.ip", "--"));
  setText("wifiRSSI", get(s, "diagnostics.wifiRSSI", undefined) !== undefined ? get(s, "diagnostics.wifiRSSI", 0) + " dBm" : "--");
  setText("firmwareVersion", s.firmwareVersion || "--");
  setText("hardwareVersion", s.hardwareVersion || "--");

  const warmupComplete = Boolean(get(s, "gas.warmupComplete", false));
  $("warmupAlert")?.classList.toggle("hidden", warmupComplete);

  const alertEl = $("dangerAlert");
  alertEl?.classList.toggle("hidden", !gasDanger && !warning);
  setText("dangerMessage",
    gasDanger ? `Gas danger confirmed. Maximum ADC: ${Math.round(maxGas)}. Local fan safety is active.`
      : warning ? `Gas warning detected. Current ADC: ${Math.round(maxGas)}.`
      : "Gas level normal."
  );

  const badge = $("systemBadge");
  if (badge) {
    badge.className = "badge " + (gasDanger ? "danger" : warning ? "warning" : "safe");
    badge.textContent = gasDanger ? "GAS DANGER" : warning ? "GAS WARNING" : "SYSTEM SECURE";
  }

  setText("gasState", gasDanger ? "DANGER" : warning ? "WARNING" : "NORMAL");
  const gasStateEl = $("gasState");
  if (gasStateEl) gasStateEl.className = gasDanger ? "danger-text" : warning ? "warning-text" : "safe-text";
}

// ============================================================
// RISK / AI
// ============================================================

function renderRiskAI() {
  const s = state.status;

  const riskScore = num(get(s, "risk.score", 0));
  const riskLevel = get(s, "risk.level", "LOW");
  setText("riskScore", Math.round(riskScore));
  setText("riskLevel", riskLevel);
  const riskLevelEl = $("riskLevel");
  if (riskLevelEl) {
    riskLevelEl.className = riskLevel === "CRITICAL" || riskLevel === "HIGH" ? "danger-text"
      : riskLevel === "MEDIUM" ? "warning-text" : "safe-text";
  }
  setText("riskReason", get(s, "risk.reason", "Conditions currently stable"));
  setText("riskHumidity", Math.round(num(get(s, "risk.humidity", 0))));
  setText("riskTemperature", Math.round(num(get(s, "risk.temperature", 0))));
  setText("riskGasTrend", Math.round(num(get(s, "risk.gasTrend", 0))));

  const aiEnabled = Boolean(get(s, "ai.enabled", false));
  setText("aiStatusText", aiEnabled ? "Enabled" : "Disabled");
  $("aiIndicator")?.classList.toggle("on", aiEnabled);
  setText("aiFanRequest", get(s, "ai.fanRequest", false) ? "ON" : "OFF");
  const confidence = get(s, "ai.confidence", null);
  setText("aiConfidence", confidence === null ? "--" : Math.round(num(confidence)) + "%");
  setText("aiReason", get(s, "ai.reason", "--") || "--");
  setText("controlAiText", aiEnabled ? "ENABLED" : "DISABLED");
}

// ============================================================
// MQ WARMUP / CALIBRATION
// ============================================================

function renderMQ() {
  const s = state.status;
  const warmup = Boolean(get(s, "gas.warmupComplete", false));
  const calibrated = Boolean(get(s, "gas.calibrated", false));
  const qualityGood = Boolean(get(s, "gas.calibrationQualityGood", false));
  const variation = get(s, "gas.calibrationVariation", null);

  setText("mqWarmupStatus", warmup ? "COMPLETE" : "IN PROGRESS");
  setText("mqCalibratedStatus", calibrated ? "YES" : "NO");
  setText("mqQualityStatus", calibrated ? (qualityGood ? "GOOD" : "POOR — recalibrate") : "--");
  setText("mqVariation", variation === null ? "--" : num(variation).toFixed(1) + "%");
}

// ============================================================
// CURING
// ============================================================

function renderCuring() {
  const s = state.status;
  const active = Boolean(get(s, "curing.active", false));
  const harvestTs = num(get(s, "curing.harvestTimestamp", 0));
  const progress = num(get(s, "curing.progress", 0));

  setText("curingStatus", active ? "CURING ACTIVE" : harvestTs ? "CURING COMPLETE" : "HARVEST DATE NOT SET");
  setText("curingDay", active ? `${num(get(s, "curing.day", 0))} / 14 days` : harvestTs ? "14 / 14 days" : "0 / 14 days");
  setWidth("curingProgress", progress);
  setText("harvestDate", harvestTs ? formatTime(harvestTs) : "Not set");

  const harvestInput = $("harvestDateInput");
  if (harvestInput && document.activeElement !== harvestInput) {
    harvestInput.value = harvestTs ? new Date(harvestTs).toISOString().slice(0, 10) : "";
  }
}

$("saveHarvest")?.addEventListener("click", async event => {
  const value = $("harvestDateInput")?.value;
  if (!value) { toast("Pick a date first", "error"); return; }

  const epochSeconds = Math.floor(new Date(value + "T00:00:00").getTime() / 1000);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) { toast("Invalid date", "error"); return; }

  setBusy(event.currentTarget, true);
  try {
    await update(ref(db, "siloSystem/settings"), { harvestTimestamp: epochSeconds });
    toast("Curing started");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
});

$("clearHarvest")?.addEventListener("click", async event => {
  if (!confirm("Clear the harvest date and stop curing tracking?")) return;
  setBusy(event.currentTarget, true);
  try {
    await update(ref(db, "siloSystem/settings"), { harvestTimestamp: 0 });
    toast("Harvest date cleared");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
});

// ============================================================
// CONNECTION
// ============================================================

function updateConnection() {
  const timestamp = num(get(state.status, "timestamp", 0));
  const timeSynced = Boolean(state.status.timeSynced);
  const online = Boolean(state.status.online) && timeSynced && Date.now() - timestamp < OFFLINE_TIMEOUT;
  const syncing = timestamp > 0 && !timeSynced;

  $("connectionDot")?.classList.toggle("online", online);
  $("connectionDot")?.classList.toggle("offline", !online);

  setText("connectionText", online ? "Device Online" : syncing ? "Device Syncing Time" : "Device Offline");
  setText("lastSeen", online ? "Heartbeat " + formatClock(timestamp)
    : syncing ? "Waiting for NTP sync"
    : timestamp ? "Last seen " + formatTime(timestamp) : "Waiting for ESP32");
  setText("onlineCard", online ? "ONLINE" : "OFFLINE");
}

setInterval(updateConnection, 3000);

// ============================================================
// SENSORS
// ============================================================

function sensorLevel(value) {
  const danger = num(state.settings.gasThreshold, 2000);
  const warning = num(state.settings.warningThreshold, 1500);
  if (value >= danger) return { className: "danger", text: "DANGER" };
  if (value >= warning) return { className: "warning", text: "WARNING" };
  return { className: "normal", text: "NORMAL" };
}

function sensorCard(index) {
  const base = `gas.sensor${index}`;
  const filtered = num(get(state.status, `${base}.filtered`, 0));
  const raw = get(state.status, `${base}.raw`, null);
  const baseline = get(state.status, `${base}.baseline`, null);
  const delta = get(state.status, `${base}.delta`, null);
  const healthy = get(state.status, `${base}.healthy`, true);
  const fault = get(state.status, `${base}.fault`, false);
  const level = sensorLevel(filtered);

  return `
  <div class="sensor-card ${fault ? "danger" : level.className}">
    <div class="sensor-head">
      <strong>MQ-135 ${index}</strong>
      <span class="${fault ? "danger" : level.className}">${fault ? "FAULT" : level.text}</span>
    </div>
    <div class="sensor-number">${Math.round(filtered)}</div>
    <div class="sensor-detail">
      <small>raw ${raw === null ? "--" : Math.round(raw)}</small>
      <small>base ${baseline === null ? "--" : Math.round(baseline)}</small>
      <small>Δ ${delta === null ? "--" : Math.round(delta)}</small>
    </div>
    <div class="sensor-footer">
      <small>ADC</small>
      <small class="${healthy && !fault ? "ok" : "bad"}">${healthy && !fault ? "● HEALTHY" : "● FAULT"}</small>
    </div>
  </div>
  `;
}

function renderSensors() {
  let html = "";
  for (let i = 1; i <= SENSOR_COUNT; i++) html += sensorCard(i);
  const all = $("allSensors");
  const preview = $("sensorPreview");
  if (all) all.innerHTML = html;
  if (preview) preview.innerHTML = html;
}

// ============================================================
// ZONES
// ============================================================

function getZone(zone) {
  const base = `zones.zone${zone}`;
  return {
    peak: num(get(state.status, `${base}.peak`, 0)),
    average: num(get(state.status, `${base}.average`, 0)),
    danger: Boolean(get(state.status, `${base}.danger`, false)),
    warning: Boolean(get(state.status, `${base}.warning`, false))
  };
}

function zoneCard(zone) {
  const data = getZone(zone);
  const status = data.danger ? "DANGER" : data.warning ? "WARNING" : "NORMAL";
  const levelClass = data.danger ? "danger" : data.warning ? "warning" : "";

  return `
  <div class="zone-card ${levelClass}">
    <div class="zone-head">
      <strong>Zone ${zone}</strong>
      <span class="${levelClass}">${status}</span>
    </div>
    <div class="zone-number">${Math.round(data.peak)}</div>
    <small>Maximum gas ADC</small>
    <div class="zone-sensors">
      ${ZONES[zone].map(id => `
        <div>
          <small>MQ-${id}</small>
          <strong>${Math.round(num(get(state.status, `gas.sensor${id}.filtered`, 0)))}</strong>
        </div>
      `).join("")}
    </div>
    <div class="zone-average">Average: ${Math.round(data.average)}</div>
  </div>
  `;
}

function renderZones() {
  let html = "";
  [1, 2, 3].forEach(z => { html += zoneCard(z); });
  const cards = $("zoneCards");
  const preview = $("zonePreview");
  if (cards) cards.innerHTML = html;
  if (preview) preview.innerHTML = html;
  updateZoneChart();
}

// ============================================================
// CONTROLS (legacy unsigned fields)
// ============================================================

function renderControls() {
  const c = state.control;
  const s = state.status;

  const fan = Boolean(c.fan);
  const buzzer = Boolean(c.buzzer);
  const mode = String(c.mode || "AUTO").toUpperCase();

  setText("fanToggle", fan ? "FAN ON" : "FAN OFF");
  setText("buzzerToggle", buzzer ? "BUZZER ON" : "BUZZER OFF");
  setText("actualFanState", get(s, "control.fan", false) ? "ON" : "OFF");
  setText("activeFanReasonControl", get(s, "control.fanReason", "STANDBY"));
  setText("controlModeText", mode);

  $("autoMode")?.classList.toggle("active", mode === "AUTO");
  $("remoteMode")?.classList.toggle("active", mode === "REMOTE");
  $("maintenanceMode")?.classList.toggle("active", mode === "MAINTENANCE");

  $("fanIndicator")?.classList.toggle("on", Boolean(get(s, "control.fan", false)));
  $("buzzerIndicator")?.classList.toggle("on", Boolean(get(s, "control.buzzer", false)));

  const emergency = Boolean(c.emergency);
  setText("emergencyState", emergency ? "ACTIVE" : "CLEAR");
  const emergencyEl = $("emergencyState");
  if (emergencyEl) emergencyEl.className = emergency ? "danger-text" : "safe-text";
}

// Unsigned write — fan/buzzer/mode/emergency, matching the
// firmware's legacy read-only paths under /siloSystem/control.
async function writeControlLegacy(values, button) {
  setBusy(button, true);
  try {
    await update(ref(db, "siloSystem/control"), values);
    toast("Command sent");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

$("fanToggle")?.addEventListener("click", event => {
  writeControlLegacy({ fan: !Boolean(state.control.fan), mode: "REMOTE" }, event.currentTarget);
});
$("buzzerToggle")?.addEventListener("click", event => {
  writeControlLegacy({ buzzer: !Boolean(state.control.buzzer), mode: "REMOTE" }, event.currentTarget);
});
$("autoMode")?.addEventListener("click", event => writeControlLegacy({ mode: "AUTO" }, event.currentTarget));
$("remoteMode")?.addEventListener("click", event => writeControlLegacy({ mode: "REMOTE" }, event.currentTarget));
$("maintenanceMode")?.addEventListener("click", event => {
  if (!confirm("Switch to MAINTENANCE mode? The fan will be forced off regardless of sensors.")) return;
  writeControlLegacy({ mode: "MAINTENANCE" }, event.currentTarget);
});

$("emergencyBtn")?.addEventListener("click", event => {
  if (!confirm("Activate emergency?")) return;
  writeControlLegacy({ emergency: true, fan: true, buzzer: true, mode: "REMOTE" }, event.currentTarget);
});
$("resetEmergency")?.addEventListener("click", event => {
  if (!confirm("Reset emergency?")) return;
  writeControlLegacy({ emergency: false, fan: false, buzzer: false, mode: "AUTO" }, event.currentTarget);
});

// ============================================================
// HMAC SIGNING
//
// hmacSecret lives only in memory for this tab — set via the
// Settings page, never written to Firebase, cleared on reload.
// Canonical string must byte-for-byte match the firmware's:
//   commandId|commandAt(seconds)|target|command|payload
// ============================================================

function randomCommandId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendSignedCommand(command, payload, button) {
  if (!hmacSecret) {
    toast("Set the HMAC secret on Settings first", "error");
    return false;
  }

  setBusy(button, true);
  try {
    const commandId = randomCommandId();
    const commandAt = Math.floor(Date.now() / 1000);
    const target = DEVICE_ID;
    const canonical = `${commandId}|${commandAt}|${target}|${command}|${payload}`;
    const signature = await hmacSha256Hex(hmacSecret, canonical);

    await update(ref(db, "siloSystem/control/command"), {
      commandId, targetDevice: target, command, payload, signature, timestamp: commandAt
    });

    toast(`${command} command signed and sent`);
    return true;
  } catch (error) {
    console.error(error);
    toast(error.message || "Signing failed", "error");
    return false;
  } finally {
    setBusy(button, false);
  }
}

// ============================================================
// SETTINGS: HMAC SECRET
// ============================================================

$("saveSecret")?.addEventListener("click", () => {
  const value = $("hmacSecretInput")?.value.trim() || "";
  hmacSecret = value;
  setText("secretStatus", value ? "Secret set for this session (not saved anywhere)." : "No secret set this session.");
  if ($("hmacSecretInput")) $("hmacSecretInput").value = "";
  toast(value ? "Secret loaded for this session" : "Secret cleared");
});

// ============================================================
// AI ENABLE/DISABLE (signed)
// ============================================================

$("aiEnableBtn")?.addEventListener("click", event => sendSignedCommand("AI", "ON", event.currentTarget));
$("aiDisableBtn")?.addEventListener("click", event => sendSignedCommand("AI", "OFF", event.currentTarget));

// ============================================================
// REBOOT (signed)
// ============================================================

$("rebootBtn")?.addEventListener("click", event => {
  if (!confirm("Restart the ESP32? It will be offline for a few seconds. This is refused automatically if a firmware update is in progress.")) return;
  sendSignedCommand("REBOOT", "", event.currentTarget);
});

// ============================================================
// SENSOR MAINTENANCE (unsigned settings triggers)
// ============================================================

$("calibrateMqBtn")?.addEventListener("click", async event => {
  if (!confirm("Recalibrate MQ baselines now? Make sure the silo air is clean/onion-free.")) return;
  setBusy(event.currentTarget, true);
  try {
    await update(ref(db, "siloSystem/settings"), { calibrateMQ: true });
    toast("Calibration requested");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
});

$("restoreConfigBtn")?.addEventListener("click", async event => {
  if (!confirm("Restore configuration from the last cloud backup?")) return;
  setBusy(event.currentTarget, true);
  try {
    await update(ref(db, "siloSystem/settings"), { restoreConfig: true });
    toast("Config restore requested");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
});

$("calibrateBatteryBtn")?.addEventListener("click", async event => {
  const ref_ = num($("batteryRefInput")?.value, -1);
  if (ref_ < 6 || ref_ > 15) { toast("Enter a realistic voltage (6-15V)", "error"); return; }

  setBusy(event.currentTarget, true);
  try {
    await update(ref(db, "siloSystem/settings"), {
      calibrateBattery: true,
      batteryReferenceVoltage: ref_
    });
    toast("Battery calibration requested");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
});

// ============================================================
// SETTINGS INPUTS
// ============================================================

function renderSettingsInputs() {
  const gasInput = $("gasThresholdInput");
  const warnInput = $("warningThresholdInput");
  if (gasInput && document.activeElement !== gasInput) gasInput.value = num(state.settings.gasThreshold, 2000);
  if (warnInput && document.activeElement !== warnInput) warnInput.value = num(state.settings.warningThreshold, 1500);
  setText("configRestoreStatus", get(state.status, "diagnostics.configRestoreStatus", "NONE"));
}

async function saveThresholdField(inputId, dbKey, label, button) {
  const value = num($(inputId)?.value, -1);
  if (value < 0 || value > 4095) { toast("Invalid threshold", "error"); return; }

  setBusy(button, true);
  try {
    await update(ref(db, "siloSystem/settings"), { [dbKey]: value });
    toast(label + " saved");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

$("saveThreshold")?.addEventListener("click", event =>
  saveThresholdField("gasThresholdInput", "gasThreshold", "Danger threshold", event.currentTarget));
$("saveWarning")?.addEventListener("click", event =>
  saveThresholdField("warningThresholdInput", "warningThreshold", "Warning threshold", event.currentTarget));

// ============================================================
// DIAGNOSTICS
// ============================================================

function renderDiagnostics() {
  const s = state.status;

  setText("diagFirebase", get(s, "diagnostics.firebaseHealthy", false) ? "OK" : "FAULT");
  setText("diagWiFi", get(s, "diagnostics.wifiHealthy", false) ? "OK" : "FAULT");
  setText("diagDhtFault", get(s, "climate.dhtSafetyFault", false) ? "FAULT" : "OK");
  setText("diagFanFault", get(s, "diagnostics.fanFeedbackFault", false) ? "FAULT" : "OK");
  setText("diagFreeHeap", formatBytes(get(s, "diagnostics.freeHeap", null)));
  setText("diagMinHeap", formatBytes(get(s, "diagnostics.minFreeHeap", null)));
  setText("diagResetReason", get(s, "diagnostics.resetReason", "--"));
  setText("diagBootCount", get(s, "diagnostics.bootCount", "--"));

  const rollbackSupported = get(s, "diagnostics.otaRollbackSupported", false);
  const rollbackPending = get(s, "diagnostics.otaRollbackPending", false);
  setText("diagRollback", !rollbackSupported ? "UNSUPPORTED" : rollbackPending ? "PENDING VALIDATION" : "VALIDATED");

  const offline = get(s, "diagnostics.offlineEvents", 0);
  const recovered = get(s, "diagnostics.recoveredEvents", 0);
  setText("diagEventCounts", `${offline} queued / ${recovered} recovered`);

  let html = "";
  for (let i = 1; i <= SENSOR_COUNT; i++) {
    const fault = get(s, `gas.sensor${i}.fault`, false);
    html += `
      <div class="diag-row">
        <span>MQ-135 ${i}</span>
        <b class="${fault ? "bad" : "ok"}">${fault ? "FAULT" : "HEALTHY"}</b>
      </div>
    `;
  }
  const el = $("mqDiagnostics");
  if (el) el.innerHTML = html;
}

function formatBytes(value) {
  if (value === null || value === undefined) return "--";
  return (num(value) / 1024).toFixed(0) + " KB";
}

// ============================================================
// EVENTS FEED
// ============================================================

function renderEvents() {
  const el = $("eventsFeed");
  if (!el) return;

  const entries = Object.values(state.events || {})
    .sort((a, b) => num(b.timestamp, 0) - num(a.timestamp, 0))
    .slice(0, 20);

  if (!entries.length) {
    el.innerHTML = "No events yet.";
    return;
  }

  el.innerHTML = entries.map(e => `
    <div class="event-item">
      <strong>${e.type || "EVENT"}</strong>
      <span>${e.message || ""}</span>
      <small>${formatTime(e.timestamp)} — gas ${num(e.gas, 0)}${e.zone > 0 ? `, zone ${e.zone}` : ""}</small>
    </div>
  `).join("");
}

// ============================================================
// HISTORY
// ============================================================

function historyRows() {
  return Object.entries(state.history || {})
    .sort(([a], [b]) => Number(b) - Number(a))
    .slice(0, 500);
}

function renderHistory() {
  const rows = historyRows();
  const danger = num(state.settings.gasThreshold, 2000);
  const warning = num(state.settings.warningThreshold, 1500);

  setText("historyCount", `${Object.keys(state.history || {}).length} records`);

  const tbody = $("historyTable");
  if (!tbody) return;

  tbody.innerHTML = rows.map(([timestamp, x]) => {
    const max = num(x.maxGas, 0);
    const status = max >= danger ? "DANGER" : max >= warning ? "WARNING" : "NORMAL";
    const trend = num(x.gasTrend, 0);

    return `
      <tr>
        <td>${formatTime(timestamp)}</td>
        <td>${num(x.zone, -1) > 0 ? "Zone " + x.zone : "None"}</td>
        <td>${Math.round(max)}</td>
        <td>${Math.round(num(x.averageGas, 0))}</td>
        <td>${trend > 0 ? "+" : ""}${trend.toFixed(0)}</td>
        <td>${num(x.temperature, 0).toFixed(1)}°C</td>
        <td>${num(x.humidity, 0).toFixed(1)}%</td>
        <td>${num(x.battery, 0).toFixed(2)}V</td>
        <td>${x.fan ? "ON" : "OFF"}</td>
        <td>${x.storageRiskLevel || "--"}</td>
        <td class="${status === "DANGER" ? "danger-text" : status === "WARNING" ? "warning-text" : "safe-text"}">${status}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="11">No history available</td></tr>`;
}

$("clearHistory")?.addEventListener("click", async event => {
  if (!confirm("Delete all history?")) return;
  setBusy(event.currentTarget, true);
  try {
    await remove(ref(db, "siloSystem/history"));
    toast("History deleted");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
});

// ============================================================
// CHARTS
// ============================================================

function createChart(id, type, labels, datasets) {
  const canvas = $(id);
  if (!canvas || typeof Chart === "undefined") return null;
  return new Chart(canvas, {
    type, data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: "#8492a3", font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: "#8492a3", font: { size: 9 } }, grid: { color: "#1c2733" } },
        y: { beginAtZero: true, ticks: { color: "#8492a3", font: { size: 9 } }, grid: { color: "#1c2733" } }
      }
    }
  });
}

function initCharts() {
  liveGasChart = createChart("liveGasChart", "line", [], [
    { label: "Maximum Gas", data: [], tension: 0.3, pointRadius: 1, borderColor: "#ff5362", backgroundColor: "rgba(255,83,98,.15)" },
    { label: "Average Gas", data: [], tension: 0.3, pointRadius: 1, borderColor: "#438cff", backgroundColor: "rgba(67,140,255,.15)" }
  ]);
  zoneChart = createChart("zoneChart", "bar", ["Zone 1", "Zone 2", "Zone 3"], [
    { label: "Peak Gas", data: [0, 0, 0], backgroundColor: "#438cff" }
  ]);
  gasHistoryChart = createChart("gasHistoryChart", "line", [], [
    { label: "Maximum Gas", data: [], tension: 0.3, borderColor: "#ff5362", backgroundColor: "rgba(255,83,98,.15)" }
  ]);
  temperatureChart = createChart("temperatureChart", "line", [], [
    { label: "Temperature", data: [], tension: 0.3, borderColor: "#f4c04f", backgroundColor: "rgba(244,192,79,.15)" }
  ]);
  humidityChart = createChart("humidityChart", "line", [], [
    { label: "Humidity", data: [], tension: 0.3, borderColor: "#438cff", backgroundColor: "rgba(67,140,255,.15)" }
  ]);
  batteryChart = createChart("batteryChart", "line", [], [
    { label: "Battery", data: [], tension: 0.3, borderColor: "#2bd48a", backgroundColor: "rgba(43,212,138,.15)" }
  ]);
}

let lastLiveTimestamp = 0;

function updateLiveChart() {
  if (!liveGasChart) return;
  const timestamp = num(get(state.status, "timestamp", Date.now()));
  if (timestamp === lastLiveTimestamp) return;
  lastLiveTimestamp = timestamp;

  const labels = liveGasChart.data.labels;
  const max = liveGasChart.data.datasets[0].data;
  const avg = liveGasChart.data.datasets[1].data;

  labels.push(formatClock(timestamp));
  max.push(num(get(state.status, "gas.max", 0)));
  avg.push(num(get(state.status, "gas.average", 0)));

  while (labels.length > 40) { labels.shift(); max.shift(); avg.shift(); }
  liveGasChart.update("none");
}

function updateZoneChart() {
  if (!zoneChart) return;
  zoneChart.data.datasets[0].data = [getZone(1).peak, getZone(2).peak, getZone(3).peak];
  zoneChart.update("none");
}

function updateHistoryCharts() {
  const rows = historyRows().reverse();
  const labels = rows.map(([timestamp]) => formatClock(timestamp));
  updateChart(gasHistoryChart, labels, rows.map(([, x]) => num(x.maxGas, 0)));
  updateChart(temperatureChart, labels, rows.map(([, x]) => num(x.temperature, 0)));
  updateChart(humidityChart, labels, rows.map(([, x]) => num(x.humidity, 0)));
  updateChart(batteryChart, labels, rows.map(([, x]) => num(x.battery, 0)));
}

function updateChart(chart, labels, data) {
  if (!chart) return;
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update("none");
}

// ============================================================
// FIRMWARE OTA
//
// No more "latest" staging node — device.state/progress/error and
// history are the only device-side firmware nodes now. History
// entries are pushed (Firebase auto-IDs), so they carry their own
// timestamp field rather than being keyed by one.
// ============================================================

function getFirmwareDevice() {
  return state.firmware.device || {};
}

function renderFirmware() {
  const device = getFirmwareDevice();
  const s = state.status;

  setText("otaDeviceId", s.deviceId || DEVICE_ID);
  setText("otaCurrentVersion", s.firmwareVersion || "--");
  setText("otaCurrentBuild", s.firmwareBuild || "--");
  setText("otaCurrentHardware", s.hardwareVersion || "--");
  setText("otaState", device.state || "IDLE");
  setText("otaProgressText", num(device.progress, 0) + "%");

  const deviceState = device.state || "IDLE";
  const liveStates = ["CONNECTING", "DOWNLOADING", "INSTALLING"];
  const otaInProgress = liveStates.includes(deviceState);

  const deployBtn = $("deployFirmware");
  if (deployBtn) deployBtn.disabled = otaInProgress;

  const otaBadge = $("otaBadge");
  if (otaBadge) {
    if (otaInProgress) {
      otaBadge.textContent = deviceState;
      otaBadge.className = "badge warning";
    } else if (deviceState === "FAILED" || deviceState === "REJECTED") {
      otaBadge.textContent = deviceState;
      otaBadge.className = "badge danger";
    } else if (deviceState === "SUCCESS") {
      otaBadge.textContent = "OTA READY";
      otaBadge.className = "badge safe";
    } else {
      otaBadge.textContent = "OTA READY";
      otaBadge.className = "badge safe";
    }
  }

  renderFirmwareHistory();
}

function renderFirmwareHistory() {
  const history = state.firmware.history || {};
  const entries = Object.values(history)
    .sort((a, b) => num(b.timestamp, 0) - num(a.timestamp, 0))
    .slice(0, 20);

  const el = $("firmwareHistory");
  if (!el) return;

  if (!entries.length) { el.innerHTML = "No firmware releases."; return; }

  el.innerHTML = entries.map(x => `
    <div class="firmware-history-item">
      <strong>${x.state || "--"} — v${x.firmwareVersion || "--"}</strong>
      <span>${x.error || "No error"}</span>
      <small>${formatTime(x.timestamp)}</small>
    </div>
  `).join("");
}

async function calculateSHA256(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

let pendingFirmwareHash = "";
let pendingFirmwareSize = 0;

$("firmwareFile")?.addEventListener("change", async event => {
  const file = event.currentTarget.files[0];
  const hashStatus = $("hashStatus");
  const hashDisplay = $("computedHash");

  pendingFirmwareHash = "";
  pendingFirmwareSize = 0;

  if (!file) {
    if (hashStatus) hashStatus.textContent = "No file selected.";
    if (hashDisplay) hashDisplay.textContent = "--";
    return;
  }
  if (!file.name.toLowerCase().endsWith(".bin")) {
    toast("Only .bin files allowed", "error");
    event.currentTarget.value = "";
    return;
  }

  if (hashStatus) hashStatus.textContent = "Calculating SHA-256...";
  try {
    const buffer = await file.arrayBuffer();
    const sha256 = await calculateSHA256(buffer);
    pendingFirmwareHash = sha256;
    pendingFirmwareSize = file.size;
    if (hashDisplay) hashDisplay.textContent = sha256;
    if (hashStatus) hashStatus.textContent = `${file.name} — ${(file.size / 1024).toFixed(1)} KB.`;
  } catch (error) {
    console.error(error);
    if (hashStatus) hashStatus.textContent = "Could not hash file.";
    toast(error.message || "Hashing failed", "error");
  }
});

// The OTA manifest canonical string is DIFFERENT from the plain
// command envelope — it must match validateOTAManifest() exactly:
//   commandId|commandAt|DEVICE_ID|OTA|url|version|build|hash|fileSize
$("deployFirmware")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const url = $("firmwareUrlInput")?.value.trim() || "";
  const version = $("firmwareVersionInput")?.value.trim() || "";
  const build = num($("firmwareBuildInput")?.value, 0);
  const hardware = $("firmwareHardwareInput")?.value.trim() || "";
  const statusEl = $("uploadStatus");

  if (!hmacSecret) { toast("Set the HMAC secret on Settings first", "error"); return; }
  if (!url || !/^https:\/\//i.test(url)) { toast("Paste a valid https:// GitHub Release asset URL", "error"); return; }
  if (!version) { toast("Enter firmware version", "error"); return; }
  if (build <= 0) { toast("Enter valid build", "error"); return; }
  if (!hardware) { toast("Enter hardware version", "error"); return; }
  if (!pendingFirmwareHash) { toast("Select the .bin locally first so its hash can be signed", "error"); return; }

  const currentBuild = num(state.status.firmwareBuild, 0);
  if (build <= currentBuild) { toast(`Build must be greater than ${currentBuild}`, "error"); return; }

  if (!confirm(`Deploy v${version} build ${build} to ${DEVICE_ID}? This is signed and cannot be recalled once the device picks it up.`)) return;

  setBusy(button, true);
  if (statusEl) statusEl.textContent = "Signing manifest...";

  try {
    const commandId = randomCommandId();
    const commandAt = Math.floor(Date.now() / 1000);
    const canonical = `${commandId}|${commandAt}|${DEVICE_ID}|OTA|${url}|${version}|${build}|${pendingFirmwareHash}|${pendingFirmwareSize}`;
    const signature = await hmacSha256Hex(hmacSecret, canonical);

    await update(ref(db, "siloSystem/firmware/command"), {
      commandId,
      targetDevice: DEVICE_ID,
      firmwareUrl: url,
      firmwareVersion: version,
      firmwareBuild: build,
      firmwareSha256: pendingFirmwareHash,
      firmwareSize: pendingFirmwareSize,
      hardwareVersion: hardware,
      signature,
      timestamp: commandAt
    });

    if (statusEl) statusEl.textContent = "Signed manifest sent. Watch the OTA state above.";
    toast("Deploy signed and sent");
  } catch (error) {
    console.error("OTA deploy:", error);
    if (statusEl) statusEl.textContent = "Deploy failed.";
    toast(error.message || "Deploy failed", "error");
  } finally {
    setBusy(button, false);
  }
});

// ============================================================
// CLOCK
// ============================================================

function updateClock() {
  setText("clock", new Date().toLocaleTimeString("en-IN"));
}
setInterval(updateClock, 1000);
updateClock();

// Diagnostics/events don't have their own onValue-triggered render
// hooked to status updates elsewhere, so refresh them on the same
// cadence as the rest of the status tree.
const _origRenderAll = renderAll;
renderAll = function patchedRenderAll() {
  _origRenderAll();
  renderDiagnostics();
};

// ============================================================
// CHART INIT — safe to call directly; type="module" defers
// execution until after the document has been parsed.
// ============================================================

initCharts();
