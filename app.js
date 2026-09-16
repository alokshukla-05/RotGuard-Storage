// ============================================================
// SILO GUARD - PROFESSIONAL APP.JS
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
  update,
  remove,

  storageRef,
  uploadBytesResumable,
  getDownloadURL

} from "./firebase-config.js";


// ============================================================
// CONFIG
// ============================================================

const DEVICE_ID =
  "silo-guard-01";

const SENSOR_COUNT =
  9;

const OFFLINE_TIMEOUT =
  15000;

const MAX_HISTORY_ROWS =
  500;


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


let databaseStarted =
  false;


let charts = {

  live: null,

  zone: null,

  gas: null,

  temperature: null,

  humidity: null,

  battery: null

};


let lastLiveTimestamp =
  0;


// ============================================================
// DOM
// ============================================================

function $(id) {

  return document.getElementById(id);

}


function safeText(
  id,
  value
) {

  const el = $(id);

  if (el) {

    el.textContent =
      value ?? "--";

  }

}


function safeHTML(
  id,
  value
) {

  const el = $(id);

  if (el) {

    el.innerHTML =
      value ?? "";

  }

}


// ============================================================
// NUMBERS
// ============================================================

function num(
  value,
  fallback = 0
) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;

}


// ============================================================
// TIME
// ============================================================

function formatTime(
  value
) {

  const n =
    Number(value);

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {

    return "--";

  }


  const d =
    new Date(n);


  if (
    Number.isNaN(
      d.getTime()
    )
  ) {

    return "--";

  }


  return d.toLocaleString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  );

}


function formatClock(
  value
) {

  const n =
    Number(value);

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {

    return "--";

  }


  return new Date(n)
    .toLocaleTimeString(
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

function toast(
  message,
  type = ""
) {

  const el =
    $("toast");

  if (!el) return;


  el.textContent =
    message;


  el.className =
    "toast show " +
    type;


  clearTimeout(
    toast.timer
  );


  toast.timer =
    setTimeout(
      () => {

        el.className =
          "toast";

      },
      3500
    );

}


// ============================================================
// GLOBAL ERROR
// ============================================================

window.addEventListener(
  "error",
  event => {

    console.error(
      "Website error:",
      event.error || event.message
    );

  }
);


window.addEventListener(
  "unhandledrejection",
  event => {

    console.error(
      "Unhandled promise:",
      event.reason
    );

  }
);


// ============================================================
// LOGIN
// ============================================================

$("loginForm")
  ?.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      safeText(
        "loginError",
        ""
      );


      const button =
        $("loginButton");


      if (button) {

        button.disabled =
          true;

        button.textContent =
          "SIGNING IN...";

      }


      try {

        await signInWithEmailAndPassword(

          auth,

          $("email")
            .value
            .trim(),

          $("password")
            .value

        );


        safeText(
          "firebaseStatus",
          "Firebase authentication successful."
        );

      }

      catch (error) {

        console.error(
          "Login:",
          error
        );


        safeText(
          "loginError",
          firebaseError(error)
        );


        safeText(
          "firebaseStatus",
          "Authentication failed."
        );

      }

      finally {

        if (button) {

          button.disabled =
            false;

          button.textContent =
            "SIGN IN";

        }

      }

    }
  );


// ============================================================
// FIREBASE ERROR
// ============================================================

function firebaseError(
  error
) {

  const code =
    error?.code || "";


  const messages = {

    "auth/invalid-credential":
      "Invalid email or password.",

    "auth/invalid-email":
      "Invalid email address.",

    "auth/user-disabled":
      "This Firebase user is disabled.",

    "auth/network-request-failed":
      "Network connection failed.",

    "permission-denied":
      "Firebase permission denied.",

    "PERMISSION_DENIED":
      "Firebase database permission denied."

  };


  return (
    messages[code] ||
    error?.message ||
    "Firebase operation failed."
  );

}


// ============================================================
// LOGOUT
// ============================================================

