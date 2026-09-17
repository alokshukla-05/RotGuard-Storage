// ============================================================
// SILO GUARD - APP.JS (fixed + hardened)
// ============================================================

// NOTE: firmware is no longer uploaded to Firebase Storage — the
// ESP32 pulls its .bin from a GitHub Release asset URL instead (see
// firmware.ino). storage/storageRef/uploadBytesResumable/getDownloadURL
// are unused here now; if firebase-config.js exports them purely for
// this file, they can be dropped from there too.
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
  sensors: {},
  zones: {},
  control: {},
  settings: {},
  diagnostics: {},
  history: {},
  firmware: {}
};

let started = false;

let liveGasChart = null;
let zoneChart = null;
let gasHistoryChart = null;
let temperatureChart = null;
let humidityChart = null;
let batteryChart = null;

// ============================================================
// SHORTCUT
// ============================================================

function $(id) {
  return document.getElementById(id);
}

// Defensive setter — avoids throwing if an element is missing
// (protects the whole render pass if markup ever drifts from this script)
function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setWidth(id, percent) {
  const el = $(id);
  if (el) el.style.width = percent + "%";
}

// ============================================================
// NUMBER
// ============================================================

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatClock(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "--";
  return new Date(n).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
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
  toast.timer = setTimeout(() => {
    el.className = "toast";
  }, 3500);
}

// ============================================================
// BUTTON LOADING HELPER
// ============================================================

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.dataset.busyLabel = button.dataset.busyLabel || button.textContent;
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
  const isOpen = $("sidebar")?.classList.contains("open");
  isOpen ? closeSidebar() : openSidebar();
});

$("sidebarOverlay")?.addEventListener("click", closeSidebar);

// ============================================================
// LOGIN
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

// ============================================================
// LOGOUT
// ============================================================

$("logoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    started = false;
  } catch (error) {
    console.error(error);
    toast(error.message || "Logout failed", "error");
  }
});

// ============================================================
// AUTH
// ============================================================

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
  document.querySelectorAll(".page").forEach(section => {
    section.classList.remove("active");
  });

  const target = $(page);
  if (target) target.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  const titles = {
    dashboard: "System Dashboard",
    zones: "3-Zone Monitor",
    sensors: "Gas Sensors",
    analytics: "Analytics",
    control: "System Controls",
    history: "System History",
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
    renderFirmware();
  }, onDbError("status"));

  onValue(ref(db, "siloSystem/sensors"), snapshot => {
    state.sensors = snapshot.val() || {};
    renderSensors();
    renderZones();
  }, onDbError("sensors"));

  onValue(ref(db, "siloSystem/zones"), snapshot => {
    state.zones = snapshot.val() || {};
    renderZones();
  }, onDbError("zones"));

  onValue(ref(db, "siloSystem/control"), snapshot => {
    state.control = snapshot.val() || {};
    renderControls();
    renderFirmware();
  }, onDbError("control"));

  onValue(ref(db, "siloSystem/settings"), snapshot => {
    state.settings = snapshot.val() || {};
    renderSettings();
    renderStatus();
    renderSensors();
    renderZones();
  }, onDbError("settings"));

  onValue(ref(db, "siloSystem/diagnostics"), snapshot => {
    state.diagnostics = snapshot.val() || {};
    renderDiagnostics();
  }, onDbError("diagnostics"));

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

// ============================================================
// STATUS
// ============================================================

