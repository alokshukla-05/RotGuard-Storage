// ============================================================
// SILO GUARD - COMPLETE APP.JS
// ============================================================

import {
  auth,
  db,
  storage,

  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,

  ref,
  onValue,
  get,
  update,
  remove,

  storageRef,
  uploadBytesResumable,
  getDownloadURL
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


// ============================================================
// NUMBER
// ============================================================

function num(value, fallback = 0) {

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;

}


// ============================================================
// TIME
// ============================================================

function formatTime(value) {

  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return "--";
  }

  const date = new Date(n);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

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

  if (!Number.isFinite(n) || n <= 0) {
    return "--";
  }

  return new Date(n).toLocaleTimeString(
    "en-IN",
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }
  );

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
// LOGIN
// ============================================================

$("loginForm").addEventListener(
  "submit",
  async event => {

    event.preventDefault();

    $("loginError").textContent = "";

    try {

      await signInWithEmailAndPassword(

        auth,

        $("email").value.trim(),

        $("password").value

      );

    }

    catch (error) {

      console.error(error);

      $("loginError").textContent =
        error.message || "Login failed.";

    }

  }
);


// ============================================================
// LOGOUT
// ============================================================

$("logoutBtn").addEventListener(
  "click",
  async () => {

    await signOut(auth);

  }
);


// ============================================================
// AUTH
// ============================================================

onAuthStateChanged(
  auth,
  user => {

    if (user) {

      $("loginScreen").classList.add("hidden");

      $("app").classList.remove("hidden");

      if (!started) {

        started = true;

        startDatabaseListeners();

      }

    }

    else {

      $("loginScreen").classList.remove("hidden");

      $("app").classList.add("hidden");

    }

  }
);


// ============================================================
// NAVIGATION
// ============================================================

document
  .querySelectorAll(".nav-btn")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        openPage(button.dataset.page);

      }
    );

  });


function openPage(page) {

  document
    .querySelectorAll(".page")
    .forEach(section => {

      section.classList.remove("active");

    });


  const target = $(page);

  if (target) {

    target.classList.add("active");

  }


  document
    .querySelectorAll(".nav-btn")
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.page === page
      );

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


  $("pageTitle").textContent =
    titles[page] || "SILO GUARD";

}


// ============================================================
// DATABASE LISTENERS
// ============================================================

function startDatabaseListeners() {


  // STATUS

  onValue(
    ref(db, "siloSystem/status"),
    snapshot => {

      state.status = snapshot.val() || {};

      renderStatus();

      renderCuring();

      updateConnection();

      updateLiveChart();

      renderFirmware();

    },
    error => {

      console.error("Status:", error);

      toast("Cannot read status", "error");

    }
  );


  // SENSORS

  onValue(
    ref(db, "siloSystem/sensors"),
    snapshot => {

      state.sensors =
        snapshot.val() || {};

      renderSensors();

      renderZones();

    }
  );


  // ZONES

  onValue(
    ref(db, "siloSystem/zones"),
    snapshot => {

      state.zones =
        snapshot.val() || {};

      renderZones();

    }
  );


  // CONTROL

  onValue(
    ref(db, "siloSystem/control"),
    snapshot => {

      state.control =
        snapshot.val() || {};

      renderControls();

      renderFirmware();

    }
  );


  // SETTINGS

  onValue(
    ref(db, "siloSystem/settings"),
    snapshot => {

      state.settings =
        snapshot.val() || {};

      renderSettings();

      renderStatus();

      renderSensors();

      renderZones();

    }
  );


  // DIAGNOSTICS

  onValue(
    ref(db, "siloSystem/diagnostics"),
    snapshot => {

      state.diagnostics =
        snapshot.val() || {};

      renderDiagnostics();

    }
  );


  // HISTORY

  onValue(
    ref(db, "siloSystem/history"),
    snapshot => {

      state.history =
        snapshot.val() || {};

      renderHistory();

      updateHistoryCharts();

    }
  );


  // FIRMWARE

  onValue(
    ref(db, "siloSystem/firmware"),
    snapshot => {

      state.firmware =
        snapshot.val() || {};

      renderFirmware();

    }
  );

}


// ============================================================
// STATUS
// ============================================================

