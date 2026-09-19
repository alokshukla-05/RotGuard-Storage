// ============================================================
// SILO GUARD - APP.JS (v5, matches firmware.ino v5.0.1)
// ============================================================
//
// Schema notes (v5 breaking change from earlier dashboard versions):
//   - All live telemetry now lives under one nested node,
//     /siloSystem/status, with nested groups: gas, zones,
//     localization, climate, battery, fill, control, ai, risk,
//     diagnostics, curing. There are no more separate top-level
//     /siloSystem/sensors or /siloSystem/zones or
//     /siloSystem/diagnostics nodes — the firmware stopped writing
//     those.
//   - /siloSystem/control still holds the legacy unsigned fields
//     (mode, fan, buzzer, emergency) the firmware reads directly,
//     PLUS a `command` child (the new HMAC-signed envelope) and an
//     `ack` child the firmware writes back after processing one.
//   - REBOOT, AI on/off, MQ calibration, and config restore only
//     exist behind the signed command envelope now — there is no
//     unsigned fallback for those on the firmware side.
//   - OTA has no more Firebase Storage / "latest" staging step:
//     the firmware reads a fully-formed, HMAC-signed manifest
//     straight off /siloSystem/firmware/command.
//
// SECURITY NOTE: the HMAC secret entered on the Controls page lives
// only in a JS variable for this tab (never written to Firebase,
// localStorage, or anywhere else) and is used locally to sign what
// you submit. That's adequate for a single-operator hobby setup.
// For anything with more than one trusted operator, move signing
// into a small server-side function instead of trusting every
// browser tab with the raw secret.
// ============================================================

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
  status: {},       // /siloSystem/status (nested)
  control: {},       // /siloSystem/control (legacy fields + command/ack)
  settings: {},
  history: {},
  firmware: {},       // /siloSystem/firmware (device/command/history)
  events: {},
  notifications: {}
};

let started = false;
let hmacSecret = "";

let liveGasChart = null;
let zoneChart = null;
let gasHistoryChart = null;
let temperatureChart = null;
let humidityChart = null;
let batteryChart = null;
let riskChart = null;

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
  if (el) el.style.width = percent + "%";
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function g(path, fallback) {
  // Safe getter into nested status object, e.g. g("gas.max", 0)
  const parts = path.split(".");
  let node = state.status;
  for (const part of parts) {
    if (node == null || typeof node !== "object") return fallback;
    node = node[part];
  }
  return node === undefined || node === null ? fallback : node;
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
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
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
// HMAC SIGNING
//
// Mirrors firmware.ino's hmacSha256Hex()/authenticateCommand()
// canonical form exactly: commandId|commandAt|target|command|payload
// (OTA manifests use a different, longer canonical — see deploySignedFirmware).
// ============================================================

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function newCommandId() {
  return "cmd-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

async function sendSignedCommand(command, payload, button) {
  if (!hmacSecret) {
    toast("Enter the HMAC secret above first", "error");
    return false;
  }

  const commandId = newCommandId();
  const commandAt = Math.floor(Date.now() / 1000);
  const canonical = `${commandId}|${commandAt}|${DEVICE_ID}|${command}|${payload}`;

  setBusy(button, true);
  try {
    const signature = await hmacSha256Hex(hmacSecret, canonical);
    await update(ref(db, "siloSystem/control/command"), {
      commandId,
      targetDevice: DEVICE_ID,
      command,
      payload,
      signature,
      timestamp: commandAt
    });
    toast(command + " command sent");
    return true;
  } catch (error) {
    console.error(error);
    toast(error.message || "Failed to send command", "error");
    return false;
  } finally {
    setBusy(button, false);
  }
}

$("hmacSecretInput")?.addEventListener("input", event => {
  hmacSecret = event.currentTarget.value;
  const statusEl = $("hmacStatus");
  if (statusEl) {
    statusEl.textContent = hmacSecret
      ? "Secret set for this tab — signed commands will be accepted."
      : "Not set — signed commands will be rejected by the device.";
  }
});

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

  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.page === page);
  });

  const titles = {
    dashboard: "System Dashboard",
    zones: "3-Zone Monitor",
    sensors: "Gas Sensors",
    intelligence: "AI & Risk",
    analytics: "Analytics",
    control: "System Controls",
    history: "System History",
    events: "Events & Notifications",
    settings: "System Settings",
    diagnostics: "Diagnostics",
    firmware: "Firmware Management"
  };
  setText("pageTitle", titles[page] || "SILO GUARD");
}