$("logoutBtn")
  ?.addEventListener(
    "click",
    async () => {

      try {

        await signOut(auth);

      }

      catch (error) {

        toast(
          firebaseError(error),
          "error"
        );

      }

    }
  );


// ============================================================
// AUTH
// ============================================================

onAuthStateChanged(
  auth,
  user => {

    if (user) {

      $("loginScreen")
        ?.classList
        .add("hidden");


      $("app")
        ?.classList
        .remove("hidden");


      safeText(
        "firebaseStatus",
        "Firebase connected."
      );


      if (!databaseStarted) {

        databaseStarted =
          true;

        initCharts();

        startDatabaseListeners();

      }

    }

    else {

      $("loginScreen")
        ?.classList
        .remove("hidden");


      $("app")
        ?.classList
        .add("hidden");

    }

  }
);


// ============================================================
// NAVIGATION
// ============================================================

document
  .querySelectorAll(".nav-btn")
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          openPage(
            button.dataset.page
          );

        }
      );

    }
  );


function openPage(
  page
) {

  document
    .querySelectorAll(".page")
    .forEach(
      section => {

        section.classList
          .remove("active");

      }
    );


  $(page)
    ?.classList
    .add("active");


  document
    .querySelectorAll(".nav-btn")
    .forEach(
      button => {

        button.classList.toggle(

          "active",

          button.dataset.page ===
          page

        );

      }
    );


  const titles = {

    dashboard:
      "System Dashboard",

    zones:
      "3-Zone Monitor",

    sensors:
      "Gas Sensors",

    analytics:
      "Analytics",

    control:
      "System Controls",

    history:
      "System History",

    settings:
      "System Settings",

    diagnostics:
      "Diagnostics",

    firmware:
      "Firmware Management"

  };


  safeText(
    "pageTitle",
    titles[page] ||
    "SILO GUARD"
  );

}


// ============================================================
// DATABASE LISTENERS
// ============================================================

function startDatabaseListeners() {

  listen(
    "siloSystem/status",
    value => {

      state.status =
        value || {};

      renderStatus();

      renderCuring();

      updateConnection();

      updateLiveChart();

      renderFirmware();

    }
  );


  listen(
    "siloSystem/sensors",
    value => {

      state.sensors =
        value || {};

      renderSensors();

      renderZones();

    }
  );


  listen(
    "siloSystem/zones",
    value => {

      state.zones =
        value || {};

      renderZones();

    }
  );


  listen(
    "siloSystem/control",
    value => {

      state.control =
        value || {};

      renderControls();

      renderFirmware();

    }
  );


  listen(
    "siloSystem/settings",
    value => {

      state.settings =
        value || {};

      renderSettings();

      renderStatus();

      renderSensors();

      renderZones();

    }
  );


  listen(
    "siloSystem/diagnostics",
    value => {

      state.diagnostics =
        value || {};

      renderDiagnostics();

    }
  );


  listen(
    "siloSystem/history",
    value => {

      state.history =
        value || {};

      renderHistory();

      updateHistoryCharts();

    }
  );


  listen(
    "siloSystem/firmware",
    value => {

      state.firmware =
        value || {};

      renderFirmware();

    }
  );

}


function listen(
  path,
  callback
) {

  onValue(

    ref(db, path),

    snapshot => {

      hideDatabaseError();

      callback(
        snapshot.val()
      );

    },

    error => {

      console.error(
        path,
        error
      );


      showDatabaseError(
        `${path}: ${firebaseError(error)}`
      );

    }

  );

}


// ============================================================
// DATABASE ERROR UI
// ============================================================

function showDatabaseError(
  message
) {

  $("databaseError")
    ?.classList
    .remove("hidden");


  safeText(
    "databaseErrorText",
    message
  );

}


function hideDatabaseError() {

  $("databaseError")
    ?.classList
    .add("hidden");

}


// ============================================================
// STATUS
// ============================================================