function renderStatus() {

  const s = state.status;

  const dangerThreshold =
    num(
      state.settings.gasThreshold,
      2000
    );

  const warningThreshold =
    num(
      state.settings.warningThreshold,
      1500
    );


  const maxGas =
    num(
      s.maxGasReading,
      0
    );


  $("maxGas").textContent =
    Math.round(maxGas);


  $("averageGas").textContent =
    Math.round(
      num(
        s.averageGasReading,
        0
      )
    );


  $("thresholdText").textContent =
    dangerThreshold;


  $("gasProgress").style.width =
    Math.min(
      100,
      maxGas / 4095 * 100
    ) + "%";


  const battery =
    num(
      s.batteryPercentage,
      0
    );


  $("batteryVoltage").textContent =
    num(
      s.batteryVoltage,
      0
    ).toFixed(2) + " V";


  $("batteryPercentage").textContent =
    Math.round(battery) + "%";


  $("batteryProgress").style.width =
    Math.max(
      0,
      Math.min(
        100,
        battery
      )
    ) + "%";


  $("internalTemp").textContent =
    num(
      s.temperatureInternal,
      0
    ).toFixed(1) + "°C";


  $("internalHumidity").textContent =
    Math.round(
      num(
        s.humidityInternal,
        0
      )
    ) + "%";


  $("externalTemp").textContent =
    num(
      s.temperatureExternal,
      0
    ).toFixed(1) + "°C";


  $("externalHumidity").textContent =
    Math.round(
      num(
        s.humidityExternal,
        0
      )
    ) + "%";


  $("fanStatus").textContent =
    s.fan ? "ACTIVE" : "STANDBY";


  $("activeReason").textContent =
    s.activeFanReason ||
    "STANDBY";


  $("fillStatus").textContent =
    s.fillStatus ||
    "0% (EMPTY)";


  $("activeZone").textContent =
    num(
      s.activeRotZone,
      -1
    ) < 0
      ? "None"
      : "Zone " + s.activeRotZone;


  $("rotAngle").textContent =
    num(
      s.preciseRotAngle,
      0
    ).toFixed(1) + "°";


  $("vectorMagnitude").textContent =
    num(
      s.vectorMagnitude,
      0
    ).toFixed(0);


  $("ipAddress").textContent =
    s.ipAddress || "--";


  $("wifiRSSI").textContent =
    s.wifiRSSI !== undefined
      ? s.wifiRSSI + " dBm"
      : "--";


  $("firmwareVersion").textContent =
    s.firmwareVersion || "--";


  $("hardwareVersion").textContent =
    s.hardwareVersion || "--";


  const gasDanger =
    Boolean(s.gasDetected);


  const warning =
    maxGas >= warningThreshold;


  $("dangerAlert")
    .classList
    .toggle(
      "hidden",
      !gasDanger && !warning
    );


  $("dangerMessage").textContent =
    gasDanger

      ? `Gas danger detected. Maximum ADC: ${Math.round(maxGas)}. Local fan safety is active.`

      : warning

        ? `Gas warning detected. Current ADC: ${Math.round(maxGas)}.`

        : "Gas level normal.";


  $("systemBadge").className =
    "badge " +
    (
      gasDanger
        ? "danger"
        : warning
          ? "warning"
          : "safe"
    );


  $("systemBadge").textContent =
    gasDanger
      ? "GAS DANGER"
      : warning
        ? "GAS WARNING"
        : "SYSTEM SECURE";


  $("gasState").textContent =
    gasDanger
      ? "DANGER"
      : warning
        ? "WARNING"
        : "NORMAL";


  $("gasState").className =
    gasDanger
      ? "danger-text"
      : warning
        ? "warning-text"
        : "safe-text";

}


// ============================================================
// CURING
// ============================================================

function renderCuring() {

  const s = state.status;

  const active =
    Boolean(s.curingActive);


  const progress =
    Math.max(
      0,
      Math.min(
        100,
        num(
          s.curingProgress,
          0
        )
      )
    );


  $("curingStatus").textContent =
    s.curingStatus ||
    "HARVEST DATE NOT SET";


  $("curingDay").textContent =
    active

      ? `${num(s.curingDay, 0)} / 14 days`

      : s.harvestTimestamp
        ? "14 / 14 days"
        : "0 / 14 days";


  $("curingProgress").style.width =
    progress + "%";


  $("harvestDate").textContent =
    s.harvestTimestamp
      ? formatTime(s.harvestTimestamp)
      : "Not set";

}


// ============================================================
// CONNECTION
// ============================================================