// ============================================================
// DATABASE LISTENERS
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
    renderStatus();
    renderCuring();
    updateConnection();
    updateLiveChart();
    renderSensors();
    renderZones();
    renderIntelligence();
    renderDiagnostics();
    renderFirmware();
  }, onDbError("status"));

  onValue(ref(db, "siloSystem/control"), snapshot => {
    state.control = snapshot.val() || {};
    renderControls();
  }, onDbError("control"));

  onValue(ref(db, "siloSystem/settings"), snapshot => {
    state.settings = snapshot.val() || {};
    renderSettings();
  }, onDbError("settings"));

  onValue(ref(db, "siloSystem/history"), snapshot => {
    state.history = snapshot.val() || {};
    renderHistory();
    updateHistoryCharts();
  }, onDbError("history"));

  onValue(ref(db, "siloSystem/firmware"), snapshot => {
    state.firmware = snapshot.val() || {};
    renderFirmware();
  }, onDbError("firmware"));

  onValue(ref(db, "siloSystem/events"), snapshot => {
    state.events = snapshot.val() || {};
    renderEvents();
  }, onDbError("events"));

  onValue(ref(db, "siloSystem/notifications"), snapshot => {
    state.notifications = snapshot.val() || {};
    renderEvents();
  }, onDbError("notifications"));

}

// ============================================================
// STATUS
// ============================================================