function renderStatus() {

  const s =
    state.status;


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


  safeText(
    "maxGas",
    Math.round(maxGas)
  );


  safeText(
    "averageGas",
    Math.round(
      num(
        s.averageGasReading,
        0
      )
    )
  );


  safeText(
    "thresholdText",
    dangerThreshold
  );


  if ($("gasProgress")) {

    $("gasProgress").style.width =
      Math.min(
        100,
        maxGas / 4095 * 100
      ) + "%";

  }


  const battery =
    num(
      s.batteryPercentage,
      0
    );


  safeText(
    "batteryVoltage",
    num(
      s.batteryVoltage,
      0
    ).toFixed(2) +
    " V"
  );


  safeText(
    "batteryPercentage",
    Math.round(battery) +
    "%"
  );


  if ($("batteryProgress")) {

    $("batteryProgress").style.width =
      Math.max(
        0,
        Math.min(
          100,
          battery
        )
      ) + "%";

  }


  safeText(
    "internalTemp",
    num(
      s.temperatureInternal,
      0
    ).toFixed(1) +
    "°C"
  );


  safeText(
    "internalHumidity",
    Math.round(
      num(
        s.humidityInternal,
        0
      )
    ) +
    "%"
  );


  safeText(
    "externalTemp",
    num(
      s.temperatureExternal,
      0
    ).toFixed(1) +
    "°C"
  );


  safeText(
    "externalHumidity",
    Math.round(
      num(
        s.humidityExternal,
        0
      )
    ) +
    "%"
  );


  safeText(
    "fanStatus",
    s.fan
      ? "ACTIVE"
      : "STANDBY"
  );


  safeText(
    "activeReason",
    s.activeFanReason ||
    "STANDBY"
  );


  safeText(
    "fillStatus",
    s.fillStatus ||
    "0% (EMPTY)"
  );


  const zone =
    num(
      s.activeRotZone,
      -1
    );


  safeText(
    "activeZone",
    zone < 0
      ? "None"
      : `Zone ${zone}`
  );


  safeText(
    "rotAngle",
    num(
      s.preciseRotAngle,
      0
    ).toFixed(1) +
    "°"
  );


  safeText(
    "vectorMagnitude",
    num(
      s.vectorMagnitude,
      0
    ).toFixed(0)
  );


  safeText(
    "deviceIdText",
    s.deviceId ||
    DEVICE_ID
  );


  safeText(
    "ipAddress",
    s.ipAddress ||
    "--"
  );


  safeText(
    "wifiRSSI",
    s.wifiRSSI !== undefined
      ? `${s.wifiRSSI} dBm`
      : "--"
  );


  safeText(
    "firmwareVersion",
    s.firmwareVersion ||
    "--"
  );


  safeText(
    "hardwareVersion",
    s.hardwareVersion ||
    "--"
  );


  const gasDanger =
    Boolean(
      s.gasDetected
    );


  const warning =
    maxGas >=
    warningThreshold;


  $("dangerAlert")
    ?.classList
    .toggle(
      "hidden",
      !gasDanger &&
      !warning
    );


  safeText(

    "dangerMessage",

    gasDanger

      ? `Gas danger detected. Maximum ADC: ${Math.round(maxGas)}.`

      : warning

        ? `Gas warning detected. Maximum ADC: ${Math.round(maxGas)}.`

        : "Gas level normal."

  );


  const badge =
    $("systemBadge");


  if (badge) {

    badge.className =
      "badge " +
      (
        gasDanger
          ? "danger"
          : warning
            ? "warning"
            : "safe"
      );


    badge.textContent =
      gasDanger
        ? "GAS DANGER"
        : warning
          ? "GAS WARNING"
          : "SYSTEM SECURE";

  }


  safeText(
    "gasState",

    gasDanger
      ? "DANGER"
      : warning
        ? "WARNING"
        : "NORMAL"

  );


  const gasState =
    $("gasState");


  if (gasState) {

    gasState.className =
      gasDanger
        ? "danger-text"
        : warning
          ? "warning-text"
          : "safe-text";

  }

}