function updateConnection() {

  const heartbeat =
    num(
      state.status.lastHeartbeat,
      0
    );


  const online =
    heartbeat > 0 &&
    Date.now() - heartbeat <
      OFFLINE_TIMEOUT;


  $("connectionDot")
    .classList
    .toggle(
      "online",
      online
    );


  $("connectionDot")
    .classList
    .toggle(
      "offline",
      !online
    );


  $("connectionText").textContent =
    online
      ? "Device Online"
      : "Device Offline";


  $("lastSeen").textContent =
    online
      ? "Heartbeat " + formatClock(heartbeat)
      : heartbeat
        ? "Last seen " + formatTime(heartbeat)
        : "Waiting for ESP32";


  $("onlineCard").textContent =
    online
      ? "ONLINE"
      : "OFFLINE";

}


setInterval(
  updateConnection,
  3000
);


// ============================================================
// SENSOR STATUS
// ============================================================

function sensorLevel(value) {

  const danger =
    num(
      state.settings.gasThreshold,
      2000
    );

  const warning =
    num(
      state.settings.warningThreshold,
      1500
    );


  if (value >= danger) {

    return {
      className: "danger",
      text: "DANGER"
    };

  }


  if (value >= warning) {

    return {
      className: "warning",
      text: "WARNING"
    };

  }


  return {
    className: "normal",
    text: "NORMAL"
  };

}


// ============================================================
// SENSOR CARD
// ============================================================

function sensorCard(index, value) {

  const level =
    sensorLevel(value);


  const diagnostic =
    state.diagnostics[
      "mq" + index
    ] || {};


  const healthy =
    diagnostic.healthy !== false;


  return `

  <div class="sensor-card ${level.className}">

    <div class="sensor-head">

      <strong>
        MQ-135 ${index}
      </strong>

      <span>
        ${level.text}
      </span>

    </div>


    <div class="sensor-number">

      ${Math.round(value)}

    </div>


    <div class="sensor-footer">

      <small>
        ADC
      </small>

      <small
        class="${healthy ? "ok" : "bad"}"
      >
        ${healthy ? "● HEALTHY" : "● FAULT"}
      </small>

    </div>

  </div>

  `;

}


// ============================================================
// SENSORS
// ============================================================

function renderSensors() {

  let html = "";


  for (
    let i = 1;
    i <= SENSOR_COUNT;
    i++
  ) {

    html += sensorCard(
      i,
      num(
        state.sensors[
          "gas" + i
        ],
        0
      )
    );

  }


  $("allSensors").innerHTML =
    html;


  $("sensorPreview").innerHTML =
    html;

}


// ============================================================
// ZONE
// ============================================================

function getZone(zone) {

  const ids =
    ZONES[zone];


  const values =
    ids.map(
      id =>
        num(
          state.sensors[
            "gas" + id
          ],
          0
        )
    );


  const dbZone =
    state.zones[
      "zone" + zone
    ] || {};


  return {

    values,

    peak:
      num(
        dbZone.peak,
        Math.max(...values)
      ),

    average:
      num(
        dbZone.average,
        values.reduce(
          (a,b) => a + b,
          0
        ) / 3
      )

  };

}


// ============================================================
// ZONE CARD
// ============================================================

function zoneCard(zone) {

  const data =
    getZone(zone);


  const dangerThreshold =
    num(
      state.settings.gasThreshold,
      2000
    );


  const warningThreshold =
    num(
      state.settings.warningThreshold,
      1500
    );


  const danger =
    data.peak >=
    dangerThreshold;


  const warning =
    data.peak >=
    warningThreshold;


  const status =
    danger
      ? "DANGER"
      : warning
        ? "WARNING"
        : "NORMAL";


  return `

  <div class="zone-card
    ${danger ? "danger" : warning ? "warning" : ""}">

    <div class="zone-head">

      <strong>
        Zone ${zone}
      </strong>

      <span>
        ${status}
      </span>

    </div>


    <div class="zone-number">

      ${Math.round(data.peak)}

    </div>


    <small>
      Maximum gas ADC
    </small>


    <div class="zone-sensors">

      ${ZONES[zone].map(
        id => `

        <div>

          <small>
            MQ-${id}
          </small>

          <strong>
            ${Math.round(
              num(
                state.sensors[
                  "gas" + id
                ],
                0
              )
            )}
          </strong>

        </div>

      `).join("")}

    </div>


    <div class="zone-average">

      Average:
      ${Math.round(data.average)}

    </div>

  </div>

  `;

}


// ============================================================
// ZONES
// ============================================================

