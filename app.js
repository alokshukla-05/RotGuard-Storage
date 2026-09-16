import {

    auth,
    db,
    storage,

    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,

    ref,
    onValue,
    set,
    update,
    push,
    remove,

    storageRef,
    uploadBytesResumable,
    getDownloadURL

} from "./firebase-config.js";


// ======================================================
// CONFIG
// ======================================================

const DEVICE_ID = "silo-guard-01";

const ADMIN_EMAILS = [

    "major@gmail.com"

];

const OFFLINE_TIMEOUT = 15000;


// ======================================================
// GLOBAL STATE
// ======================================================

const state = {

    status: {},

    sensors: {},

    zones: {},

    control: {},

    settings: {},

    diagnostics: {},

    history: {},

    firmware: {

        latest: {},

        command: {},

        device: {},

        history: {}

    }

};


// ======================================================
// HELPERS
// ======================================================

function $(id) {

    return document.getElementById(id);

}


function number(value, fallback = 0) {

    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;

}


function escapeHTML(value) {

    return String(value ?? "")

        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


function showToast(message, type = "") {

    const toast = $("toast");

    if (!toast) return;

    toast.textContent = message;

    toast.className =
        "toast show " + type;

    clearTimeout(window.toastTimer);

    window.toastTimer =
        setTimeout(() => {

            toast.className = "toast";

        }, 3000);

}


function formatTime(timestamp) {

    const n = Number(timestamp);

    if (!n || !Number.isFinite(n)) {

        return "--";

    }

    const date = new Date(n);

    if (Number.isNaN(date.getTime())) {

        return "--";

    }

    return date.toLocaleString(
        "en-IN",
        {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }
    );

}


function shortTime(timestamp) {

    const n = Number(timestamp);

    if (!n || !Number.isFinite(n)) {

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


function isAdmin() {

    const user = auth.currentUser;

    if (!user) return false;

    return ADMIN_EMAILS
        .map(x => x.toLowerCase())
        .includes(
            (user.email || "").toLowerCase()
        );

}


// ======================================================
// LOGIN
// ======================================================

const loginForm = $("loginForm");

if (loginForm) {

    loginForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();

            const email =
                $("email").value.trim();

            const password =
                $("password").value;

            $("loginError").textContent = "";

            try {

                await signInWithEmailAndPassword(
                    auth,
                    email,
                    password
                );

            }

            catch (error) {

                console.error(error);

                $("loginError").textContent =
                    "Login failed. Check email/password.";

            }

        }
    );

}


// ======================================================
// LOGOUT
// ======================================================

if ($("logoutBtn")) {

    $("logoutBtn").onclick = async () => {

        await signOut(auth);

    };

}


// ======================================================
// NAVIGATION
// ======================================================

document
    .querySelectorAll("[data-section]")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                navigate(
                    button.dataset.section
                );

            }
        );

    });


function navigate(section) {

    document
        .querySelectorAll(".page-section")
        .forEach(sectionElement => {

            sectionElement.classList.remove(
                "active-section"
            );

        });


    const target =
        $(section);

    if (target) {

        target.classList.add(
            "active-section"
        );

    }


    document
        .querySelectorAll(".nav-item")
        .forEach(button => {

            button.classList.remove(
                "active"
            );

        });


    const nav =
        document.querySelector(
            `.nav-item[data-section="${section}"]`
        );


    if (nav) {

        nav.classList.add("active");

    }


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


    if ($("pageTitle")) {

        $("pageTitle").textContent =
            titles[section] ||
            "SILO Guard";

    }

}


// ======================================================
// AUTH STATE
// ======================================================

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

            startFirebase();

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


// ======================================================
// FIREBASE START
// ======================================================

let firebaseStarted = false;