// ============================================================
// CURING
// ============================================================

function renderCuring() {

  const s =
    state.status;


  const active =
    Boolean(
      s.curingActive
    );


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


  safeText(
    "curingStatus",
    s.curingStatus ||
    "HARVEST DATE NOT SET"
  );


  safeText(

    "curingDay",

    active

      ? `${num(s.curingDay,0)} / 14 days`

      : s.harvestTimestamp
        ? "14 / 14 days"
        : "0 / 14 days"

  );


  if ($("curingProgress")) {

    $("curingProgress")
      .style.width =
      progress + "%";

  }


  safeText(

    "harvestDate",

    s.harvestTimestamp
      ? formatTime(
          s.harvestTimestamp
        )
      : "Not set"

  );

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
    Date.now() -
      heartbeat <
      OFFLINE_TIMEOUT;


  $("connectionDot")
    ?.classList
    .toggle(
      "online",
      online
    );


  $("connectionDot")
    ?.classList
    .toggle(
      "offline",
      !online
    );


  safeText(
    "connectionText",
    online
      ? "Device Online"
      : "Device Offline"
  );


  safeText(

    "lastSeen",

    online

      ? `Heartbeat ${formatClock(heartbeat)}`

      : heartbeat
        ? `Last seen ${formatTime(heartbeat)}`
        : "Waiting for ESP32"

  );


  safeText(
    "onlineCard",
    online
      ? "ONLINE"
      : "OFFLINE"
  );

}


setInterval(
  updateConnection,
  3000
);


// ============================================================
// SENSOR
// ============================================================