function renderZones() {

  let html = "";


  [1,2,3].forEach(
    zone => {

      html += zoneCard(zone);

    }
  );


  $("zoneCards").innerHTML =
    html;


  $("zonePreview").innerHTML =
    html;


  updateZoneChart();

}


// ============================================================
// CONTROLS
// ============================================================

function renderControls() {

  const c =
    state.control;


  const s =
    state.status;


  const fan =
    Boolean(c.fan);


  const buzzer =
    Boolean(c.buzzer);


  const remote =
    String(c.mode || "AUTO")
      .toUpperCase() ===
    "REMOTE";


  $("fanToggle").textContent =
    fan
      ? "FAN ON"
      : "FAN OFF";


  $("buzzerToggle").textContent =
    buzzer
      ? "BUZZER ON"
      : "BUZZER OFF";


  $("actualFanState").textContent =
    s.fan
      ? "ON"
      : "OFF";


  $("activeFanReasonControl").textContent =
    s.activeFanReason ||
    "STANDBY";


  $("controlModeText").textContent =
    remote
      ? "REMOTE"
      : "AUTO";


  $("autoMode")
    .classList
    .toggle(
      "active",
      !remote
    );


  $("remoteMode")
    .classList
    .toggle(
      "active",
      remote
    );


  $("fanIndicator")
    .classList
    .toggle(
      "on",
      Boolean(s.fan)
    );


  $("buzzerIndicator")
    .classList
    .toggle(
      "on",
      Boolean(s.buzzer)
    );


  $("emergencyState").textContent =
    c.emergency
      ? "ACTIVE"
      : "CLEAR";

}


// ============================================================
// FIREBASE CONTROL
// ============================================================

async function writeControl(values) {

  try {

    await update(
      ref(
        db,
        "siloSystem/control"
      ),
      {

        ...values,

        commandId:
          Date.now()

      }
    );


    toast("Command sent");

  }

  catch (error) {

    console.error(error);

    toast(
      error.message,
      "error"
    );

  }

}


// ============================================================
// FAN
// ============================================================

$("fanToggle").onclick =
async () => {

  await writeControl({

    fan:
      !Boolean(
        state.control.fan
      ),

    mode:
      "REMOTE"

  });

};


// ============================================================
// BUZZER
// ============================================================

$("buzzerToggle").onclick =
async () => {

  await writeControl({

    buzzer:
      !Boolean(
        state.control.buzzer
      ),

    mode:
      "REMOTE"

  });

};


// ============================================================
// AUTO
// ============================================================

$("autoMode").onclick =
async () => {

  await writeControl({

    mode:
      "AUTO"

  });

};


// ============================================================
// REMOTE
// ============================================================

$("remoteMode").onclick =
async () => {

  await writeControl({

    mode:
      "REMOTE"

  });

};


// ============================================================
// EMERGENCY
// ============================================================

$("emergencyBtn").onclick =
async () => {

  if (
    !confirm(
      "Activate emergency?"
    )
  ) return;


  await writeControl({

    emergency:
      true,

    fan:
      true,

    buzzer:
      true,

    mode:
      "REMOTE"

  });

};


// ============================================================
// RESET EMERGENCY
// ============================================================

$("resetEmergency").onclick =
async () => {

  if (
    !confirm(
      "Reset emergency?"
    )
  ) return;


  await writeControl({

    emergency:
      false,

    fan:
      false,

    buzzer:
      false,

    mode:
      "AUTO"

  });

};


// ============================================================
// SETTINGS
// ============================================================

function renderSettings() {

  $("gasThresholdInput").value =
    num(
      state.settings.gasThreshold,
      2000
    );


  $("warningThresholdInput").value =
    num(
      state.settings.warningThreshold,
      1500
    );

}


// ============================================================
// SAVE DANGER
// ============================================================

$("saveThreshold").onclick =
async () => {

  const value =
    num(
      $("gasThresholdInput").value,
      -1
    );


  if (
    value < 0 ||
    value > 4095
  ) {

    toast(
      "Invalid threshold",
      "error"
    );

    return;

  }


  try {

    await update(
      ref(
        db,
        "siloSystem/settings"
      ),
      {

        gasThreshold:
          value

      }
    );


    toast(
      "Danger threshold saved"
    );

  }

  catch(error) {

    toast(
      error.message,
      "error"
    );

  }

};


// ============================================================
// SAVE WARNING
// ============================================================