function startFirebase() {

    if (firebaseStarted) return;

    firebaseStarted = true;


    // STATUS

    onValue(

        ref(db, "siloSystem/status"),

        snapshot => {

            state.status =
                snapshot.val() || {};

            renderStatus();

            renderCuring();

            updateOnline();

        },

        error => {

            console.error(
                "Status error:",
                error
            );

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

        }

    );


    // ==================================================
    // FIRMWARE
    // ==================================================

    onValue(

        ref(db, "siloSystem/firmware"),

        snapshot => {

            const data =
                snapshot.val() || {};


            state.firmware = {

                latest:
                    data.latest || {},

                command:
                    data.command || {},

                device:
                    data.device || {},

                history:
                    data.history || {}

            };


            renderFirmware();

        },

        error => {

            console.error(
                "Firmware Firebase error:",
                error
            );

        }

    );

}


// ======================================================
// STATUS
// ======================================================

function renderStatus() {

    const s = state.status;

    const dangerThreshold =
        number(
            state.settings.gasThreshold,
            2000
        );

    const warningThreshold =
        number(
            state.settings.warningThreshold,
            1500
        );


    const maxGas =
        number(
            s.maxGasReading,
            0
        );


    if ($("maxGas"))
        $("maxGas").textContent =
            Math.round(maxGas);


    if ($("averageGas"))
        $("averageGas").textContent =
            Math.round(
                number(
                    s.averageGasReading
                )
            );


    if ($("thresholdText"))
        $("thresholdText").textContent =
            dangerThreshold;


    if ($("gasProgress"))
        $("gasProgress").style.width =
            Math.min(
                maxGas / 4095 * 100,
                100
            ) + "%";


    const battery =
        number(
            s.batteryPercentage,
            0
        );


    if ($("batteryVoltage"))
        $("batteryVoltage").textContent =
            number(
                s.batteryVoltage
            ).toFixed(2) + "V";


    if ($("batteryPercentage"))
        $("batteryPercentage").textContent =
            Math.round(battery) + "%";


    if ($("batteryProgress"))
        $("batteryProgress").style.width =
            battery + "%";


    if ($("fanStatus"))
        $("fanStatus").textContent =
            s.fan
                ? "ACTIVE"
                : "STANDBY";


    if ($("activeReason"))
        $("activeReason").textContent =
            s.activeFanReason ||
            "STANDBY";


    if ($("activeZone"))
        $("activeZone").textContent =
            number(
                s.activeRotZone,
                -1
            ) < 0

                ? "None"

                : "Zone " +
                  s.activeRotZone;


    if ($("rotAngle"))
        $("rotAngle").textContent =
            number(
                s.preciseRotAngle
            ).toFixed(1) + "°";


    if ($("vectorMagnitude"))
        $("vectorMagnitude").textContent =
            number(
                s.vectorMagnitude
            ).toFixed(0);


    if ($("fillStatus"))
        $("fillStatus").textContent =
            s.fillStatus ||
            "0% (EMPTY)";


    if ($("internalTemp"))
        $("internalTemp").textContent =
            number(
                s.temperatureInternal
            ).toFixed(1) + "°C";


    if ($("internalHumidity"))
        $("internalHumidity").textContent =
            Math.round(
                number(
                    s.humidityInternal
                )
            ) + "%";


    if ($("externalTemp"))
        $("externalTemp").textContent =
            number(
                s.temperatureExternal
            ).toFixed(1) + "°C";


    if ($("externalHumidity"))
        $("externalHumidity").textContent =
            Math.round(
                number(
                    s.humidityExternal
                )
            ) + "%";


    if ($("firmwareVersion"))
        $("firmwareVersion").textContent =
            s.firmwareVersion ||
            "--";


    if ($("hardwareVersion"))
        $("hardwareVersion").textContent =
            s.hardwareVersion ||
            "--";


    if ($("ipAddress"))
        $("ipAddress").textContent =
            s.ipAddress ||
            "--";


    if ($("wifiRSSI"))
        $("wifiRSSI").textContent =
            s.wifiRSSI !== undefined
                ? s.wifiRSSI + " dBm"
                : "--";


    if ($("lastUpdate"))
        $("lastUpdate").textContent =
            formatTime(
                s.lastUpdate
            );


    if ($("lastHeartbeatValue"))
        $("lastHeartbeatValue").textContent =
            formatTime(
                s.lastHeartbeat
            );


    const danger =
        Boolean(
            s.gasDetected
        );


    const warning =
        maxGas >= warningThreshold;


    if ($("systemBadge")) {

        $("systemBadge")
            .className =
                "system-badge " +
                (
                    danger
                        ? "danger"
                        : warning
                            ? "warning"
                            : "safe"
                );


        $("systemBadge")
            .textContent =
                danger
                    ? "GAS DETECTED"
                    : warning
                        ? "WARNING"
                        : "SYSTEM SECURE";

    }


    if ($("dangerAlert")) {

        $("dangerAlert")
            .classList
            .toggle(
                "hidden",
                !danger && !warning
            );

    }


    if ($("dangerMessage")) {

        $("dangerMessage")
            .textContent =

            danger

                ? `Gas danger detected. Maximum ADC ${Math.round(maxGas)}.`

                : warning

                    ? `Gas warning level detected. Current ADC ${Math.round(maxGas)}.`

                    : "Normal.";

    }


    if ($("gasState")) {

        $("gasState")
            .textContent =
                danger
                    ? "DANGER"
                    : warning
                        ? "WARNING"
                        : "NORMAL";


        $("gasState")
            .className =
                "pill " +
                (
                    danger
                        ? "danger"
                        : warning
                            ? "warning"
                            : "safe"
                );

    }

}