function sensorLevel(
  value
) {

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


  if (
    value >= danger
  ) {

    return {
      className: "danger",
      text: "DANGER"
    };

  }


  if (
    value >= warning
  ) {

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


function sensorCard(
  index,
  value
) {

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

        <small>ADC</small>

        <small class="${healthy ? "ok" : "bad"}">
          ${healthy ? "● HEALTHY" : "● FAULT"}
        </small>

      </div>

    </div>

  `;

}


function renderSensors() {

  let html = "";


  for (
    let i = 1;
    i <= SENSOR_COUNT;
    i++
  ) {

    html +=
      sensorCard(

        i,

        num(
          state.sensors[
            "gas" + i
          ],
          0
        )

      );

  }


  safeHTML(
    "allSensors",
    html
  );


  safeHTML(
    "sensorPreview",
    html
  );

}


// ============================================================
// ZONE
// ============================================================

function getZone(
  zone
) {

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
          (a,b) =>
            a + b,
          0
        ) / 3
      )

  };

}


function zoneCard(
  zone
) {

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

          `
        ).join("")}

      </div>

      <div class="zone-average">
        Average:
        ${Math.round(data.average)}
      </div>

    </div>

  `;

}


function renderZones() {

  let html = "";


  [1,2,3].forEach(
    zone => {

      html +=
        zoneCard(zone);

    }
  );


  safeHTML(
    "zoneCards",
    html
  );


  safeHTML(
    "zonePreview",
    html
  );


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


  const fanCommand =
    Boolean(c.fan);


  const buzzerCommand =
    Boolean(c.buzzer);


  const remote =
    String(
      c.mode || "AUTO"
    ).toUpperCase() ===
    "REMOTE";


  safeText(
    "fanToggle",
    fanCommand
      ? "FAN ON"
      : "FAN OFF"
  );


  safeText(
    "buzzerToggle",
    buzzerCommand
      ? "BUZZER ON"
      : "BUZZER OFF"
  );


  safeText(
    "actualFanState",
    s.fan
      ? "ON"
      : "OFF"
  );


  safeText(
    "buzzerStateText",
    s.buzzer
      ? "ON"
      : "OFF"
  );


  safeText(
    "activeFanReasonControl",
    s.activeFanReason ||
    "STANDBY"
  );


  safeText(
    "controlModeText",
    remote
      ? "REMOTE"
      : "AUTO"
  );


  $("autoMode")
    ?.classList
    .toggle(
      "active",
      !remote
    );


  $("remoteMode")
    ?.classList
    .toggle(
      "active",
      remote
    );


  $("fanIndicator")
    ?.classList
    .toggle(
      "on",
      Boolean(s.fan)
    );


  $("buzzerIndicator")
    ?.classList
    .toggle(
      "on",
      Boolean(s.buzzer)
    );


  safeText(
    "emergencyState",
    c.emergency
      ? "ACTIVE"
      : "CLEAR"
  );

}


// ============================================================
// WRITE CONTROL
// ============================================================

async function writeControl(
  values
) {

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


    toast(
      "Command sent"
    );

  }

  catch (error) {

    console.error(
      error
    );


    toast(
      firebaseError(error),
      "error"
    );

  }

}


// ============================================================
// FAN
// ============================================================

$("fanToggle")
  ?.addEventListener(
    "click",
    async () => {

      await writeControl({

        fan:
          !Boolean(
            state.control.fan
          ),

        mode:
          "REMOTE"

      });

    }
  );


// ============================================================
// BUZZER
// ============================================================

$("buzzerToggle")
  ?.addEventListener(
    "click",
    async () => {

      await writeControl({

        buzzer:
          !Boolean(
            state.control.buzzer
          ),

        mode:
          "REMOTE"

      });

    }
  );


// ============================================================
// MODES
// ============================================================

$("autoMode")
  ?.addEventListener(
    "click",
    () => {

      writeControl({
        mode: "AUTO"
      });

    }
  );


$("remoteMode")
  ?.addEventListener(
    "click",
    () => {

      writeControl({
        mode: "REMOTE"
      });

    }
  );


// ============================================================
// EMERGENCY
// ============================================================

$("emergencyBtn")
  ?.addEventListener(
    "click",
    async () => {

      if (
        !confirm(
          "Activate emergency ventilation?"
        )
      ) return;


      await writeControl({

        emergency: true,

        fan: true,

        buzzer: true,

        mode: "REMOTE"

      });

    }
  );


$("resetEmergency")
  ?.addEventListener(
    "click",
    async () => {

      if (
        !confirm(
          "Reset emergency?"
        )
      ) return;


      await writeControl({

        emergency: false,

        fan: false,

        buzzer: false,

        mode: "AUTO"

      });

    }
  );


// ============================================================
// SETTINGS
// ============================================================

function renderSettings() {

  if ($("gasThresholdInput")) {

    $("gasThresholdInput").value =
      num(
        state.settings.gasThreshold,
        2000
      );

  }


  if ($("warningThresholdInput")) {

    $("warningThresholdInput").value =
      num(
        state.settings.warningThreshold,
        1500
      );

  }

}


$("saveThreshold")
  ?.addEventListener(
    "click",
    async () => {

      const value =
        num(
          $("gasThresholdInput")
            .value,
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
          firebaseError(error),
          "error"
        );

      }

    }
  );


$("saveWarning")
  ?.addEventListener(
    "click",
    async () => {

      const value =
        num(
          $("warningThresholdInput")
            .value,
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
          firebaseError(error),
          "error"
        );

      }

    }
  );


// ============================================================
// DIAGNOSTICS
// ============================================================

function renderDiagnostics() {

  const d =
    state.diagnostics;


  safeText(
    "diagFirebase",
    d.firebaseHealthy === false
      ? "FAULT"
      : "OK"
  );


  safeText(
    "diagWiFi",
    d.wifiConnected === false
      ? "FAULT"
      : "OK"
  );


  safeText(
    "diagDhtInt",
    d.dhtInternalHealthy === false
      ? "FAULT"
      : "OK"
  );


  safeText(
    "diagDhtExt",
    d.dhtExternalHealthy === false
      ? "FAULT"
      : "OK"
  );


  safeText(
    "diagFan",
    d.fanDiagnosticFault
      ? "FAULT"
      : "COMMAND OK"
  );


  safeText(
    "diagHeartbeat",
    formatTime(
      state.status.lastHeartbeat
    )
  );


  let html = "";


  for (
    let i = 1;
    i <= 9;
    i++
  ) {

    const x =
      d[
        "mq" + i
      ] || {};


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


  safeHTML(
    "mqDiagnostics",
    html
  );

}


// ============================================================
// HISTORY
// ============================================================

function historyRows() {

  return Object.entries(
    state.history || {}
  )
  .sort(
    ([a], [b]) =>
      Number(b) -
      Number(a)
  )
  .slice(
    0,
    MAX_HISTORY_ROWS
  );

}


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


  safeText(
    "historyCount",
    `${Object.keys(
      state.history || {}
    ).length} records`
  );


  const html =
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
                  ? `Zone ${x.activeZone}`
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
    )
    .join("");


  safeHTML(

    "historyTable",

    html ||

    `<tr>
      <td colspan="9">
        No history available
      </td>
    </tr>`

  );

}


$("clearHistory")
  ?.addEventListener(
    "click",
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
          firebaseError(error),
          "error"
        );

      }

    }
  );


// ============================================================
// CHARTS
// ============================================================

function initCharts() {

  if (
    typeof Chart ===
    "undefined"
  ) {

    console.error(
      "Chart.js not loaded."
    );

    return;

  }


  charts.live =
    makeChart(

      "liveGasChart",

      "line",

      ["Maximum Gas", "Average Gas"],

      []

    );


  charts.zone =
    makeChart(

      "zoneChart",

      "bar",

      ["Zone 1", "Zone 2", "Zone 3"],

      ["Peak Gas"]

    );


  charts.gas =
    makeChart(

      "gasHistoryChart",

      "line",

      ["Maximum Gas"],

      []

    );


  charts.temperature =
    makeChart(

      "temperatureChart",

      "line",

      ["Temperature"],

      []

    );


  charts.humidity =
    makeChart(

      "humidityChart",

      "line",

      ["Humidity"],

      []

    );


  charts.battery =
    makeChart(

      "batteryChart",

      "line",

      ["Battery"],

      []

    );

}


function makeChart(
  id,
  type,
  labels,
  datasets
) {

  const canvas =
    $(id);


  if (!canvas) {

    return null;

  }


  const dataSets =
    datasets.map(
      label => ({
        label,
        data: [],
        tension: .3,
        pointRadius: 1
      })
    );


  return new Chart(
    canvas,
    {

      type,

      data: {

        labels: type === "bar"
          ? labels
          : [],

        datasets:
          dataSets

      },

      options: {

        responsive: true,

        maintainAspectRatio:
          false,

        animation: false,

        interaction: {
          mode: "index",
          intersect: false
        },

        plugins: {

          legend: {
            display: true
          }

        },

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
// LIVE CHART
// ============================================================

function updateLiveChart() {

  const chart =
    charts.live;


  if (!chart) return;


  const timestamp =
    num(
      state.status.lastUpdate,
      0
    );


  if (
    timestamp <= 0 ||
    timestamp ===
    lastLiveTimestamp
  ) {

    return;

  }


  lastLiveTimestamp =
    timestamp;


  const labels =
    chart.data.labels;


  const max =
    chart.data.datasets[0]
      .data;


  const avg =
    chart.data.datasets[1]
      .data;


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


  chart.update("none");

}


// ============================================================
// ZONE CHART
// ============================================================

function updateZoneChart() {

  const chart =
    charts.zone;


  if (!chart) return;


  chart.data.datasets[0]
    .data = [

      getZone(1).peak,

      getZone(2).peak,

      getZone(3).peak

    ];


  chart.update("none");

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
    charts.gas,
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
    charts.temperature,
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
    charts.humidity,
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
    charts.battery,
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
// OTA HELPERS
// ============================================================

function latestFirmware() {

  return state.firmware
    ?.latest || {};

}


function firmwareCommand() {

  return state.firmware
    ?.command || {};

}


function firmwareDevice() {

  return state.firmware
    ?.device || {};

}


// ============================================================
// OTA DISPLAY
// ============================================================

function renderFirmware() {

  const latest =
    latestFirmware();


  const command =
    firmwareCommand();


  const device =
    firmwareDevice();


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


  safeText(
    "otaDeviceId",
    device.deviceId ||
    state.status.deviceId ||
    DEVICE_ID
  );


  safeText(
    "otaCurrentVersion",
    currentVersion
  );


  safeText(
    "otaCurrentBuild",
    currentBuild || "--"
  );


  safeText(
    "otaCurrentHardware",
    device.hardwareVersion ||
    state.status.hardwareVersion ||
    "--"
  );


  safeText(
    "otaState",
    device.state ||
    state.status.otaState ||
    "IDLE"
  );


  safeText(
    "otaProgressText",
    num(
      device.progress ??
      state.status.otaProgress,
      0
    ) + "%"
  );


  safeText(
    "otaLatestVersion",
    latest.version ||
    "--"
  );


  safeText(
    "otaLatestBuild",
    latest.build ??
    "--"
  );


  safeText(
    "otaTarget",
    command.targetDevice ||
    DEVICE_ID
  );


  safeText(
    "otaHash",
    latest.sha256 ||
    "--"
  );


  const newer =
    latestBuild >
    currentBuild;


  const blocked =
    Boolean(
      state.status.gasDetected
    ) ||
    Boolean(
      state.control.emergency
    );


  const deploy =
    $("deployLatest");


  if (deploy) {

    deploy.disabled =
      !newer ||
      blocked ||
      !latest.url;

  }


  const badge =
    $("otaBadge");


  const info =
    $("deployInfo");


  if (blocked) {

    if (badge) {

      badge.className =
        "badge danger";

      badge.textContent =
        "OTA BLOCKED";

    }


    if (info) {

      info.textContent =
        "OTA is blocked while gas danger or emergency is active.";

    }

  }

  else if (newer) {

    if (badge) {

      badge.className =
        "badge warning";

      badge.textContent =
        "UPDATE AVAILABLE";

    }


    if (info) {

      info.textContent =
        `Build ${latestBuild} is newer than current build ${currentBuild}.`;

    }

  }

  else {

    if (badge) {

      badge.className =
        "badge safe";

      badge.textContent =
        "OTA READY";

    }


    if (info) {

      info.textContent =
        "No newer firmware is available.";

    }

  }


  renderFirmwareHistory();

}


// ============================================================
// OTA HISTORY
// ============================================================

function renderFirmwareHistory() {

  const history =
    state.firmware
      ?.history || {};


  const entries =
    Object.entries(history)
      .sort(
        ([a],[b]) =>
          Number(b) -
          Number(a)
      )
      .slice(
        0,
        20
      );


  if (!entries.length) {

    safeHTML(
      "firmwareHistory",
      "No firmware releases."
    );

    return;

  }


  safeHTML(

    "firmwareHistory",

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
    ).join("")

  );

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
          .padStart(2, "0")
    )
    .join("");

}


// ============================================================
// UPLOAD OTA
// ============================================================

$("uploadFirmware")
  ?.addEventListener(
    "click",
    async () => {

      const file =
        $("firmwareFile")
          ?.files?.[0];


      const version =
        $("firmwareVersionInput")
          ?.value
          .trim();


      const build =
        num(
          $("firmwareBuildInput")
            ?.value,
          0
        );


      const hardware =
        $("firmwareHardwareInput")
          ?.value
          .trim();


      const notes =
        $("releaseNotesInput")
          ?.value
          .trim();


      if (!file) {

        toast(
          "Select a .bin file.",
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
          "Only .bin firmware files are allowed.",
          "error"
        );

        return;

      }


      if (!version) {

        toast(
          "Enter firmware version.",
          "error"
        );

        return;

      }


      if (build <= 0) {

        toast(
          "Enter valid build number.",
          "error"
        );

        return;

      }


      try {

        $("uploadFirmware")
          .disabled = true;


        safeText(
          "uploadStatus",
          "Calculating SHA-256..."
        );


        $("uploadProgress")
          .style.width =
          "0%";


        const buffer =
          await file.arrayBuffer();


        const sha256 =
          await calculateSHA256(
            buffer
          );


        safeText(
          "otaHash",
          sha256
        );


        const safeFileName =
          file.name.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
          );


        const storagePath =
          `firmware/${hardware}/build-${build}-${safeFileName}`;


        safeText(
          "uploadStatus",
          "Starting upload..."
        );


        const fileRef =
          storageRef(
            storage,
            storagePath
          );


        const task =
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

                sha256

              }

            }

          );


        await new Promise(
          (resolve, reject) => {

            task.on(

              "state_changed",

              snapshot => {

                const percent =
                  snapshot.totalBytes > 0

                    ? (
                        snapshot.bytesTransferred /
                        snapshot.totalBytes
                      ) * 100

                    : 0;


                $("uploadProgress")
                  .style.width =
                  percent + "%";


                safeText(
                  "uploadStatus",
                  `Uploading ${percent.toFixed(0)}%`
                );

              },

              reject,

              resolve

            );

          }
        );


        safeText(
          "uploadStatus",
          "Creating download URL..."
        );


        const url =
          await getDownloadURL(
            task.snapshot.ref
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

          url,

          releaseNotes:
            notes,

          publishedAt:
            timestamp

        };


        await update(

          ref(
            db,
            "siloSystem/firmware/latest"
          ),

          release

        );


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


        safeText(
          "uploadStatus",
          "Firmware published successfully."
        );


        toast(
          "Firmware published."
        );

      }

      catch(error) {

        console.error(
          "OTA upload:",
          error
        );


        safeText(
          "uploadStatus",
          firebaseError(error)
        );


        toast(
          firebaseError(error),
          "error"
        );

      }

      finally {

        $("uploadFirmware")
          .disabled = false;

      }

    }
  );


// ============================================================
// DEPLOY
// ============================================================

$("deployLatest")
  ?.addEventListener(
    "click",
    async () => {

      const latest =
        latestFirmware();


      if (!latest.url) {

        toast(
          "No firmware available.",
          "error"
        );

        return;

      }


      if (
        state.status.gasDetected ||
        state.control.emergency
      ) {

        toast(
          "OTA blocked during safety condition.",
          "error"
        );

        return;

      }


      const device =
        firmwareDevice();


      const target =
        device.deviceId ||
        DEVICE_ID;


      if (
        !confirm(
          `Deploy v${latest.version} build ${latest.build} to ${target}?`
        )
      ) {

        return;

      }


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
          Number(
            latest.build
          ),

        firmwareSize:
          Number(
            latest.fileSize
          ),

        firmwareSha256:
          latest.sha256,

        hardwareVersion:
          latest.hardwareVersion,

        releaseNotes:
          latest.releaseNotes ||
          "",

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
          "OTA command sent."
        );

      }

      catch(error) {

        toast(
          firebaseError(error),
          "error"
        );

      }

    }
  );


// ============================================================
// CLEAR OTA
// ============================================================

$("clearOtaCommand")
  ?.addEventListener(
    "click",
    async () => {

      if (
        !confirm(
          "Clear pending OTA command?"
        )
      ) {

        return;

      }


      try {

        await remove(
          ref(
            db,
            "siloSystem/firmware/command"
          )
        );


        toast(
          "OTA command cleared."
        );

      }

      catch(error) {

        toast(
          firebaseError(error),
          "error"
        );

      }

    }
  );


// ============================================================
// CLOCK
// ============================================================

function updateClock() {

  safeText(
    "clock",
    new Date()
      .toLocaleTimeString(
        "en-IN"
      )
  );

}


setInterval(
  updateClock,
  1000
);


updateClock();