$("saveWarning").onclick =
async () => {

  const value =
    num(
      $("warningThresholdInput").value,
      -1
    );


  if (
    value < 0 ||
    value > 4095
  ) {

    toast(
      "Invalid threshold",
      "error"
    );

    return;

  }


  try {

    await update(
      ref(
        db,
        "siloSystem/settings"
      ),
      {

        warningThreshold:
          value

      }
    );


    toast(
      "Warning threshold saved"
    );

  }

  catch(error) {

    toast(
      error.message,
      "error"
    );

  }

};


// ============================================================
// DIAGNOSTICS
// ============================================================

function renderDiagnostics() {

  const d =
    state.diagnostics;


  $("diagFirebase").textContent =
    d.firebaseHealthy === false
      ? "FAULT"
      : "OK";


  $("diagWiFi").textContent =
    d.wifiConnected === false
      ? "FAULT"
      : "OK";


  $("diagDhtInt").textContent =
    d.dhtInternalHealthy === false
      ? "FAULT"
      : "OK";


  $("diagDhtExt").textContent =
    d.dhtExternalHealthy === false
      ? "FAULT"
      : "OK";


  $("diagFan").textContent =
    d.fanDiagnosticFault
      ? "FAULT"
      : "COMMAND OK";


  $("diagHeartbeat").textContent =
    formatTime(
      state.status.lastHeartbeat
    );


  let html = "";


  for (
    let i = 1;
    i <= 9;
    i++
  ) {

    const x =
      d["mq" + i] || {};


    html += `

      <div class="diag-row">

        <span>
          MQ-135 ${i}
        </span>

        <b class="${
          x.healthy === false
            ? "bad"
            : "ok"
        }">

          ${
            x.healthy === false
              ? "FAULT"
              : "HEALTHY"
          }

        </b>

      </div>

    `;

  }


  $("mqDiagnostics").innerHTML =
    html;

}


// ============================================================
// HISTORY
// ============================================================

function historyRows() {

  return Object.entries(
    state.history || {}
  )
  .sort(
    ([a],[b]) =>
      Number(b) - Number(a)
  )
  .slice(0,500);

}


// ============================================================
// RENDER HISTORY
// ============================================================

function renderHistory() {

  const rows =
    historyRows();


  const danger =
    num(
      state.settings.gasThreshold,
      2000
    );


  const warning =
    num(
      state.settings.warningThreshold,
      1500
    );


  $("historyCount").textContent =
    `${Object.keys(
      state.history || {}
    ).length} records`;


  $("historyTable").innerHTML =
    rows.map(
      ([timestamp, x]) => {

        const max =
          num(
            x.maxGas,
            0
          );


        const status =
          max >= danger
            ? "DANGER"
            : max >= warning
              ? "WARNING"
              : "NORMAL";


        return `

          <tr>

            <td>
              ${formatTime(timestamp)}
            </td>

            <td>
              ${
                num(
                  x.activeZone,
                  -1
                ) > 0
                  ? "Zone " +
                    x.activeZone
                  : "None"
              }
            </td>

            <td>
              ${Math.round(max)}
            </td>

            <td>
              ${Math.round(
                num(
                  x.averageGas,
                  0
                )
              )}
            </td>

            <td>
              ${num(
                x.temperature,
                0
              ).toFixed(1)}°C
            </td>

            <td>
              ${num(
                x.humidity,
                0
              ).toFixed(1)}%
            </td>

            <td>
              ${num(
                x.battery,
                0
              ).toFixed(2)}V
            </td>

            <td>
              ${x.fan ? "ON" : "OFF"}
            </td>

            <td class="${
              status === "DANGER"
                ? "danger-text"
                : status === "WARNING"
                  ? "warning-text"
                  : "safe-text"
            }">

              ${status}

            </td>

          </tr>

        `;

      }
    ).join("")

    ||

    `<tr>
      <td colspan="9">
        No history available
      </td>
    </tr>`;

}


// ============================================================
// CLEAR HISTORY
// ============================================================

$("clearHistory").onclick =
async () => {

  if (
    !confirm(
      "Delete all history?"
    )
  ) return;


  try {

    await remove(
      ref(
        db,
        "siloSystem/history"
      )
    );


    toast(
      "History deleted"
    );

  }

  catch(error) {

    toast(
      error.message,
      "error"
    );

  }

};


// ============================================================
// CHART
// ============================================================

function createChart(
  id,
  type,
  labels,
  datasets
) {

  const canvas =
    $(id);


  if (!canvas) return null;


  return new Chart(
    canvas,
    {

      type,

      data: {

        labels,

        datasets

      },

      options: {

        responsive: true,

        maintainAspectRatio: false,

        animation: false,

        scales: {

          y: {
            beginAtZero: true
          }

        }

      }

    }
  );

}