// ======================================================
// CURING
// ======================================================

function renderCuring() {

    const s =
        state.status;


    const progress =
        Math.max(
            0,
            Math.min(
                100,
                number(
                    s.curingProgress
                )
            )
        );


    if ($("curingProgress"))
        $("curingProgress")
            .style
            .width =
                progress + "%";


    if ($("curingStatus"))
        $("curingStatus")
            .textContent =
                s.curingStatus ||
                "HARVEST DATE NOT SET";


    if ($("curingDay")) {

        const day =
            number(
                s.curingDay,
                0
            );

        $("curingDay")
            .textContent =
                `${day} / 14 days`;

    }


    if ($("harvestDate"))
        $("harvestDate")
            .textContent =
                s.harvestTimestamp
                    ? formatTime(
                        s.harvestTimestamp
                    )
                    : "Not set";

}


// ======================================================
// ONLINE
// ======================================================

function updateOnline() {

    const heartbeat =
        number(
            state.status.lastHeartbeat
        );


    const online =
        heartbeat > 0 &&
        Date.now() - heartbeat <
            OFFLINE_TIMEOUT;


    if ($("connectionDot")) {

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

    }


    if ($("connectionText"))
        $("connectionText")
            .textContent =
                online
                    ? "Device Online"
                    : "Device Offline";


    if ($("lastSeen"))
        $("lastSeen")
            .textContent =
                online
                    ? "Heartbeat " +
                      shortTime(
                          heartbeat
                      )
                    : heartbeat
                        ? "Last seen " +
                          formatTime(
                              heartbeat
                          )
                        : "Waiting for ESP32...";

}


setInterval(
    updateOnline,
    3000
);


// ======================================================
// SENSORS
// ======================================================

function sensorStatus(value) {

    const danger =
        number(
            state.settings.gasThreshold,
            2000
        );

    const warning =
        number(
            state.settings.warningThreshold,
            1500
        );


    if (value >= danger)
        return {
            className: "danger",
            text: "DANGER"
        };


    if (value >= warning)
        return {
            className: "warning",
            text: "WARNING"
        };


    return {
        className: "",
        text: "NORMAL"
    };

}


function renderSensors() {

    let html = "";


    for (
        let i = 1;
        i <= 9;
        i++
    ) {

        const value =
            number(
                state.sensors[
                    "gas" + i
                ]
            );


        const status =
            sensorStatus(value);


        const diagnostic =
            state.diagnostics[
                "mq" + i
            ] || {};


        const healthy =
            diagnostic.healthy !== false;


        html += `

        <div class="sensor-card ${status.className}">

            <div class="sensor-top">

                <span class="sensor-name">
                    MQ-135 Sensor ${i}
                </span>

                <span class="sensor-status ${status.className}">
                    ${status.text}
                </span>

            </div>

            <div class="sensor-value">
                ${Math.round(value)}
            </div>

            <div class="sensor-meta">

                <span>
                    ADC 0–4095
                </span>

                <span class="${healthy ? "ok" : "bad"}">
                    ${healthy
                        ? "● HEALTHY"
                        : "● FAULT"}
                </span>

            </div>

        </div>

        `;

    }


    if ($("allSensors"))
        $("allSensors").innerHTML =
            html;


    if ($("sensorPreview"))
        $("sensorPreview").innerHTML =
            html;

}