function renderStatus() {
  const dangerThreshold = num(state.settings.gasThreshold, 2000);
  const warningThreshold = num(state.settings.warningThreshold, 1500);
  const maxGas = num(g("gas.max"), 0);
  const gasDanger = Boolean(g("gas.detected"));
  const warning = !gasDanger && maxGas >= warningThreshold;

  setText("maxGas", Math.round(maxGas));
  setText("averageGas", Math.round(num(g("gas.average"), 0)));
  setText("thresholdText", dangerThreshold);

  const trend = num(g("gas.trendPerMinute"), 0);
  setText("gasTrendText", (trend >= 0 ? "+" : "") + trend.toFixed(0) + "/min");

  setWidth("gasProgress", Math.min(100, (maxGas / 4095) * 100));
  const gasBar = $("gasProgress");
  if (gasBar) gasBar.className = gasDanger ? "danger" : warning ? "warning" : "";

  const battery = num(g("battery.percentage"), 0);
  setText("batteryVoltage", num(g("battery.voltage"), 0).toFixed(2) + " V");
  setText("batteryPercentage", Math.round(battery) + "%");
  setWidth("batteryProgress", Math.max(0, Math.min(100, battery)));
  const batteryBar = $("batteryProgress");
  if (batteryBar) batteryBar.className = g("battery.critical") ? "danger" : g("battery.low") ? "warning" : "";

  const riskScore = num(g("risk.score"), 0);
  const riskLevel = g("risk.level", "LOW");
  setText("riskScore", Math.round(riskScore));
  setText("riskLevel", riskLevel);
  const riskLevelEl = $("riskLevel");
  if (riskLevelEl) {
    riskLevelEl.className =
      riskLevel === "CRITICAL" || riskLevel === "HIGH" ? "danger-text" :
      riskLevel === "MEDIUM" ? "warning-text" : "safe-text";
  }

  setText("internalTemp", num(g("climate.internalTemperature"), 0).toFixed(1) + "°C");
  setText("internalHumidity", Math.round(num(g("climate.internalHumidity"), 0)) + "%");
  setText("externalTemp", num(g("climate.externalTemperature"), 0).toFixed(1) + "°C");
  setText("externalHumidity", Math.round(num(g("climate.externalHumidity"), 0)) + "%");

  const dhtFault = Boolean(g("climate.dhtSafetyFault"));
  setText("dhtSafetyFaultText", dhtFault ? "YES — forcing fan on" : "NO");
  const dhtFaultEl = $("dhtSafetyFaultText");
  if (dhtFaultEl) dhtFaultEl.className = dhtFault ? "danger-text" : "safe-text";

  const fanOn = Boolean(g("control.fan"));
  const fanReason = g("control.fanReason", "STANDBY");
  setText("fanStatus", fanOn ? "ACTIVE" : "STANDBY");
  setText("activeReason", fanReason);
  setText("fillStatus", g("fill.status", "0% (EMPTY)"));

  const zone = num(g("localization.zone"), -1);
  setText("activeZone", zone < 0 ? "None" : "Zone " + zone);
  setText("rotAngle", num(g("localization.angle"), 0).toFixed(1) + "°");
  setText("localizationConfidence", num(g("localization.confidence"), 0).toFixed(0) + "%");

  setText("manualOverride", g("control.hardwareSwitch") ? "ACTIVE (SWITCH ON)" : "OFF");

  setText("ipAddress", g("diagnostics.ip", "--"));
  const rssi = g("diagnostics.wifiRSSI");
  setText("wifiRSSI", rssi !== undefined && rssi !== null ? rssi + " dBm" : "--");
  setText("firmwareVersion", state.status.firmwareVersion || "--");
  setText("hardwareVersion", state.status.hardwareVersion || "--");
  setText("configVersionText", g("diagnostics.configVersion", "--"));

  // Sensor-safety override (MQ warmup/fault or DHT staleness forcing the
  // fan on) is a distinct, less severe state than a confirmed gas alarm —
  // shown as a separate amber banner rather than folded into the red one.
  const mqSafetyOverride = fanReason === "MQ SENSOR SAFETY";
  const dhtSafetyOverride = fanReason === "DHT SENSOR SAFETY";
  const safetyOverrideAlert = $("safetyFaultAlert");
  if (safetyOverrideAlert) {
    safetyOverrideAlert.classList.toggle("hidden", !(mqSafetyOverride || dhtSafetyOverride) || gasDanger);
    setText(
      "safetyFaultMessage",
      mqSafetyOverride
        ? "One or more MQ-135 sensors are faulted or still warming up — ventilation is on as a precaution."
        : "DHT sensor readings are stale — ventilation is on as a precaution."
    );
  }

  const alertEl = $("dangerAlert");
  alertEl?.classList.toggle("hidden", !gasDanger && !warning);
  setText(
    "dangerMessage",
    gasDanger
      ? `Gas danger confirmed. Maximum ADC: ${Math.round(maxGas)}. Local fan safety is active.`
      : warning
        ? `Gas warning detected. Current ADC: ${Math.round(maxGas)}.`
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
// CURING
// ============================================================

function renderCuring() {
  const active = Boolean(g("curing.active"));
  const harvestTs = g("curing.harvestTimestamp", 0);
  const progress = Math.max(0, Math.min(100, num(g("curing.progress"), 0)));

  setText(
    "curingStatus",
    active ? "CURING ACTIVE" : harvestTs ? "CURING COMPLETE" : "HARVEST DATE NOT SET"
  );
  setText(
    "curingDay",
    active ? `${num(g("curing.day"), 0)} / 14 days` : harvestTs ? "14 / 14 days" : "0 / 14 days"
  );
  setWidth("curingProgress", progress);
  setText("harvestDate", harvestTs ? formatTime(harvestTs) : "Not set");

  const harvestInput = $("harvestDateInput");
  if (harvestInput && document.activeElement !== harvestInput) {
    harvestInput.value = harvestTs ? new Date(num(harvestTs, 0)).toISOString().slice(0, 10) : "";
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
//
// v5 writes online:true and timestamp (real epoch ms, or 0 if NTP
// hasn't synced yet — timestampMs() no longer falls back to
// millis()) on every successful telemetry write.
// ============================================================

function updateConnection() {
  const timestamp = num(state.status.timestamp, 0);
  const synced = Boolean(state.status.timeSynced);
  const online = timestamp > 0 && Date.now() - timestamp < OFFLINE_TIMEOUT;
  const syncing = !synced && Boolean(state.status.online);

  $("connectionDot")?.classList.toggle("online", online);
  $("connectionDot")?.classList.toggle("offline", !online);

  setText("connectionText", online ? "Device Online" : syncing ? "Device Syncing Time" : "Device Offline");
  setText(
    "lastSeen",
    online ? "Heartbeat " + formatClock(timestamp)
      : syncing ? "Waiting for NTP sync"
        : timestamp ? "Last seen " + formatTime(timestamp)
          : "Waiting for ESP32"
  );
  setText("onlineCard", online ? "ONLINE" : "OFFLINE");
}

setInterval(updateConnection, 3000);

// ============================================================
// MQ WARMUP / CALIBRATION STATUS
// ============================================================

function renderMqStatus() {
  const warmupComplete = Boolean(g("gas.warmupComplete"));
  const calibrated = Boolean(g("gas.calibrated"));
  const qualityGood = Boolean(g("gas.calibrationQualityGood"));
  const variation = num(g("gas.calibrationVariation"), 0);

  setText("mqWarmupStatus", warmupComplete ? "Complete" : "In progress (~60s from boot)");
  setText("mqCalibratedStatus", calibrated ? "YES" : "NO");
  setText("mqQualityStatus", calibrated ? (qualityGood ? "GOOD" : "POOR — recalibrate") : "--");
  setText("mqVariationStatus", calibrated ? variation.toFixed(1) + "%" : "--");

  const qualityEl = $("mqQualityStatus");
  if (qualityEl) qualityEl.className = !calibrated ? "" : qualityGood ? "safe-text" : "warning-text";
}

// ============================================================
// SENSOR CARD
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
  const filtered = num(g(base + ".filtered"), 0);
  const raw = num(g(base + ".raw"), 0);
  const baseline = num(g(base + ".baseline"), 0);
  const delta = num(g(base + ".delta"), 0);
  const healthy = g(base + ".healthy") !== false;
  const fault = Boolean(g(base + ".fault"));

  const level = sensorLevel(filtered);
  const cardClass = fault ? "fault" : level.className;

  return `
  <div class="sensor-card ${cardClass}">
    <div class="sensor-head">
      <strong>MQ-135 ${index}</strong>
      <span class="${level.className}">${fault ? "FAULT" : level.text}</span>
    </div>
    <div class="sensor-number">${Math.round(filtered)}</div>
    <div class="sensor-delta">raw ${Math.round(raw)} · baseline ${Math.round(baseline)} · Δ${Math.round(delta)}</div>
    <div class="sensor-footer">
      <small>filtered ADC</small>
      <small class="${healthy && !fault ? "ok" : "bad"}">${healthy && !fault ? "● HEALTHY" : "● FAULT"}</small>
    </div>
  </div>
  `;
}

function renderSensors() {
  renderMqStatus();

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
    peak: num(g(base + ".peak"), 0),
    average: num(g(base + ".average"), 0),
    danger: Boolean(g(base + ".danger")),
    warning: Boolean(g(base + ".warning"))
  };
}

function zoneCard(zone) {
  const data = getZone(zone);
  const levelClass = data.danger ? "danger" : data.warning ? "warning" : "";
  const status = data.danger ? "DANGER" : data.warning ? "WARNING" : "NORMAL";

  return `
  <div class="zone-card ${levelClass}">
    <div class="zone-head">
      <strong>Zone ${zone}</strong>
      <span class="${levelClass}">${status}</span>
    </div>
    <div class="zone-number">${Math.round(data.peak)}</div>
    <small>Maximum gas ADC (filtered)</small>
    <div class="zone-sensors">
      ${ZONES[zone].map(id => `
        <div>
          <small>MQ-${id}</small>
          <strong>${Math.round(num(g(`gas.sensor${id}.filtered`), 0))}</strong>
        </div>
      `).join("")}
    </div>
    <div class="zone-average">Average: ${Math.round(data.average)}</div>
  </div>
  `;
}

function renderZones() {
  let html = "";
  [1, 2, 3].forEach(zone => { html += zoneCard(zone); });

  const cards = $("zoneCards");
  const preview = $("zonePreview");
  if (cards) cards.innerHTML = html;
  if (preview) preview.innerHTML = html;

  updateZoneChart();
}

// ============================================================
// AI & RISK
// ============================================================

function renderIntelligence() {
  const aiEnabled = Boolean(g("ai.enabled"));
  const aiFanRequest = Boolean(g("ai.fanRequest"));

  setText("aiEnabledText", aiEnabled ? "YES" : "NO");
  setText("aiFanRequestText", aiEnabled ? (aiFanRequest ? "YES" : "NO") : "--");
  setText("aiConfidenceText", num(g("ai.confidence"), 0).toFixed(0) + "%");
  setText("aiReasonText", g("ai.reason", "--") || "--");
  setText("aiControlStatus", aiEnabled ? "ENABLED" : "DISABLED");

  const riskScore = num(g("risk.score"), 0);
  const riskLevel = g("risk.level", "LOW");

  setText("riskScoreDetail", `${Math.round(riskScore)} / 100`);
  setText("riskLevelDetail", riskLevel);
  setText("riskReasonDetail", g("risk.reason", "--") || "--");
  setText("riskHumidity", num(g("risk.humidity"), 0).toFixed(1));
  setText("riskTemperature", num(g("risk.temperature"), 0).toFixed(1));
  setText("riskGasTrend", num(g("risk.gasTrend"), 0).toFixed(1));

  const levelEl = $("riskLevelDetail");
  if (levelEl) {
    levelEl.className =
      riskLevel === "CRITICAL" || riskLevel === "HIGH" ? "danger-text" :
      riskLevel === "MEDIUM" ? "warning-text" : "safe-text";
  }
}

// ============================================================
// CONTROLS
// ============================================================

function renderControls() {
  const c = state.control;
  const fan = Boolean(c.fan);
  const buzzer = Boolean(c.buzzer);
  const mode = String(c.mode || "AUTO").toUpperCase();

  setText("fanToggle", fan ? "FAN ON" : "FAN OFF");
  setText("buzzerToggle", buzzer ? "BUZZER ON" : "BUZZER OFF");
  setText("actualFanState", g("control.fan") ? "ON" : "OFF");
  setText("activeFanReasonControl", g("control.fanReason", "STANDBY"));
  setText("controlModeText", mode);

  $("autoMode")?.classList.toggle("active", mode === "AUTO");
  $("remoteMode")?.classList.toggle("active", mode === "REMOTE");
  $("maintenanceMode")?.classList.toggle("active", mode === "MAINTENANCE");

  $("fanIndicator")?.classList.toggle("on", Boolean(g("control.fan")));
  $("buzzerIndicator")?.classList.toggle("on", Boolean(g("control.buzzer")));

  setText("emergencyState", c.emergency ? "ACTIVE" : "CLEAR");
  const emergencyEl = $("emergencyState");
  if (emergencyEl) emergencyEl.className = c.emergency ? "danger-text" : "safe-text";

  setText("configRestoreStatus", g("diagnostics.configRestoreStatus", "NONE"));
}

async function writeControl(values, button) {
  setBusy(button, true);
  try {
    await update(ref(db, "siloSystem/control"), values);
    toast("Command sent");
  } catch (error) {
    console.error(error);
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

$("fanToggle")?.addEventListener("click", event => {
  writeControl({ fan: !Boolean(state.control.fan), mode: "REMOTE" }, event.currentTarget);
});

$("buzzerToggle")?.addEventListener("click", event => {
  writeControl({ buzzer: !Boolean(state.control.buzzer), mode: "REMOTE" }, event.currentTarget);
});

$("autoMode")?.addEventListener("click", event => writeControl({ mode: "AUTO" }, event.currentTarget));
$("remoteMode")?.addEventListener("click", event => writeControl({ mode: "REMOTE" }, event.currentTarget));
$("maintenanceMode")?.addEventListener("click", event => writeControl({ mode: "MAINTENANCE" }, event.currentTarget));

$("emergencyBtn")?.addEventListener("click", event => {
  if (!confirm("Activate emergency?")) return;
  writeControl({ emergency: true, fan: true, buzzer: true, mode: "REMOTE" }, event.currentTarget);
});

$("resetEmergency")?.addEventListener("click", event => {
  if (!confirm("Reset emergency?")) return;
  writeControl({ emergency: false, fan: false, buzzer: false, mode: "AUTO" }, event.currentTarget);
});

// ---- Signed commands ----

$("rebootBtn")?.addEventListener("click", event => {
  if (!confirm("Restart the ESP32? It will be offline for a few seconds. Refused if a firmware update is in progress.")) return;
  sendSignedCommand("REBOOT", "", event.currentTarget);
});

$("aiToggleBtn")?.addEventListener("click", event => {
  const next = Boolean(g("ai.enabled")) ? "OFF" : "ON";
  sendSignedCommand("AI", next, event.currentTarget);
});

$("calibrateMqBtn")?.addEventListener("click", event => {
  if (!confirm("Recalibrate all 9 MQ sensors? Requires warmup complete and no active gas alarm.")) return;
  sendSignedCommand("CALIBRATE_MQ", "", event.currentTarget);
});

$("restoreConfigBtn")?.addEventListener("click", event => {
  if (!confirm("Restore thresholds and battery offset from the last cloud backup?")) return;
  sendSignedCommand("RESTORE_CONFIG", "", event.currentTarget);
});

// ---- Battery calibration (unsigned settings path) ----

$("calibrateBatteryBtn")?.addEventListener("click", async event => {
  const ref_ = num($("batteryRefInput")?.value, -1);
  if (ref_ < 6 || ref_ > 15) {
    toast("Enter a realistic pack voltage (6–15V)", "error");
    return;
  }

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
// SETTINGS (thresholds)
// ============================================================

function renderSettings() {
  const gasInput = $("gasThresholdInput");
  const warnInput = $("warningThresholdInput");
  if (gasInput && document.activeElement !== gasInput) {
    gasInput.value = num(state.settings.gasThreshold, 2000);
  }
  if (warnInput && document.activeElement !== warnInput) {
    warnInput.value = num(state.settings.warningThreshold, 1500);
  }
}

async function saveThresholdField(inputId, dbKey, label, min, max, button) {
  const value = num($(inputId)?.value, -1);
  if (value < min || value > max) {
    toast(`Value must be between ${min} and ${max}`, "error");
    return;
  }
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

$("saveThreshold")?.addEventListener("click", event => {
  saveThresholdField("gasThresholdInput", "gasThreshold", "Danger threshold", 100, 4095, event.currentTarget);
});

$("saveWarning")?.addEventListener("click", event => {
  saveThresholdField("warningThresholdInput", "warningThreshold", "Warning threshold", 50, 4095, event.currentTarget);
});

// ============================================================
// DIAGNOSTICS
// ============================================================

function renderDiagnostics() {
  setText("diagFirebase", g("diagnostics.firebaseHealthy") === false ? "FAULT" : "OK");
  setText("diagWiFi", g("diagnostics.wifiHealthy") === false ? "FAULT" : "OK");
  setText("diagDhtInt", g("climate.internalHealthy") === false ? "FAULT" : "OK");
  setText("diagDhtExt", g("climate.externalHealthy") === false ? "FAULT" : "OK");
  setText("diagDhtSafety", g("climate.dhtSafetyFault") ? "FAULT" : "OK");
  setText("diagFan", g("diagnostics.fanFeedbackFault") ? "FAULT" : "OK");
  setText("diagFanFailures", g("diagnostics.fanFeedbackFailures", 0));
  setText("diagHeartbeat", formatTime(state.status.timestamp));

  setText("diagResetReason", g("diagnostics.resetReason", "--"));
  setText("diagBootCount", g("diagnostics.bootCount", "--"));
  setText("diagFreeHeap", formatBytes(g("diagnostics.freeHeap")));
  setText("diagMinHeap", formatBytes(g("diagnostics.minFreeHeap")));
  setText("diagRollbackSupported", g("diagnostics.otaRollbackSupported") ? "YES" : "NO");
  setText("diagRollbackPending", g("diagnostics.otaRollbackPending") ? "YES — awaiting validation" : "NO");
  setText("diagOfflineEvents", g("diagnostics.offlineEvents", 0));
  setText("diagRecoveredEvents", g("diagnostics.recoveredEvents", 0));

  const rollbackEl = $("diagRollbackPending");
  if (rollbackEl) rollbackEl.className = g("diagnostics.otaRollbackPending") ? "warning-text" : "safe-text";

  let html = "";
  for (let i = 1; i <= SENSOR_COUNT; i++) {
    const fault = Boolean(g(`gas.sensor${i}.fault`));
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
  const n = num(value, -1);
  if (n < 0) return "--";
  return (n / 1024).toFixed(1) + " KB";
}

// ============================================================
// HISTORY
// ============================================================

function historyRows() {
  return Object.entries(state.history || {}).sort(([a], [b]) => Number(b) - Number(a)).slice(0, 500);
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
        <td>${(trend >= 0 ? "+" : "") + trend.toFixed(0)}</td>
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
// EVENTS & NOTIFICATIONS
// ============================================================

function renderEvents() {
  const events = Object.values(state.events || {}).map(e => ({ ...e, kind: "event" }));
  const notifications = Object.values(state.notifications || {}).map(n => ({ ...n, kind: "notification" }));

  const combined = [...events, ...notifications]
    .sort((a, b) => num(b.timestamp, 0) - num(a.timestamp, 0))
    .slice(0, 60);

  setText("eventsCount", `${combined.length} recent`);

  const el = $("eventsList");
  if (!el) return;

  if (!combined.length) {
    el.innerHTML = "No events yet.";
    return;
  }

  el.innerHTML = combined.map(item => {
    const severity = (item.severity || (item.kind === "event" ? "INFO" : "INFO")).toLowerCase();
    const cssClass = severity === "critical" ? "critical" : severity === "warning" ? "warning" : "";
    const label = item.kind === "notification" ? (item.severity || "INFO") : (item.type || "EVENT");

    return `
      <div class="event-item ${cssClass}">
        <strong>${label}</strong>
        <span>${item.message || ""}</span>
        <small>${formatTime(item.timestamp)}</small>
      </div>
    `;
  }).join("");
}

// ============================================================
// CHARTS
// ============================================================

function createChart(id, type, labels, datasets) {
  const canvas = $(id);
  if (!canvas || typeof Chart === "undefined") return null;

  return new Chart(canvas, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
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

  riskChart = createChart("riskChart", "line", [], [
    { label: "Storage Risk Score", data: [], tension: 0.3, borderColor: "#f4c04f", backgroundColor: "rgba(244,192,79,.15)" }
  ]);
}

let lastLiveTimestamp = 0;

function updateLiveChart() {
  if (!liveGasChart) return;

  const timestamp = num(state.status.timestamp, Date.now());
  if (timestamp === lastLiveTimestamp) return;
  lastLiveTimestamp = timestamp;

  const labels = liveGasChart.data.labels;
  const max = liveGasChart.data.datasets[0].data;
  const avg = liveGasChart.data.datasets[1].data;

  labels.push(formatClock(timestamp));
  max.push(num(g("gas.max"), 0));
  avg.push(num(g("gas.average"), 0));

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
  updateChart(riskChart, labels, rows.map(([, x]) => num(x.storageRiskScore, 0)));
}

function updateChart(chart, labels, data) {
  if (!chart) return;
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update("none");
}

// ============================================================
// FIRMWARE / OTA
// ============================================================

function getFirmwareDevice() { return state.firmware.device || {}; }
function getFirmwareCommand() { return state.firmware.command || {}; }

function renderFirmware() {
  const device = getFirmwareDevice();
  const command = getFirmwareCommand();

  setText("otaDeviceId", device.deviceId || state.status.deviceId || DEVICE_ID);
  setText("otaCurrentVersion", device.firmwareVersion || state.status.firmwareVersion || "--");
  setText("otaCurrentBuild", device.firmwareBuild ?? state.status.firmwareBuild ?? "--");
  setText("otaCurrentHardware", device.hardwareVersion || state.status.hardwareVersion || "--");
  setText("otaState", device.state || "IDLE");
  setText("otaProgressText", num(device.progress, 0) + "%");
  setText("otaRollbackPendingText", g("diagnostics.otaRollbackPending") ? "YES — pending validation" : "NO");

  const deviceState = device.state || "IDLE";
  const liveStates = ["CONNECTING", "DOWNLOADING", "INSTALLING"];
  const otaInProgress = liveStates.includes(deviceState);

  const gas = Boolean(g("gas.detected"));
  const emergency = Boolean(state.control.emergency);
  const blocked = gas || emergency;

  const deployBtn = $("deploySignedFirmware");
  if (deployBtn) deployBtn.disabled = blocked || otaInProgress;

  const otaBadge = $("otaBadge");

  if (otaInProgress) {
    if (otaBadge) { otaBadge.textContent = deviceState; otaBadge.className = "badge warning"; }
  } else if (deviceState === "FAILED" || deviceState === "REJECTED") {
    if (otaBadge) { otaBadge.textContent = deviceState; otaBadge.className = "badge danger"; }
  } else if (blocked) {
    if (otaBadge) { otaBadge.textContent = "OTA BLOCKED"; otaBadge.className = "badge danger"; }
  } else {
    if (otaBadge) { otaBadge.textContent = "OTA READY"; otaBadge.className = "badge safe"; }
  }

  renderFirmwareHistory();
}

function renderFirmwareHistory() {
  // v5 pushes history entries (auto-generated keys), so sort by
  // each entry's own timestamp field rather than its key.
  const history = Object.values(state.firmware.history || {})
    .sort((a, b) => num(b.timestamp, 0) - num(a.timestamp, 0))
    .slice(0, 20);

  const el = $("firmwareHistory");
  if (!el) return;

  if (!history.length) {
    el.innerHTML = "No firmware releases.";
    return;
  }

  el.innerHTML = history.map(x => `
    <div class="firmware-history-item">
      <strong>${x.state || "--"} · v${x.firmwareVersion || "--"}</strong>
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
    if (hashStatus) hashStatus.textContent = "No file selected.";
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

$("deploySignedFirmware")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const url = $("firmwareUrlInput")?.value.trim() || "";
  const version = $("firmwareVersionInput")?.value.trim() || "";
  const build = num($("firmwareBuildInput")?.value, 0);
  const hardware = $("firmwareHardwareInput")?.value.trim() || "";
  const statusEl = $("uploadStatus");

  if (!hmacSecret) {
    toast("Enter the HMAC secret on the Controls page first", "error");
    return;
  }
  if (!url || !/^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//i.test(url)) {
    toast("URL must be an https:// github.com or githubusercontent.com link", "error");
    return;
  }
  if (!version) { toast("Enter firmware version", "error"); return; }
  if (build <= 0) { toast("Enter valid build", "error"); return; }
  if (!hardware) { toast("Enter hardware version", "error"); return; }
  if (!pendingFirmwareHash) { toast("Select the .bin locally first so its hash can be computed", "error"); return; }

  const currentBuild = num(state.status.firmwareBuild, 0);
  if (build <= currentBuild) { toast(`Build must be greater than ${currentBuild}`, "error"); return; }

  setBusy(button, true);
  if (statusEl) statusEl.textContent = "Signing manifest...";

  try {
    const commandId = newCommandId();
    const commandAt = Math.floor(Date.now() / 1000);

    // Must match validateOTAManifest()'s canonical form exactly:
    // commandId|commandAt|DEVICE_ID|OTA|url|version|build|hash|fileSize
    const canonical =
      `${commandId}|${commandAt}|${DEVICE_ID}|OTA|${url}|${version}|${build}|${pendingFirmwareHash}|${pendingFirmwareSize}`;

    const signature = await hmacSha256Hex(hmacSecret, canonical);

    if (statusEl) statusEl.textContent = "Sending signed manifest to device...";

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

    if (statusEl) statusEl.textContent = "Manifest sent. Watch OTA State above.";
    toast("Signed OTA manifest sent");
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

// ============================================================
// CHART INIT
// ============================================================

initCharts();