// ============================================================
// INIT CHARTS
// ============================================================

function initCharts() {

  liveGasChart =
    createChart(
      "liveGasChart",
      "line",
      [],
      [

        {
          label: "Maximum Gas",
          data: [],
          tension: 0.3,
          pointRadius: 1
        },

        {
          label: "Average Gas",
          data: [],
          tension: 0.3,
          pointRadius: 1
        }

      ]
    );


  zoneChart =
    createChart(
      "zoneChart",
      "bar",
      [
        "Zone 1",
        "Zone 2",
        "Zone 3"
      ],
      [

        {
          label: "Peak Gas",
          data: [0,0,0]
        }

      ]
    );


  gasHistoryChart =
    createChart(
      "gasHistoryChart",
      "line",
      [],
      [

        {
          label: "Maximum Gas",
          data: [],
          tension: 0.3
        }

      ]
    );


  temperatureChart =
    createChart(
      "temperatureChart",
      "line",
      [],
      [

        {
          label: "Temperature",
          data: [],
          tension: 0.3
        }

      ]
    );


  humidityChart =
    createChart(
      "humidityChart",
      "line",
      [],
      [

        {
          label: "Humidity",
          data: [],
          tension: 0.3
        }

      ]
    );


  batteryChart =
    createChart(
      "batteryChart",
      "line",
      [],
      [

        {
          label: "Battery",
          data: [],
          tension: 0.3
        }

      ]
    );

}


let lastLiveTimestamp = 0;


// ============================================================
// LIVE CHART
// ============================================================

function updateLiveChart() {

  if (!liveGasChart) return;


  const timestamp =
    num(
      state.status.lastUpdate,
      Date.now()
    );


  if (
    timestamp ===
    lastLiveTimestamp
  ) return;


  lastLiveTimestamp =
    timestamp;


  const labels =
    liveGasChart.data.labels;


  const max =
    liveGasChart.data.datasets[0].data;


  const avg =
    liveGasChart.data.datasets[1].data;


  labels.push(
    formatClock(timestamp)
  );


  max.push(
    num(
      state.status.maxGasReading,
      0
    )
  );


  avg.push(
    num(
      state.status.averageGasReading,
      0
    )
  );


  while (
    labels.length > 40
  ) {

    labels.shift();

    max.shift();

    avg.shift();

  }


  liveGasChart.update("none");

}


// ============================================================
// ZONE CHART
// ============================================================

function updateZoneChart() {

  if (!zoneChart) return;


  zoneChart.data.datasets[0]
    .data = [

      getZone(1).peak,

      getZone(2).peak,

      getZone(3).peak

    ];


  zoneChart.update("none");

}


// ============================================================
// HISTORY CHARTS
// ============================================================

function updateHistoryCharts() {

  const rows =
    historyRows()
      .reverse();


  const labels =
    rows.map(
      ([timestamp]) =>
        formatClock(timestamp)
    );


  updateChart(
    gasHistoryChart,
    labels,
    rows.map(
      ([,x]) =>
        num(
          x.maxGas,
          0
        )
    )
  );


  updateChart(
    temperatureChart,
    labels,
    rows.map(
      ([,x]) =>
        num(
          x.temperature,
          0
        )
    )
  );


  updateChart(
    humidityChart,
    labels,
    rows.map(
      ([,x]) =>
        num(
          x.humidity,
          0
        )
    )
  );


  updateChart(
    batteryChart,
    labels,
    rows.map(
      ([,x]) =>
        num(
          x.battery,
          0
        )
    )
  );

}