// ======================================================
// ZONES
// ======================================================

const zoneSensors = {

    1: [1, 2, 3],

    2: [4, 5, 6],

    3: [7, 8, 9]

};


function zoneInfo(zone) {

    const sensors =
        zoneSensors[zone];


    const values =
        sensors.map(
            sensor =>
                number(
                    state.sensors[
                        "gas" + sensor
                    ]
                )
        );


    const firebaseZone =
        state.zones[
            "zone" + zone
        ] || {};


    return {

        values,

        peak:
            number(
                firebaseZone.peak,
                Math.max(...values)
            ),

        average:
            number(
                firebaseZone.average,
                values.reduce(
                    (a,b) => a+b,
                    0
                ) / 3
            ),

        danger:
            Boolean(
                firebaseZone.danger
            )

    };

}


function renderZones() {

    let html = "";


    for (
        let zone = 1;
        zone <= 3;
        zone++
    ) {

        const info =
            zoneInfo(zone);


        const warning =
            number(
                state.settings.warningThreshold,
                1500
            );


        const danger =
            info.danger ||
            info.peak >=
                number(
                    state.settings.gasThreshold,
                    2000
                );


        const warningState =
            info.peak >= warning;


        html += `

        <div class="zone-card ${
            danger
                ? "danger"
                : warningState
                    ? "warning"
                    : ""
        }">

            <div class="zone-header">

                <span class="zone-name">
                    Zone ${zone}
                </span>

                <span class="zone-status">

                    ${
                        danger
                            ? "DANGER"
                            : warningState
                                ? "WARNING"
                                : "NORMAL"
                    }

                </span>

            </div>


            <div class="zone-value">

                ${Math.round(info.peak)}

            </div>


            <small>
                Maximum gas ADC
            </small>


            <div class="zone-sensors">

                ${zoneSensors[zone].map(
                    sensor => `

                    <div class="zone-sensor">

                        <small>
                            MQ-${sensor}
                        </small>

                        <strong>
                            ${Math.round(
                                number(
                                    state.sensors[
                                        "gas" + sensor
                                    ]
                                )
                            )}
                        </strong>

                    </div>

                    `
                ).join("")}

            </div>


            <div class="zone-foot">

                Average:
                ${Math.round(info.average)}

            </div>

        </div>

        `;

    }


    if ($("zoneCards"))
        $("zoneCards").innerHTML =
            html;


    if ($("zonePreview"))
        $("zonePreview").innerHTML =
            html;

}


// ======================================================
// CONTROLS
// ======================================================

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
        c.mode === "REMOTE";


    if ($("fanToggle"))
        $("fanToggle")
            .textContent =
                fan
                    ? "FAN ON"
                    : "FAN OFF";


    if ($("buzzerToggle"))
        $("buzzerToggle")
            .textContent =
                buzzer
                    ? "BUZZER ON"
                    : "BUZZER OFF";


    if ($("quickFan"))
        $("quickFan")
            .querySelector("strong")
            .textContent =
                fan ? "ON" : "OFF";


    if ($("quickBuzzer"))
        $("quickBuzzer")
            .querySelector("strong")
            .textContent =
                buzzer ? "ON" : "OFF";


    if ($("actualFanState"))
        $("actualFanState")
            .textContent =
                s.fan
                    ? "ON"
                    : "OFF";


    if ($("activeFanReasonControl"))
        $("activeFanReasonControl")
            .textContent =
                s.activeFanReason ||
                "STANDBY";


    if ($("controlModeText"))
        $("controlModeText")
            .textContent =
                c.mode ||
                "AUTO";


    if ($("autoMode"))
        $("autoMode")
            .classList
            .toggle(
                "active",
                !remote
            );


    if ($("remoteMode"))
        $("remoteMode")
            .classList
            .toggle(
                "active",
                remote
            );


    if ($("emergencyState"))
        $("emergencyState")
            .textContent =
                c.emergency
                    ? "ACTIVE"
                    : "CLEAR";

}