function renderStatus() {
  const s = state.status;

  const dangerThreshold = num(state.settings.gasThreshold, 2000);
  const warningThreshold = num(state.settings.warningThreshold, 1500);
  const maxGas = num(s.maxGasReading, 0);

  setText("maxGas", Math.round(maxGas));
  setText("averageGas", Math.round(num(s.averageGasReading, 0)));
  setText("thresholdText", dangerThreshold);

  const gasDanger = Boolean(s.gasDetected);
  const warning = !gasDanger && maxGas >= warningThreshold;

  setWidth("gasProgress", Math.min(100, (maxGas / 4095) * 100));
  const gasBar = $("gasProgress");
  if (gasBar) {
    gasBar.className = gasDanger ? "danger" : warning ? "warning" : "";
  }

  const battery = num(s.batteryPercentage, 0);

  setText("batteryVoltage", num(s.batteryVoltage, 0).toFixed(2) + " V");
  setText("batteryPercentage", Math.round(battery) + "%");
  setWidth("batteryProgress", Math.max(0, Math.min(100, battery)));

  const batteryBar = $("batteryProgress");
  if (batteryBar) {
    batteryBar.className = battery < 20 ? "danger" : battery < 40 ? "warning" : "";
  }

  setText("internalTemp", num(s.temperatureInternal, 0).toFixed(1) + "°C");
  setText("internalHumidity", Math.round(num(s.humidityInternal, 0)) + "%");
  setText("externalTemp", num(s.temperatureExternal, 0).toFixed(1) + "°C");
  setText("externalHumidity", Math.round(num(s.humidityExternal, 0)) + "%");

  setText("fanStatus", s.fan ? "ACTIVE" : "STANDBY");
  setText("activeReason", s.activeFanReason || "STANDBY");
  setText("fillStatus", s.fillStatus || "0% (EMPTY)");
  setText("activeZone", num(s.activeRotZone, -1) < 0 ? "None" : "Zone " + s.activeRotZone);
  setText("rotAngle", num(s.preciseRotAngle, 0).toFixed(1) + "°");
  setText("vectorMagnitude", num(s.vectorMagnitude, 0).toFixed(0));
  setText("manualOverride", s.manualOverride ? "ACTIVE (SWITCH ON)" : "OFF");
  setText("controlManualOverride", s.manualOverride ? "ACTIVE" : "OFF");

  setText("ipAddress", s.ipAddress || "--");
  setText("wifiRSSI", s.wifiRSSI !== undefined ? s.wifiRSSI + " dBm" : "--");
  setText("firmwareVersion", s.firmwareVersion || "--");
  setText("hardwareVersion", s.hardwareVersion || "--");

  const alertEl = $("dangerAlert");
  alertEl?.classList.toggle("hidden", !gasDanger && !warning);

  setText(
    "dangerMessage",
    gasDanger
      ? `Gas danger detected. Maximum ADC: ${Math.round(maxGas)}. Local fan safety is active.`
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
  if (gasStateEl) {
    gasStateEl.className = gasDanger ? "danger-text" : warning ? "warning-text" : "safe-text";
  }
}

// ============================================================
// CURING
// ============================================================

function renderCuring() {
  const s = state.status;
  const active = Boolean(s.curingActive);

  const progress = Math.max(0, Math.min(100, num(s.curingProgress, 0)));

  setText("curingStatus", s.curingStatus || "HARVEST DATE NOT SET");
  setText(
    "curingDay",
    active
      ? `${num(s.curingDay, 0)} / 14 days`
      : s.harvestTimestamp
        ? "14 / 14 days"
        : "0 / 14 days"
  );

  setWidth("curingProgress", progress);
  setText("harvestDate", s.harvestTimestamp ? formatTime(s.harvestTimestamp) : "Not set");

  // Keep the date picker in sync with the device's reported harvest
  // date, but don't clobber it while the person is actively editing it.
  const harvestInput = $("harvestDateInput");
  if (harvestInput && document.activeElement !== harvestInput) {
    harvestInput.value = s.harvestTimestamp
      ? new Date(num(s.harvestTimestamp, 0)).toISOString().slice(0, 10)
      : "";
  }
}

// ============================================================
// HARVEST DATE
//
// Writes to /siloSystem/settings/harvestTimestamp as whole seconds
// (the firmware compares it against its own unixNow(), which is
// seconds — not the ms the rest of the dashboard uses for display).
// Firmware treats exactly 0 as "clear the harvest date" — see the
// comment above readSettings() in firmware.ino.
// ============================================================

$("saveHarvest")?.addEventListener("click", async event => {
  const value = $("harvestDateInput")?.value;

  if (!value) {
    toast("Pick a date first", "error");
    return;
  }

  const epochSeconds = Math.floor(new Date(value + "T00:00:00").getTime() / 1000);

  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    toast("Invalid date", "error");
    return;
  }

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
// NOTE: the ESP32 timestamps every write with either real epoch time
// (once NTP has synced) or millis() as a fallback (see firmware
// unixNow()/timestampMs()). If the device reports a fallback value
// here it will look "offline" even while live, because it will be
// nowhere near Date.now(). We treat any timestamp that's clearly not
// a real epoch (smaller than year-2020-in-ms) as "not yet synced"
// rather than silently mis-reporting offline.
// ============================================================

function updateConnection() {
  const heartbeat = num(state.status.lastHeartbeat, 0);
  const EPOCH_MS_2020 = 1577836800000;

  const looksLikeRealEpoch = heartbeat >= EPOCH_MS_2020;
  const online = looksLikeRealEpoch && Date.now() - heartbeat < OFFLINE_TIMEOUT;
  const syncing = heartbeat > 0 && !looksLikeRealEpoch;

  $("connectionDot")?.classList.toggle("online", online);
  $("connectionDot")?.classList.toggle("offline", !online);

  setText(
    "connectionText",
    online ? "Device Online" : syncing ? "Device Syncing Time" : "Device Offline"
  );

  setText(
    "lastSeen",
    online
      ? "Heartbeat " + formatClock(heartbeat)
      : syncing
        ? "Waiting for NTP sync"
        : heartbeat
          ? "Last seen " + formatTime(heartbeat)
          : "Waiting for ESP32"
  );

  setText("onlineCard", online ? "ONLINE" : "OFFLINE");
}

setInterval(updateConnection, 3000);

// ============================================================
// SENSOR STATUS
// ============================================================

function sensorLevel(value) {
  const danger = num(state.settings.gasThreshold, 2000);
  const warning = num(state.settings.warningThreshold, 1500);

  if (value >= danger) return { className: "danger", text: "DANGER" };
  if (value >= warning) return { className: "warning", text: "WARNING" };
  return { className: "normal", text: "NORMAL" };
}

// ============================================================
// SENSOR CARD
// ============================================================

function sensorCard(index, value) {
  const level = sensorLevel(value);
  const diagnostic = state.diagnostics["mq" + index] || {};
  const healthy = diagnostic.healthy !== false;

  return `
  <div class="sensor-card ${level.className}">
    <div class="sensor-head">
      <strong>MQ-135 ${index}</strong>
      <span class="${level.className}">${level.text}</span>
    </div>
    <div class="sensor-number">${Math.round(value)}</div>
    <div class="sensor-footer">
      <small>ADC</small>
      <small class="${healthy ? "ok" : "bad"}">${healthy ? "● HEALTHY" : "● FAULT"}</small>
    </div>
  </div>
  `;
}

// ============================================================
// SENSORS
// ============================================================

function renderSensors() {
  let html = "";
  for (let i = 1; i <= SENSOR_COUNT; i++) {
    html += sensorCard(i, num(state.sensors["gas" + i], 0));
  }

  const all = $("allSensors");
  const preview = $("sensorPreview");
  if (all) all.innerHTML = html;
  if (preview) preview.innerHTML = html;
}

// ============================================================
// ZONE
// ============================================================

function getZone(zone) {
  const ids = ZONES[zone];
  const values = ids.map(id => num(state.sensors["gas" + id], 0));
  const dbZone = state.zones["zone" + zone] || {};

  return {
    values,
    peak: num(dbZone.peak, values.length ? Math.max(...values) : 0),
    average: num(dbZone.average, values.reduce((a, b) => a + b, 0) / (values.length || 1))
  };
}

// ============================================================
// ZONE CARD
// ============================================================

function zoneCard(zone) {
  const data = getZone(zone);
  const dangerThreshold = num(state.settings.gasThreshold, 2000);
  const warningThreshold = num(state.settings.warningThreshold, 1500);

  const danger = data.peak >= dangerThreshold;
  const warning = !danger && data.peak >= warningThreshold;
  const status = danger ? "DANGER" : warning ? "WARNING" : "NORMAL";
  const levelClass = danger ? "danger" : warning ? "warning" : "";

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
          <strong>${Math.round(num(state.sensors["gas" + id], 0))}</strong>
        </div>
      `).join("")}
    </div>
    <div class="zone-average">Average: ${Math.round(data.average)}</div>
  </div>
  `;
}

// ============================================================
// ZONES
// ============================================================

function renderZones() {
  let html = "";
  [1, 2, 3].forEach(zone => {
    html += zoneCard(zone);
  });

  const cards = $("zoneCards");
  const preview = $("zonePreview");
  if (cards) cards.innerHTML = html;
  if (preview) preview.innerHTML = html;

  updateZoneChart();
}

// ============================================================
// CONTROLS
// ============================================================

function renderControls() {
  const c = state.control;
  const s = state.status;

  const fan = Boolean(c.fan);
  const buzzer = Boolean(c.buzzer);
  const remote = String(c.mode || "AUTO").toUpperCase() === "REMOTE";

  setText("fanToggle", fan ? "FAN ON" : "FAN OFF");
  setText("buzzerToggle", buzzer ? "BUZZER ON" : "BUZZER OFF");
  setText("actualFanState", s.fan ? "ON" : "OFF");
  setText("activeFanReasonControl", s.activeFanReason || "STANDBY");
  setText("controlModeText", remote ? "REMOTE" : "AUTO");

  $("autoMode")?.classList.toggle("active", !remote);
  $("remoteMode")?.classList.toggle("active", remote);

  $("fanIndicator")?.classList.toggle("on", Boolean(s.fan));
  $("buzzerIndicator")?.classList.toggle("on", Boolean(s.buzzer));

  setText("emergencyState", c.emergency ? "ACTIVE" : "CLEAR");
  const emergencyEl = $("emergencyState");
  if (emergencyEl) emergencyEl.className = c.emergency ? "danger-text" : "safe-text";
}

// ============================================================
// FIREBASE CONTROL
// ============================================================

async function writeControl(values, button) {
  setBusy(button, true);
  try {
    await update(ref(db, "siloSystem/control"), {
      ...values,
      commandId: Date.now()
    });
    toast("Command sent");
  } catch (error) {
    console.error(error);
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

// ============================================================
// FAN
// ============================================================

$("fanToggle")?.addEventListener("click", event => {
  writeControl({ fan: !Boolean(state.control.fan), mode: "REMOTE" }, event.currentTarget);
});

// ============================================================
// BUZZER
// ============================================================

$("buzzerToggle")?.addEventListener("click", event => {
  writeControl({ buzzer: !Boolean(state.control.buzzer), mode: "REMOTE" }, event.currentTarget);
});

// ============================================================
// AUTO / REMOTE
// ============================================================

$("autoMode")?.addEventListener("click", event => {
  writeControl({ mode: "AUTO" }, event.currentTarget);
});

$("remoteMode")?.addEventListener("click", event => {
  writeControl({ mode: "REMOTE" }, event.currentTarget);
});

// ============================================================
// EMERGENCY
// ============================================================

$("emergencyBtn")?.addEventListener("click", event => {
  if (!confirm("Activate emergency?")) return;
  writeControl({ emergency: true, fan: true, buzzer: true, mode: "REMOTE" }, event.currentTarget);
});

$("resetEmergency")?.addEventListener("click", event => {
  if (!confirm("Reset emergency?")) return;
  writeControl({ emergency: false, fan: false, buzzer: false, mode: "AUTO" }, event.currentTarget);
});

// ============================================================
// REBOOT
//
// The ESP32 clears /siloSystem/control/reboot itself right before
// restarting, and refuses to reboot mid-OTA (see handleRemoteReboot()
// in firmware.ino) — so this is safe to fire without extra guards here.
// ============================================================

$("rebootBtn")?.addEventListener("click", event => {
  if (!confirm("Restart the ESP32? It will be offline for a few seconds.")) return;
  writeControl({ reboot: true }, event.currentTarget);
});

// ============================================================
// SETTINGS
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

async function saveThresholdField(inputId, dbKey, label, button) {
  const value = num($(inputId)?.value, -1);

  if (value < 0 || value > 4095) {
    toast("Invalid threshold", "error");
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
  saveThresholdField("gasThresholdInput", "gasThreshold", "Danger threshold", event.currentTarget);
});

$("saveWarning")?.addEventListener("click", event => {
  saveThresholdField("warningThresholdInput", "warningThreshold", "Warning threshold", event.currentTarget);
});

// ============================================================
// DIAGNOSTICS
// ============================================================

function renderDiagnostics() {
  const d = state.diagnostics;

  setText("diagFirebase", d.firebaseHealthy === false ? "FAULT" : "OK");
  setText("diagWiFi", d.wifiConnected === false ? "FAULT" : "OK");
  setText("diagDhtInt", d.dhtInternalHealthy === false ? "FAULT" : "OK");
  setText("diagDhtExt", d.dhtExternalHealthy === false ? "FAULT" : "OK");
  setText("diagFan", d.fanDiagnosticFault ? "FAULT" : "COMMAND OK");
  setText("diagHeartbeat", formatTime(state.status.lastHeartbeat));

  let html = "";
  for (let i = 1; i <= 9; i++) {
    const x = d["mq" + i] || {};
    html += `
      <div class="diag-row">
        <span>MQ-135 ${i}</span>
        <b class="${x.healthy === false ? "bad" : "ok"}">
          ${x.healthy === false ? "FAULT" : "HEALTHY"}
        </b>
      </div>
    `;
  }

  const el = $("mqDiagnostics");
  if (el) el.innerHTML = html;
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

    return `
      <tr>
        <td>${formatTime(timestamp)}</td>
        <td>${num(x.activeZone, -1) > 0 ? "Zone " + x.activeZone : "None"}</td>
        <td>${Math.round(max)}</td>
        <td>${Math.round(num(x.averageGas, 0))}</td>
        <td>${num(x.temperature, 0).toFixed(1)}°C</td>
        <td>${num(x.humidity, 0).toFixed(1)}%</td>
        <td>${num(x.battery, 0).toFixed(2)}V</td>
        <td>${x.fan ? "ON" : "OFF"}</td>
        <td class="${
          status === "DANGER" ? "danger-text" : status === "WARNING" ? "warning-text" : "safe-text"
        }">${status}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="9">No history available</td></tr>`;
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
// CHART
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
      plugins: {
        legend: {
          labels: { color: "#8492a3", font: { size: 10 } }
        }
      },
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

  const timestamp = num(state.status.lastUpdate, Date.now());
  if (timestamp === lastLiveTimestamp) return;
  lastLiveTimestamp = timestamp;

  const labels = liveGasChart.data.labels;
  const max = liveGasChart.data.datasets[0].data;
  const avg = liveGasChart.data.datasets[1].data;

  labels.push(formatClock(timestamp));
  max.push(num(state.status.maxGasReading, 0));
  avg.push(num(state.status.averageGasReading, 0));

  while (labels.length > 40) {
    labels.shift();
    max.shift();
    avg.shift();
  }

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
// OTA
// ============================================================

function getFirmwareCommand() {
  return state.firmware.command || {};
}

function getFirmwareLatest() {
  return state.firmware.latest || {};
}

function getFirmwareDevice() {
  return state.firmware.device || {};
}

function renderFirmware() {
  const latest = getFirmwareLatest();
  const command = getFirmwareCommand();
  const device = getFirmwareDevice();

  const currentVersion = device.firmwareVersion || state.status.firmwareVersion || "--";
  const currentBuild = num(device.firmwareBuild ?? state.status.firmwareBuild, 0);
  const latestBuild = num(latest.build, 0);

  setText("otaDeviceId", device.deviceId || state.status.deviceId || DEVICE_ID);
  setText("otaCurrentVersion", currentVersion);
  setText("otaCurrentBuild", currentBuild || "--");
  setText("otaCurrentHardware", device.hardwareVersion || state.status.hardwareVersion || "--");
  setText("otaSource", state.status.otaSource || "GITHUB");
  setText("otaState", device.state || "IDLE");
  setText("otaProgressText", num(device.progress, 0) + "%");

  setText("otaLatestVersion", latest.version || "--");
  setText("otaLatestBuild", latest.build ?? "--");
  setText("otaTarget", command.targetDevice || DEVICE_ID);
  setText("otaHash", latest.sha256 || "--");

  const newer = latestBuild > currentBuild;
  const gas = Boolean(state.status.gasDetected);
  const emergency = Boolean(state.control.emergency);
  const blocked = gas || emergency;

  const deviceState = device.state || "IDLE";
  const liveStates = ["CONNECTING", "DOWNLOADING", "INSTALLING"];
  const otaInProgress = liveStates.includes(deviceState);

  const deployBtn = $("deployLatest");
  if (deployBtn) deployBtn.disabled = !newer || blocked || !latest.url || otaInProgress;

  const otaBadge = $("otaBadge");
  const deployInfo = $("deployInfo");

  // Live device state takes priority over the "is there a newer build"
  // comparison below — while an update is actually downloading/installing,
  // the badge should say so rather than still reading "UPDATE AVAILABLE".
  if (otaInProgress) {
    if (otaBadge) { otaBadge.textContent = deviceState; otaBadge.className = "badge warning"; }
    if (deployInfo) deployInfo.textContent = `OTA in progress: ${deviceState.toLowerCase()} (${num(device.progress, 0)}%).`;
  } else if (deviceState === "FAILED" || deviceState === "REJECTED") {
    if (otaBadge) { otaBadge.textContent = deviceState; otaBadge.className = "badge danger"; }
    if (deployInfo) deployInfo.textContent = device.error || "The last OTA attempt did not succeed.";
  } else if (blocked) {
    if (otaBadge) { otaBadge.textContent = "OTA BLOCKED"; otaBadge.className = "badge danger"; }
    if (deployInfo) deployInfo.textContent = "OTA is blocked while gas danger or emergency is active.";
  } else if (newer) {
    if (otaBadge) { otaBadge.textContent = "UPDATE AVAILABLE"; otaBadge.className = "badge warning"; }
    if (deployInfo) deployInfo.textContent = `Build ${latestBuild} is newer than current build ${currentBuild}.`;
  } else {
    if (otaBadge) { otaBadge.textContent = "OTA READY"; otaBadge.className = "badge safe"; }
    if (deployInfo) deployInfo.textContent = "No newer firmware is available.";
  }

  renderFirmwareHistory();
}

function renderFirmwareHistory() {
  const history = state.firmware.history || {};
  const entries = Object.entries(history).sort(([a], [b]) => Number(b) - Number(a)).slice(0, 20);

  const el = $("firmwareHistory");
  if (!el) return;

  if (!entries.length) {
    el.innerHTML = "No firmware releases.";
    return;
  }

  el.innerHTML = entries.map(([, x]) => `
    <div class="firmware-history-item">
      <strong>v${x.version || "--"} · Build ${x.build ?? "--"}</strong>
      <span>${x.releaseNotes || "No release notes"}</span>
      <small>${formatTime(x.publishedAt)}</small>
    </div>
  `).join("");
}

async function calculateSHA256(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// ============================================================
// FIRMWARE HASH — local-only, nothing is uploaded from here
//
// The person still publishes the .bin as a GitHub Release asset
// themselves (outside this dashboard). Picking the same file here
// just computes its SHA-256 and size client-side so those don't
// have to be typed in by hand, and lets them confirm the hash
// matches what GitHub shows for the asset before registering it.
// ============================================================

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
    if (hashStatus) hashStatus.textContent = `${file.name} — ${(file.size / 1024).toFixed(1)} KB. Matches your GitHub release? Fill in the URL below.`;
  } catch (error) {
    console.error(error);
    if (hashStatus) hashStatus.textContent = "Could not hash file.";
    toast(error.message || "Hashing failed", "error");
  }
});

// ============================================================
// REGISTER GITHUB RELEASE
//
// Writes the release metadata straight to
// /siloSystem/firmware/latest (+ history) — no upload involved.
// The ESP32 only ever fetches from the URL you paste here once you
// hit "Deploy Latest".
// ============================================================

$("publishFirmware")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const url = $("firmwareUrlInput")?.value.trim() || "";
  const version = $("firmwareVersionInput")?.value.trim() || "";
  const build = num($("firmwareBuildInput")?.value, 0);
  const hardware = $("firmwareHardwareInput")?.value.trim() || "";
  const notes = $("releaseNotesInput")?.value.trim() || "";
  const statusEl = $("uploadStatus");

  if (!url) {
    toast("Paste the GitHub Release asset URL", "error");
    return;
  }

  if (!/^https:\/\//i.test(url)) {
    toast("URL must be https://", "error");
    return;
  }

  if (!version) {
    toast("Enter firmware version", "error");
    return;
  }

  if (build <= 0) {
    toast("Enter valid build", "error");
    return;
  }

  if (!hardware) {
    toast("Enter hardware version", "error");
    return;
  }

  if (!pendingFirmwareHash) {
    toast("Select the .bin locally first so its hash can be verified", "error");
    return;
  }

  const currentBuild = num(state.status.firmwareBuild, 0);
  if (build <= currentBuild) {
    toast(`Build must be greater than ${currentBuild}`, "error");
    return;
  }

  setBusy(button, true);
  if (statusEl) statusEl.textContent = "Registering release...";

  try {
    const timestamp = Date.now();

    const release = {
      version,
      build,
      hardwareVersion: hardware,
      fileSize: pendingFirmwareSize,
      sha256: pendingFirmwareHash,
      url,
      releaseNotes: notes,
      publishedAt: timestamp
    };

    await update(ref(db, "siloSystem/firmware/latest"), release);
    await update(ref(db, `siloSystem/firmware/history/${timestamp}`), release);

    if (statusEl) statusEl.textContent = "Release registered. Ready to deploy.";
    toast("Release registered");
  } catch (error) {
    console.error("Firmware registration:", error);
    if (statusEl) statusEl.textContent = "Registration failed.";
    toast(error.message || "Registration failed", "error");
  } finally {
    setBusy(button, false);
  }
});

// ============================================================
// DEPLOY LATEST
// ============================================================

$("deployLatest")?.addEventListener("click", async event => {
  const latest = getFirmwareLatest();
  const device = getFirmwareDevice();

  if (!latest.url) {
    toast("No firmware available", "error");
    return;
  }

  if (state.status.gasDetected || state.control.emergency) {
    toast("OTA blocked during emergency/gas", "error");
    return;
  }

  const target = device.deviceId || DEVICE_ID;

  if (!confirm(`Deploy v${latest.version} build ${latest.build} to ${target}?`)) return;

  const command = {
    commandId: "ota-" + Date.now(),
    targetDevice: target,
    firmwareUrl: latest.url,
    firmwareVersion: latest.version,
    firmwareBuild: Number(latest.build),
    firmwareSize: Number(latest.fileSize),
    firmwareSha256: latest.sha256,
    hardwareVersion: latest.hardwareVersion,
    releaseNotes: latest.releaseNotes || "",
    requestedAt: Date.now()
  };

  setBusy(event.currentTarget, true);
  try {
    await update(ref(db, "siloSystem/firmware/command"), command);
    toast("OTA command sent to ESP32");
  } catch (error) {
    console.error(error);
    toast(error.message, "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
});

// ============================================================
// CLEAR OTA COMMAND
// ============================================================

$("clearOtaCommand")?.addEventListener("click", async event => {
  if (!confirm("Clear pending OTA command?")) return;
  setBusy(event.currentTarget, true);
  try {
    await remove(ref(db, "siloSystem/firmware/command"));
    toast("OTA command cleared");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(event.currentTarget, false);
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
//
// The script is loaded with type="module", which always defers
// execution until after the document has been parsed — so the
// canvases already exist by the time this file runs. Initializing
// directly here (rather than waiting on a DOMContentLoaded
// listener registered from inside this same module) removes a
// subtle timing dependency between two async event systems.
// ============================================================

initCharts();