function updateChart(
  chart,
  labels,
  data
) {

  if (!chart) return;


  chart.data.labels =
    labels;


  chart.data.datasets[0]
    .data =
    data;


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


// ============================================================
// FIRMWARE DISPLAY
// ============================================================

function renderFirmware() {

  const latest =
    getFirmwareLatest();


  const command =
    getFirmwareCommand();


  const device =
    getFirmwareDevice();


  const currentVersion =
    device.firmwareVersion ||
    state.status.firmwareVersion ||
    "--";


  const currentBuild =
    num(
      device.firmwareBuild ??
      state.status.firmwareBuild,
      0
    );


  const latestBuild =
    num(
      latest.build,
      0
    );


  $("otaDeviceId").textContent =
    device.deviceId ||
    state.status.deviceId ||
    DEVICE_ID;


  $("otaCurrentVersion").textContent =
    currentVersion;


  $("otaCurrentBuild").textContent =
    currentBuild || "--";


  $("otaCurrentHardware").textContent =
    device.hardwareVersion ||
    state.status.hardwareVersion ||
    "--";


  $("otaState").textContent =
    device.state ||
    "IDLE";


  $("otaProgressText").textContent =
    num(
      device.progress,
      0
    ) + "%";


  $("otaLatestVersion").textContent =
    latest.version ||
    "--";


  $("otaLatestBuild").textContent =
    latest.build ??
    "--";


  $("otaTarget").textContent =
    command.targetDevice ||
    DEVICE_ID;


  $("otaHash").textContent =
    latest.sha256 ||
    "--";


  const newer =
    latestBuild >
    currentBuild;


  const gas =
    Boolean(
      state.status.gasDetected
    );


  const emergency =
    Boolean(
      state.control.emergency
    );


  const blocked =
    gas ||
    emergency;


  $("deployLatest").disabled =
    !newer ||
    blocked ||
    !latest.url;


  if (blocked) {

    $("otaBadge").textContent =
      "OTA BLOCKED";

    $("otaBadge").className =
      "badge danger";

    $("deployInfo").textContent =
      "OTA is blocked while gas danger or emergency is active.";

  }

  else if (newer) {

    $("otaBadge").textContent =
      "UPDATE AVAILABLE";

    $("otaBadge").className =
      "badge warning";

    $("deployInfo").textContent =
      `Build ${latestBuild} is newer than current build ${currentBuild}.`;

  }

  else {

    $("otaBadge").textContent =
      "OTA READY";

    $("otaBadge").className =
      "badge safe";

    $("deployInfo").textContent =
      "No newer firmware is available.";

  }


  renderFirmwareHistory();

}


// ============================================================
// FIRMWARE HISTORY
// ============================================================

function renderFirmwareHistory() {

  const history =
    state.firmware.history ||
    {};


  const entries =
    Object.entries(history)
      .sort(
        ([a],[b]) =>
          Number(b) -
          Number(a)
      )
      .slice(0,20);


  if (!entries.length) {

    $("firmwareHistory").innerHTML =
      "No firmware releases.";

    return;

  }


  $("firmwareHistory").innerHTML =
    entries.map(
      ([,x]) => `

      <div class="firmware-history-item">

        <strong>
          v${x.version || "--"}
          · Build ${x.build ?? "--"}
        </strong>

        <span>
          ${x.releaseNotes || "No release notes"}
        </span>

        <small>
          ${formatTime(x.publishedAt)}
        </small>

      </div>

      `
    ).join("");

}


// ============================================================
// SHA256
// ============================================================

async function calculateSHA256(
  buffer
) {

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      buffer
    );


  return Array
    .from(
      new Uint8Array(hash)
    )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2,"0")
    )
    .join("");

}


// ============================================================
// UPLOAD FIRMWARE
// ============================================================