async function sendControl(values,message) {

    try {

        await update(

            ref(
                db,
                "siloSystem/control"
            ),

            {

                ...values,

                commandId:
                    "cmd-" +
                    Date.now()

            }

        );


        showToast(message);

    }

    catch (error) {

        console.error(error);

        showToast(
            "Command failed",
            "error"
        );

    }

}


async function toggleFan() {

    await sendControl(

        {

            mode: "REMOTE",

            fan:
                !Boolean(
                    state.control.fan
                )

        },

        "Fan command sent"

    );

}


async function toggleBuzzer() {

    await sendControl(

        {

            mode: "REMOTE",

            buzzer:
                !Boolean(
                    state.control.buzzer
                )

        },

        "Buzzer command sent"

    );

}


if ($("fanToggle"))
    $("fanToggle").onclick =
        toggleFan;


if ($("quickFan"))
    $("quickFan").onclick =
        toggleFan;


if ($("buzzerToggle"))
    $("buzzerToggle").onclick =
        toggleBuzzer;


if ($("quickBuzzer"))
    $("quickBuzzer").onclick =
        toggleBuzzer;


if ($("autoMode"))
    $("autoMode").onclick =
        () =>
            sendControl(
                {mode:"AUTO"},
                "AUTO mode enabled"
            );


if ($("remoteMode"))
    $("remoteMode").onclick =
        () =>
            sendControl(
                {mode:"REMOTE"},
                "REMOTE mode enabled"
            );


if ($("emergencyBtn"))
    $("emergencyBtn").onclick =
        async () => {

            if (
                !confirm(
                    "Activate emergency?"
                )
            )
                return;


            await sendControl(

                {

                    mode: "REMOTE",

                    fan: true,

                    buzzer: true,

                    emergency: true

                },

                "Emergency activated"

            );

        };


if ($("quickEmergency"))
    $("quickEmergency").onclick =
        () =>
            $("emergencyBtn")
                ?.click();


if ($("resetEmergency"))
    $("resetEmergency").onclick =
        async () => {

            if (
                !confirm(
                    "Reset emergency?"
                )
            )
                return;


            await sendControl(

                {

                    mode: "AUTO",

                    fan: false,

                    buzzer: false,

                    emergency: false

                },

                "Emergency reset"

            );

        };


// ======================================================
// SETTINGS
// ======================================================

function renderSettings() {

    if ($("gasThresholdInput"))
        $("gasThresholdInput").value =
            number(
                state.settings.gasThreshold,
                2000
            );


    if ($("warningThresholdInput"))
        $("warningThresholdInput").value =
            number(
                state.settings.warningThreshold,
                1500
            );

}


async function saveSetting(name,inputId) {

    const value =
        number(
            $(inputId)?.value,
            -1
        );


    if (
        value < 0 ||
        value > 4095
    ) {

        showToast(
            "Value must be 0–4095",
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

                [name]: value

            }

        );


        showToast(
            "Setting saved"
        );

    }

    catch (error) {

        showToast(
            error.message,
            "error"
        );

    }

}


if ($("saveThreshold"))
    $("saveThreshold").onclick =
        () =>
            saveSetting(
                "gasThreshold",
                "gasThresholdInput"
            );


if ($("saveWarning"))
    $("saveWarning").onclick =
        () =>
            saveSetting(
                "warningThreshold",
                "warningThresholdInput"
            );


// ======================================================
// DIAGNOSTICS
// ======================================================