$("uploadFirmware").onclick =
async () => {

  const file =
    $("firmwareFile").files[0];


  const version =
    $("firmwareVersionInput")
      .value
      .trim();


  const build =
    num(
      $("firmwareBuildInput").value,
      0
    );


  const hardware =
    $("firmwareHardwareInput")
      .value
      .trim();


  const notes =
    $("releaseNotesInput")
      .value
      .trim();


  if (!file) {

    toast(
      "Select a .bin file",
      "error"
    );

    return;

  }


  if (
    !file.name
      .toLowerCase()
      .endsWith(".bin")
  ) {

    toast(
      "Only .bin files allowed",
      "error"
    );

    return;

  }


  if (!version) {

    toast(
      "Enter firmware version",
      "error"
    );

    return;

  }


  if (build <= 0) {

    toast(
      "Enter valid build",
      "error"
    );

    return;

  }


  const currentBuild =
    num(
      state.status.firmwareBuild,
      0
    );


  if (
    build <= currentBuild
  ) {

    toast(
      `Build must be greater than ${currentBuild}`,
      "error"
    );

    return;

  }


  try {

    $("uploadStatus")
      .textContent =
      "Calculating SHA-256...";


    $("uploadProgress")
      .style.width =
      "0%";


    const buffer =
      await file.arrayBuffer();


    const sha256 =
      await calculateSHA256(
        buffer
      );


    $("otaHash").textContent =
      sha256;


    $("uploadStatus")
      .textContent =
      "Uploading firmware...";


    const safeFileName =
      file.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );


    const storagePath =
      `firmware/${hardware}/build-${build}-${safeFileName}`;


    const fileRef =
      storageRef(
        storage,
        storagePath
      );


    const uploadTask =
      uploadBytesResumable(
        fileRef,
        file,
        {

          contentType:
            "application/octet-stream",

          customMetadata: {

            firmwareVersion:
              version,

            firmwareBuild:
              String(build),

            hardwareVersion:
              hardware,

            sha256:
              sha256

          }

        }
      );


    await new Promise(
      (resolve,reject) => {

        uploadTask.on(

          "state_changed",

          snapshot => {

            const percent =
              (
                snapshot.bytesTransferred /
                snapshot.totalBytes
              ) * 100;


            $("uploadProgress")
              .style.width =
              percent + "%";


            $("uploadStatus")
              .textContent =
              `Uploading ${percent.toFixed(0)}%`;

          },

          reject,

          resolve

        );

      }
    );


    $("uploadStatus")
      .textContent =
      "Creating download URL...";


    const downloadURL =
      await getDownloadURL(
        uploadTask.snapshot.ref
      );


    const timestamp =
      Date.now();


    const release = {

      version,

      build,

      hardwareVersion:
        hardware,

      fileName:
        file.name,

      fileSize:
        file.size,

      sha256,

      url:
        downloadURL,

      releaseNotes:
        notes,

      publishedAt:
        timestamp

    };


    // Latest firmware

    await update(
      ref(
        db,
        "siloSystem/firmware/latest"
      ),
      release
    );


    // History

    await update(
      ref(
        db,
        `siloSystem/firmware/history/${timestamp}`
      ),
      release
    );


    $("uploadProgress")
      .style.width =
      "100%";


    $("uploadStatus")
      .textContent =
      "Firmware published successfully.";


    toast(
      "Firmware published"
    );

  }

  catch(error) {

    console.error(
      "OTA upload:",
      error
    );


    $("uploadStatus")
      .textContent =
      "Upload failed.";


    toast(
      error.message ||
      "Upload failed",
      "error"
    );

  }

};


// ============================================================
// DEPLOY LATEST
// ============================================================

$("deployLatest").onclick =
async () => {

  const latest =
    getFirmwareLatest();


  const device =
    getFirmwareDevice();


  if (!latest.url) {

    toast(
      "No firmware available",
      "error"
    );

    return;

  }


  if (
    state.status.gasDetected ||
    state.control.emergency
  ) {

    toast(
      "OTA blocked during emergency/gas",
      "error"
    );

    return;

  }


  const target =
    device.deviceId ||
    DEVICE_ID;


  if (
    !confirm(
      `Deploy v${latest.version} build ${latest.build} to ${target}?`
    )
  ) return;


  const command = {

    commandId:
      "ota-" + Date.now(),

    targetDevice:
      target,

    firmwareUrl:
      latest.url,

    firmwareVersion:
      latest.version,

    firmwareBuild:
      Number(latest.build),

    firmwareSize:
      Number(latest.fileSize),

    firmwareSha256:
      latest.sha256,

    hardwareVersion:
      latest.hardwareVersion,

    releaseNotes:
      latest.releaseNotes || "",

    requestedAt:
      Date.now()

  };


  try {

    await update(

      ref(
        db,
        "siloSystem/firmware/command"
      ),

      command

    );


    toast(
      "OTA command sent to ESP32"
    );

  }

  catch(error) {

    console.error(error);

    toast(
      error.message,
      "error"
    );

  }

};


// ============================================================
// CLEAR OTA COMMAND
// ============================================================

$("clearOtaCommand").onclick =
async () => {

  if (
    !confirm(
      "Clear pending OTA command?"
    )
  ) return;


  try {

    await remove(
      ref(
        db,
        "siloSystem/firmware/command"
      )
    );


    toast(
      "OTA command cleared"
    );

  }

  catch(error) {

    toast(
      error.message,
      "error"
    );

  }

};


// ============================================================
// CLOCK
// ============================================================

function updateClock() {

  $("clock")
    .textContent =
    new Date()
      .toLocaleTimeString(
        "en-IN"
      );

}


setInterval(
  updateClock,
  1000
);


updateClock();


// ============================================================
// CHART INIT
// ============================================================

window.addEventListener(
  "DOMContentLoaded",
  () => {

    initCharts();

  }
);