function renderDiagnostics() {

    const d =
        state.diagnostics;


    if ($("diagFirebase"))
        $("diagFirebase").textContent =
            d.firebaseHealthy === false
                ? "FAULT"
                : "OK";


    if ($("diagWiFi"))
        $("diagWiFi").textContent =
            d.wifiConnected === false
                ? "FAULT"
                : "OK";


    if ($("diagDhtInt"))
        $("diagDhtInt").textContent =
            d.dhtInternalHealthy === false
                ? "FAULT"
                : "OK";


    if ($("diagDhtExt"))
        $("diagDhtExt").textContent =
            d.dhtExternalHealthy === false
                ? "FAULT"
                : "OK";


    if ($("diagFan"))
        $("diagFan").textContent =
            d.fanDiagnosticFault
                ? "FAULT"
                : "COMMAND OK";


    if ($("diagHeartbeat"))
        $("diagHeartbeat").textContent =
            formatTime(
                state.status.lastHeartbeat
            );


    if ($("mqDiagnostics")) {

        let html = "";


        for (
            let i=1;
            i<=9;
            i++
        ) {

            const x =
                d["mq"+i] || {};


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

}


// ======================================================
// HISTORY
// ======================================================

function renderHistory() {

    const entries =
        Object.entries(
            state.history
        )
        .sort(
            ([a],[b]) =>
                Number(b)-Number(a)
        )
        .slice(0,500);


    if ($("historyCount"))
        $("historyCount").textContent =
            `${Object.keys(state.history).length} total records`;


    if (!$("historyTable"))
        return;


    $("historyTable").innerHTML =

        entries.length

            ? entries.map(
                ([timestamp,x]) => `

                <tr>

                    <td>
                        ${formatTime(timestamp)}
                    </td>

                    <td>
                        ${
                            number(
                                x.activeZone,
                                -1
                            ) > 0
                                ? "Zone " +
                                  x.activeZone
                                : "None"
                        }
                    </td>

                    <td>
                        ${Math.round(
                            number(x.maxGas)
                        )}
                    </td>

                    <td>
                        ${Math.round(
                            number(x.averageGas)
                        )}
                    </td>

                    <td>
                        ${number(
                            x.temperature
                        ).toFixed(1)}°C
                    </td>

                    <td>
                        ${number(
                            x.humidity
                        ).toFixed(1)}%
                    </td>

                    <td>
                        ${number(
                            x.battery
                        ).toFixed(2)}V
                    </td>

                    <td>
                        ${x.fan ? "ON" : "OFF"}
                    </td>

                    <td>
                        ${
                            x.gasDetected
                                ? "DANGER"
                                : "NORMAL"
                        }
                    </td>

                </tr>

                `
            ).join("")

            : `

                <tr>

                    <td colspan="9">
                        No history available
                    </td>

                </tr>

              `;

}


if ($("clearHistory"))
    $("clearHistory").onclick =
        async () => {

            if (
                !confirm(
                    "Delete all history?"
                )
            )
                return;


            try {

                await remove(
                    ref(
                        db,
                        "siloSystem/history"
                    )
                );


                showToast(
                    "History deleted"
                );

            }

            catch(error) {

                showToast(
                    error.message,
                    "error"
                );

            }

        };


// ======================================================
// OTA
// ======================================================

async function calculateSHA256(file) {

    const buffer =
        await file.arrayBuffer();


    const hashBuffer =
        await crypto.subtle.digest(
            "SHA-256",
            buffer
        );


    return Array
        .from(
            new Uint8Array(
                hashBuffer
            )
        )
        .map(
            byte =>
                byte
                    .toString(16)
                    .padStart(2,"0")
        )
        .join("");

}


function renderFirmware() {

    const f =
        state.firmware;


    const latest =
        f.latest || {};


    const command =
        f.command || {};


    const device =
        f.device || {};


    const currentVersion =
        device.firmwareVersion ||
        state.status.firmwareVersion ||
        "--";


    const currentBuild =
        device.firmwareBuild ??
        state.status.firmwareBuild ??
        "--";


    const hardware =
        device.hardwareVersion ||
        state.status.hardwareVersion ||
        "--";


    if ($("otaDeviceId"))
        $("otaDeviceId").textContent =
            device.deviceId ||
            DEVICE_ID;


    if ($("otaCurrentVersion"))
        $("otaCurrentVersion").textContent =
            currentVersion;


    if ($("otaCurrentBuild"))
        $("otaCurrentBuild").textContent =
            currentBuild;


    if ($("otaCurrentHardware"))
        $("otaCurrentHardware").textContent =
            hardware;


    if ($("otaState"))
        $("otaState").textContent =
            device.state ||
            "IDLE";


    if ($("otaProgressText"))
        $("otaProgressText").textContent =
            number(
                device.progress
            ) + "%";


    if ($("otaLatestVersion"))
        $("otaLatestVersion").textContent =
            latest.version ||
            "--";


    if ($("otaLatestBuild"))
        $("otaLatestBuild").textContent =
            latest.build ??
            "--";


    if ($("otaHash"))
        $("otaHash").textContent =
            latest.sha256 ||
            "--";


    if ($("otaTarget"))
        $("otaTarget").textContent =
            command.targetDevice ||
            "NONE";


    renderFirmwareHistory();


    const newer =
        number(
            latest.build
        ) >
        number(
            currentBuild
        );


    const blocked =
        Boolean(
            state.status.gasDetected
        ) ||
        Boolean(
            state.control.emergency
        );


    if ($("deployLatest")) {

        $("deployLatest").disabled =
            !newer ||
            blocked ||
            !latest.url;

    }


    if ($("otaBadge")) {

        $("otaBadge")
            .className =
                "system-badge " +
                (
                    blocked
                        ? "danger"
                        : newer
                            ? "warning"
                            : "safe"
                );


        $("otaBadge")
            .textContent =
                blocked
                    ? "OTA BLOCKED"
                    : newer
                        ? "UPDATE AVAILABLE"
                        : "OTA READY";

    }

}


function renderFirmwareHistory() {

    const history =
        state.firmware.history ||
        {};


    const entries =
        Object.entries(history)
        .sort(
            ([a],[b]) =>
                Number(b)-Number(a)
        )
        .slice(0,20);


    if (!$("firmwareHistory"))
        return;


    if (!entries.length) {

        $("firmwareHistory").innerHTML =
            "No firmware releases yet.";

        return;

    }


    $("firmwareHistory").innerHTML =

        entries.map(
            ([id,x]) => `

            <div class="ota-history-item">

                <b>
                    v${escapeHTML(
                        x.version
                    )}
                    · Build
                    ${escapeHTML(
                        x.build
                    )}
                </b>

                <span>
                    ${escapeHTML(
                        x.releaseNotes ||
                        "No release notes"
                    )}
                </span>

                <small>
                    ${formatTime(
                        x.publishedAt
                    )}
                </small>

            </div>

            `
        ).join("");

}


// ======================================================
// UPLOAD FIRMWARE
// ======================================================

if ($("uploadFirmware")) {

    $("uploadFirmware").onclick =
        async () => {

            if (!isAdmin()) {

                showToast(
                    "Admin access required",
                    "error"
                );

                return;

            }


            const file =
                $("firmwareFile")
                    ?.files?.[0];


            if (!file) {

                showToast(
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

                showToast(
                    "Only .bin files allowed",
                    "error"
                );

                return;

            }


            const version =
                $("firmwareVersionInput")
                    .value
                    .trim();


            const build =
                number(
                    $("firmwareBuildInput")
                        .value,
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


            if (!version) {

                showToast(
                    "Enter firmware version",
                    "error"
                );

                return;

            }


            if (!build) {

                showToast(
                    "Enter build number",
                    "error"
                );

                return;

            }


            if (!hardware) {

                showToast(
                    "Enter hardware version",
                    "error"
                );

                return;

            }


            const currentBuild =
                number(
                    state.status.firmwareBuild,
                    0
                );


            if (
                build <= currentBuild
            ) {

                showToast(
                    `Build must be greater than current build ${currentBuild}`,
                    "error"
                );

                return;

            }


            try {

                $("uploadStatus")
                    .textContent =
                    "Calculating SHA-256...";


                $("uploadProgress")
                    .style
                    .width =
                    "0%";


                const sha =
                    await calculateSHA256(
                        file
                    );


                const cleanName =
                    file.name
                        .replace(
                            /[^a-zA-Z0-9._-]/g,
                            "_"
                        );


                const path =
                    `firmware/${hardware}/build-${build}-${cleanName}`;


                const fileRef =
                    storageRef(
                        storage,
                        path
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
                                    sha

                            }

                        }

                    );


                await new Promise(
                    (resolve,reject) => {

                        uploadTask.on(

                            "state_changed",

                            snapshot => {

                                const progress =
                                    snapshot.bytesTransferred /
                                    snapshot.totalBytes *
                                    100;


                                $("uploadProgress")
                                    .style
                                    .width =
                                    progress +
                                    "%";


                                $("uploadStatus")
                                    .textContent =
                                    `Uploading ${progress.toFixed(0)}%`;

                            },

                            reject,

                            resolve

                        );

                    }
                );


                $("uploadStatus")
                    .textContent =
                    "Getting download URL...";


                const url =
                    await getDownloadURL(
                        fileRef
                    );


                const now =
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

                    sha256:
                        sha,

                    url,

                    releaseNotes:
                        notes,

                    publishedAt:
                        now

                };


                await set(

                    ref(
                        db,
                        "siloSystem/firmware/latest"
                    ),

                    release

                );


                await set(

                    ref(
                        db,
                        "siloSystem/firmware/history/" +
                        now
                    ),

                    release

                );


                $("uploadStatus")
                    .textContent =
                    "Firmware published successfully.";


                showToast(
                    `Firmware v${version} published`
                );

            }

            catch(error) {

                console.error(
                    error
                );

                $("uploadStatus")
                    .textContent =
                    "Upload failed.";

                showToast(
                    "Upload failed: " +
                    error.message,
                    "error"
                );

            }

        };

}


// ======================================================
// DEPLOY LATEST
// ======================================================

if ($("deployLatest")) {

    $("deployLatest").onclick =
        async () => {

            if (!isAdmin()) {

                showToast(
                    "Admin access required",
                    "error"
                );

                return;

            }


            const latest =
                state.firmware.latest ||
                {};


            if (!latest.url) {

                showToast(
                    "No firmware available",
                    "error"
                );

                return;

            }


            if (
                state.status.gasDetected ||
                state.control.emergency
            ) {

                showToast(
                    "OTA blocked during gas/emergency",
                    "error"
                );

                return;

            }


            if (
                !confirm(
                    `Deploy v${latest.version} build ${latest.build}?`
                )
            )
                return;


            try {

                const command = {

                    commandId:
                        "ota-" +
                        Date.now(),

                    targetDevice:
                        DEVICE_ID,

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
                        Date.now(),

                    requestedBy:
                        auth.currentUser?.email ||
                        ""

                };


                await set(

                    ref(
                        db,
                        "siloSystem/firmware/command"
                    ),

                    command

                );


                showToast(
                    "OTA command sent to ESP32"
                );

            }

            catch(error) {

                console.error(error);

                showToast(
                    "OTA command failed: " +
                    error.message,
                    "error"
                );

            }

        };

}


// ======================================================
// CLEAR OTA COMMAND
// ======================================================

if ($("clearOtaCommand")) {

    $("clearOtaCommand").onclick =
        async () => {

            if (!isAdmin()) {

                showToast(
                    "Admin access required",
                    "error"
                );

                return;

            }


            if (
                !confirm(
                    "Clear pending OTA command?"
                )
            )
                return;


            try {

                await remove(

                    ref(
                        db,
                        "siloSystem/firmware/command"
                    )

                );


                showToast(
                    "OTA command cleared"
                );

            }

            catch(error) {

                showToast(
                    error.message,
                    "error"
                );

            }

        };


// ======================================================
// CLOCK
// ======================================================

function updateClock() {

    if ($("clock")) {

        $("clock")
            .textContent =
            new Date()
                .toLocaleTimeString(
                    "en-IN"
                );

    }

}


setInterval(
    updateClock,
    1000
);

updateClock();


// ======================================================
// INITIAL DEFAULTS
// ======================================================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        renderSettings();

        renderStatus();

        renderControls();

        renderFirmware();

    }
);
