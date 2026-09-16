// ======================================================
// SILO GUARD
// Firebase + Dashboard Application
// ======================================================

import {

    auth,
    db,

    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,

    ref,
    onValue,
    set,
    update,
    push,
    remove

} from "./firebase-config.js";


// ======================================================
// GLOBAL STATE
// ======================================================

const state = {

    status: {},

    sensors: {},

    control: {},

    settings: {},

    history: {}

};


// ======================================================
// CONFIGURATION
// ======================================================

const SENSOR_COUNT = 9;

const ZONES = {

    1: [1, 2, 3],

    2: [4, 5, 6],

    3: [7, 8, 9]

};


// ======================================================
// DOM HELPER
// ======================================================

const $ = id =>
    document.getElementById(id);


// ======================================================
// CHARTS
// ======================================================

let liveGasChart = null;

let zoneChart = null;

let gasHistoryChart = null;

let temperatureChart = null;

let humidityChart = null;

let batteryChart = null;


// ======================================================
// LOGIN
// ======================================================

$("loginForm").addEventListener(
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

            showToast(
                "Login successful"
            );

        }

        catch (error) {

            console.error(error);

            $("loginError").textContent =
                "Login failed. Check your email and password.";

        }

    }
);


// ======================================================
// AUTH STATE
// ======================================================

onAuthStateChanged(
    auth,
    user => {

        if (user) {

            $("loginScreen")
                .classList
                .add("hidden");

            $("app")
                .classList
                .remove("hidden");

            startFirebase();

        }

        else {

            $("loginScreen")
                .classList
                .remove("hidden");

            $("app")
                .classList
                .add("hidden");

        }

    }
);


// ======================================================
// LOGOUT
// ======================================================

$("logoutBtn").addEventListener(
    "click",
    async () => {

        await signOut(auth);

    }
);


// ======================================================
// NAVIGATION
// ======================================================

document
    .querySelectorAll("[data-section]")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                const section =
                    button.dataset.section;


                document
                    .querySelectorAll(
                        ".page-section"
                    )
                    .forEach(page => {

                        page.classList.remove(
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
                    .querySelectorAll(
                        ".nav-item"
                    )
                    .forEach(item => {

                        item.classList.remove(
                            "active"
                        );

                    });


                const nav =
                    document.querySelector(
                        `.nav-item[data-section="${section}"]`
                    );


                if (nav) {

                    nav.classList.add(
                        "active"
                    );

                }


                $("pageTitle").textContent =
                    getPageTitle(section);

            }

        );

    });


function getPageTitle(section) {

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
            "System Settings"

    };

    return titles[section] ||
        "SILO Guard";

}


// ======================================================
// FIREBASE LISTENERS
// ======================================================

function startFirebase() {


    // STATUS

    onValue(
        ref(
            db,
            "siloSystem/status"
        ),
        snapshot => {

            state.status =
                snapshot.val() || {};

            renderStatus();

        }
    );


    // SENSORS

    onValue(
        ref(
            db,
            "siloSystem/sensors"
        ),
        snapshot => {

            state.sensors =
                snapshot.val() || {};

            renderSensors();

            renderZones();

            updateZoneChart();

        }
    );


    // CONTROL

    onValue(
        ref(
            db,
            "siloSystem/control"
        ),
        snapshot => {

            state.control =
                snapshot.val() || {};

            renderControls();

        }
    );


    // SETTINGS

    onValue(
        ref(
            db,
            "siloSystem/settings"
        ),
        snapshot => {

            state.settings =
                snapshot.val() || {};

            renderSettings();

            renderSensors();

            renderZones();

        }
    );


    // HISTORY

    onValue(
        ref(
            db,
            "siloSystem/history"
        ),
        snapshot => {

            state.history =
                snapshot.val() || {};

            renderHistory();

            updateHistoryCharts();

        }
    );

}


// ======================================================
// STATUS
// ======================================================

function renderStatus() {

    const s =
        state.status;


    const threshold =
        Number(
            state.settings.gasThreshold ||
            2000
        );


    const warning =
        Number(
            state.settings.warningThreshold ||
            threshold * 0.75
        );


    const maxGas =
        Number(
            s.maxGasReading || 0
        );


    const averageGas =
        Number(
            s.averageGasReading || 0
        );


    // MAX GAS

    $("maxGas").textContent =
        maxGas;


    $("averageGas").textContent =
        Math.round(
            averageGas
        );


    $("thresholdText").textContent =
        threshold;


    $("gasProgress").style.width =
        Math.min(
            maxGas / 4095 * 100,
            100
        ) + "%";


    // BATTERY

    const battery =
        Number(
            s.batteryPercentage || 0
        );


    $("batteryVoltage").textContent =
        Number(
            s.batteryVoltage || 0
        ).toFixed(1) +
        "V";


    $("batteryPercentage").textContent =
        Math.round(
            battery
        ) + "%";


    $("batteryProgress").style.width =
        Math.min(
            battery,
            100
        ) + "%";


    // ENVIRONMENT

    $("internalTemp").textContent =
        Number(
            s.temperatureInternal || 0
        ).toFixed(1) +
        "°C";


    $("internalHumidity").textContent =
        Math.round(
            Number(
                s.humidityInternal || 0
            )
        ) + "%";


    $("externalTemp").textContent =
        Number(
            s.temperatureExternal || 0
        ).toFixed(1) +
        "°C";


    $("externalHumidity").textContent =
        Math.round(
            Number(
                s.humidityExternal || 0
            )
        ) + "%";


    // FAN

    $("fanStatus").textContent =
        s.fan ?
            "ACTIVE" :
            "STANDBY";


    // DEVICE INFO

    $("ipAddress").textContent =
        s.ipAddress ||
        "--";


    $("wifiRSSI").textContent =
        s.wifiRSSI !== undefined ?
            s.wifiRSSI + " dBm" :
            "--";


    // GAS ALERT

    const gasDetected =
        Boolean(
            s.gasDetected
        );


    if (gasDetected) {

        $("dangerAlert")
            .classList
            .remove("hidden");


        $("systemBadge")
            .className =
            "system-badge danger";


        $("systemBadge").textContent =
            "GAS DETECTED";


        $("dangerMessage").textContent =
            `Maximum reading ${maxGas}. Threshold ${threshold}. Ventilation safety response active.`;

    }

    else if (maxGas >= warning) {

        $("dangerAlert")
            .classList
            .remove("hidden");


        $("systemBadge")
            .className =
            "system-badge danger";


        $("systemBadge").textContent =
            "WARNING";


        $("dangerMessage").textContent =
            `Gas level is approaching the configured danger threshold (${threshold}).`;

    }

    else {

        $("dangerAlert")
            .classList
            .add("hidden");


        $("systemBadge")
            .className =
            "system-badge safe";


        $("systemBadge").textContent =
            "SYSTEM SECURE";

    }


    updateOnlineStatus();

    updateLiveChart();

}


// ======================================================
// ONLINE / OFFLINE
// ======================================================

function updateOnlineStatus() {

    const lastHeartbeat =
        Number(
            state.status.lastHeartbeat ||
            0
        );


    const now =
        Date.now();


    /*
       Device is considered online if
       heartbeat is less than 15 seconds old.
    */

    const online =
        lastHeartbeat > 0 &&
        now - lastHeartbeat <
        15000;


    const dot =
        $("connectionDot");


    if (online) {

        dot.classList.add(
            "online"
        );

        dot.classList.remove(
            "offline"
        );


        $("connectionText").textContent =
            "Device Online";


        $("lastSeen").textContent =
            "Heartbeat " +
            formatTime(lastHeartbeat);

    }

    else {

        dot.classList.remove(
            "online"
        );

        dot.classList.add(
            "offline"
        );


        $("connectionText").textContent =
            "Device Offline";


        if (lastHeartbeat) {

            $("lastSeen").textContent =
                "Last seen " +
                formatTime(
                    lastHeartbeat
                );

        }

        else {

            $("lastSeen").textContent =
                "Waiting for ESP32...";

        }

    }

}


// Check every 3 seconds

setInterval(
    updateOnlineStatus,
    3000
);


// ======================================================
// SENSOR STATUS
// ======================================================

function getSensorState(value) {

    const threshold =
        Number(
            state.settings.gasThreshold ||
            2000
        );


    const warning =
        Number(
            state.settings.warningThreshold ||
            threshold * 0.75
        );


    if (
        Number(value) >= threshold
    ) {

        return {
            className: "danger",
            label: "DANGER"
        };

    }


    if (
        Number(value) >= warning
    ) {

        return {
            className: "warning",
            label: "WARNING"
        };

    }


    return {
        className: "",
        label: "NORMAL"
    };

}


// ======================================================
// SENSOR CARD
// ======================================================

function createSensorCard(
    index,
    value
) {

    const sensor =
        getSensorState(value);


    return `

        <div class="
            sensor-card
            ${sensor.className}
        ">

            <div class="sensor-top">

                <span class="sensor-name">
                    MQ-135 Sensor ${index}
                </span>

                <span class="
                    sensor-status
                    ${sensor.className}
                ">

                    ${sensor.label}

                </span>

            </div>


            <div class="sensor-value">

                ${Number(value || 0)}

            </div>


            <div class="sensor-scale">

                ADC range: 0 – 4095

            </div>

        </div>

    `;

}


// ======================================================
// RENDER SENSORS
// ======================================================

function renderSensors() {

    let html = "";


    for (
        let i = 1;
        i <= SENSOR_COUNT;
        i++
    ) {

        const value =
            state.sensors[
                `gas${i}`
            ] || 0;


        html +=
            createSensorCard(
                i,
                value
            );

    }


    $("allSensors").innerHTML =
        html;


    $("sensorPreview").innerHTML =
        html;

}


// ======================================================
// ZONE CALCULATION
// ======================================================

function calculateZone(
    sensors
) {

    const values =
        sensors.map(
            number =>
                Number(
                    state.sensors[
                        `gas${number}`
                    ] || 0
                )
        );


    const max =
        Math.max(
            ...values
        );


    const average =
        values.reduce(
            (sum, value) =>
                sum + value,
            0
        ) / values.length;


    return {

        values,

        max,

        average

    };

}


// ======================================================
// ZONE CARD
// ======================================================

function createZoneCard(
    zoneNumber,
    sensorNumbers
) {

    const zone =
        calculateZone(
            sensorNumbers
        );


    const threshold =
        Number(
            state.settings.gasThreshold ||
            2000
        );


    const warning =
        Number(
            state.settings.warningThreshold ||
            threshold * .75
        );


    let status =
        "NORMAL";


    let className =
        "";


    if (
        zone.max >= threshold
    ) {

        status =
            "DANGER";

        className =
            "danger";

    }

    else if (
        zone.max >= warning
    ) {

        status =
            "WARNING";

    }


    return `

        <div class="
            zone-card
            ${className}
        ">

            <div class="zone-header">

                <span class="zone-name">

                    Zone ${zoneNumber}

                </span>

                <span class="
                    zone-status
                    ${className}
                ">

                    ${status}

                </span>

            </div>


            <div class="zone-value">

                ${Math.round(zone.max)}

            </div>


            <small
                style="color:var(--muted)"
            >

                Maximum gas reading

            </small>


            <div class="zone-sensors">

                ${sensorNumbers
                    .map(
                        number => `

                        <div class="zone-sensor">

                            <small>
                                MQ-${number}
                            </small>

                            <strong>
                                ${
                                    state.sensors[
                                        `gas${number}`
                                    ] || 0
                                }
                            </strong>

                        </div>

                    `
                    )
                    .join("")
                }

            </div>


            <div
                style="
                    margin-top:14px;
                    color:var(--muted);
                    font-size:10px;
                "
            >

                Average:
                ${Math.round(zone.average)}

            </div>

        </div>

    `;

}


// ======================================================
// RENDER ZONES
// ======================================================

function renderZones() {

    let html = "";


    Object.entries(
        ZONES
    ).forEach(
        ([zone, sensors]) => {

            html +=
                createZoneCard(
                    zone,
                    sensors
                );

        }
    );


    $("zoneCards").innerHTML =
        html;


    $("zonePreview").innerHTML =
        html;

}


// ======================================================
// CONTROL RENDER
// ======================================================

function renderControls() {

    const c =
        state.control;


    const fan =
        Boolean(c.fan);


    const buzzer =
        Boolean(c.buzzer);


    $("fanToggle").textContent =
        fan ?
            "FAN ON" :
            "FAN OFF";


    $("buzzerToggle").textContent =
        buzzer ?
            "BUZZER ON" :
            "BUZZER OFF";


    $("fanIndicator")
        .classList
        .toggle(
            "on",
            fan
        );


    $("buzzerIndicator")
        .classList
        .toggle(
            "on",
            buzzer
        );


    const remote =
        c.mode === "REMOTE";


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


    $("quickFan")
        .querySelector(
            "strong"
        )
        .textContent =
        fan ?
            "ON" :
            "OFF";


    $("quickBuzzer")
        .querySelector(
            "strong"
        )
        .textContent =
        buzzer ?
            "ON" :
            "OFF";

}


// ======================================================
// FAN CONTROL
// ======================================================

async function toggleFan() {

    const current =
        Boolean(
            state.control.fan
        );


    try {

        await update(
            ref(
                db,
                "siloSystem/control"
            ),
            {

                fan:
                    !current,

                mode:
                    "REMOTE",

                commandId:
                    Date.now()

            }
        );


        showToast(
            !current ?
                "Fan ON command sent" :
                "Fan OFF command sent"
        );

    }

    catch (error) {

        console.error(error);

        showToast(
            "Fan command failed"
        );

    }

}


$("fanToggle")
    .addEventListener(
        "click",
        toggleFan
    );


$("quickFan")
    .addEventListener(
        "click",
        toggleFan
    );


// ======================================================
// BUZZER
// ======================================================

async function toggleBuzzer() {

    const current =
        Boolean(
            state.control.buzzer
        );


    try {

        await update(
            ref(
                db,
                "siloSystem/control"
            ),
            {

                buzzer:
                    !current,

                mode:
                    "REMOTE",

                commandId:
                    Date.now()

            }
        );


        showToast(
            !current ?
                "Buzzer ON command sent" :
                "Buzzer OFF command sent"
        );

    }

    catch (error) {

        console.error(error);

        showToast(
            "Buzzer command failed"
        );

    }

}


$("buzzerToggle")
    .addEventListener(
        "click",
        toggleBuzzer
    );


$("quickBuzzer")
    .addEventListener(
        "click",
        toggleBuzzer
    );


// ======================================================
// AUTO MODE
// ======================================================

async function enableAuto() {

    await update(
        ref(
            db,
            "siloSystem/control"
        ),
        {

            mode:
                "AUTO",

            commandId:
                Date.now()

        }
    );


    showToast(
        "Automatic mode enabled"
    );

}


$("autoMode")
    .addEventListener(
        "click",
        enableAuto
    );


// ======================================================
// REMOTE MODE
// ======================================================

async function enableRemote() {

    await update(
        ref(
            db,
            "siloSystem/control"
        ),
        {

            mode:
                "REMOTE",

            commandId:
                Date.now()

        }
    );


    showToast(
        "Remote mode enabled"
    );

}


$("remoteMode")
    .addEventListener(
        "click",
        enableRemote
    );


// ======================================================
// EMERGENCY
// ======================================================

async function activateEmergency() {

    const confirmed =
        confirm(
            "Activate emergency ventilation and alarm?"
        );


    if (!confirmed)
        return;


    await update(
        ref(
            db,
            "siloSystem/control"
        ),
        {

            emergency:
                true,

            fan:
                true,

            buzzer:
                true,

            mode:
                "REMOTE",

            commandId:
                Date.now()

        }
    );


    showToast(
        "EMERGENCY ACTIVATED"
    );

}


$("emergencyBtn")
    .addEventListener(
        "click",
        activateEmergency
    );


$("quickEmergency")
    .addEventListener(
        "click",
        activateEmergency
    );


// ======================================================
// RESET EMERGENCY
// ======================================================

async function resetEmergency() {

    const confirmed =
        confirm(
            "Reset emergency command?"
        );


    if (!confirmed)
        return;


    await update(
        ref(
            db,
            "siloSystem/control"
        ),
        {

            emergency:
                false,

            fan:
                false,

            buzzer:
                false,

            mode:
                "AUTO",

            commandId:
                Date.now()

        }
    );


    showToast(
        "Emergency reset requested"
    );

}


$("resetEmergency")
    .addEventListener(
        "click",
        resetEmergency
    );


// ======================================================
// SETTINGS
// ======================================================

function renderSettings() {

    const threshold =
        Number(
            state.settings.gasThreshold ||
            2000
        );


    const warning =
        Number(
            state.settings.warningThreshold ||
            threshold * .75
        );


    $("gasThresholdInput").value =
        threshold;


    $("warningThresholdInput").value =
        warning;

}


// ======================================================
// SAVE GAS THRESHOLD
// ======================================================

$("saveThreshold")
    .addEventListener(
        "click",
        async () => {

            const value =
                Number(
                    $("gasThresholdInput").value
                );


            if (
                value < 0 ||
                value > 4095
            ) {

                showToast(
                    "Value must be 0-4095"
                );

                return;

            }


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


            showToast(
                "Gas threshold updated"
            );

        }
    );


// ======================================================
// SAVE WARNING
// ======================================================

$("saveWarning")
    .addEventListener(
        "click",
        async () => {

            const value =
                Number(
                    $("warningThresholdInput").value
                );


            if (
                value < 0 ||
                value > 4095
            ) {

                showToast(
                    "Value must be 0-4095"
                );

                return;

            }


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


            showToast(
                "Warning threshold updated"
            );

        }
    );


// ======================================================
// HISTORY
// ======================================================

function getSortedHistory() {

    return Object.entries(
        state.history
    )
    .sort(
        ([a], [b]) =>
            Number(b) -
            Number(a)
    )
    .slice(
        0,
        100
    );

}


// ======================================================
// HISTORY TABLE
// ======================================================

function renderHistory() {

    const records =
        getSortedHistory();


    let html = "";


    records.forEach(
        ([timestamp, item]) => {

            const max =
                Number(
                    item.maxGas || 0
                );


            const threshold =
                Number(
                    state.settings.gasThreshold ||
                    2000
                );


            let status =
                "NORMAL";


            let className =
                "safe-text";


            if (
                max >= threshold
            ) {

                status =
                    "DANGER";

                className =
                    "danger-text";

            }

            else if (
                max >=
                Number(
                    state.settings.warningThreshold ||
                    threshold * .75
                )
            ) {

                status =
                    "WARNING";

                className =
                    "warning-text";

            }


            html += `

                <tr>

                    <td>
                        ${formatTime(timestamp)}
                    </td>

                    <td>
                        ${item.zone || "—"}
                    </td>

                    <td>
                        ${max}
                    </td>

                    <td>
                        ${Math.round(
                            Number(
                                item.averageGas ||
                                0
                            )
                        )}
                    </td>

                    <td>
                        ${Number(
                            item.temperature ||
                            0
                        ).toFixed(1)}°C
                    </td>

                    <td>
                        ${Number(
                            item.battery ||
                            0
                        ).toFixed(1)}V
                    </td>

                    <td class="${className}">
                        ${status}
                    </td>

                </tr>

            `;

        }
    );


    $("historyTable").innerHTML =
        html ||
        `
            <tr>
                <td colspan="7">
                    No history available
                </td>
            </tr>
        `;

}


// ======================================================
// CLEAR HISTORY
// ======================================================

$("clearHistory")
    .addEventListener(
        "click",
        async () => {

            const confirmed =
                confirm(
                    "Delete all monitoring history?"
                );


            if (!confirmed)
                return;


            await remove(
                ref(
                    db,
                    "siloSystem/history"
                )
            );


            showToast(
                "History cleared"
            );

        }
    );


// ======================================================
// LIVE GAS CHART
// ======================================================

function createLiveGasChart() {

    const canvas =
        $("liveGasChart");


    if (!canvas)
        return;


    liveGasChart =
        new Chart(
            canvas,
            {

                type:
                    "line",

                data: {

                    labels: [],

                    datasets: [

                        {

                            label:
                                "Maximum Gas",

                            data: [],

                            tension:
                                .35,

                            borderWidth:
                                2,

                            pointRadius:
                                2

                        },

                        {

                            label:
                                "Average Gas",

                            data: [],

                            tension:
                                .35,

                            borderWidth:
                                2,

                            pointRadius:
                                2

                        }

                    ]

                },

                options: {

                    responsive:
                        true,

                    maintainAspectRatio:
                        false,

                    animation:
                        false,

                    scales: {

                        y: {

                            beginAtZero:
                                true,

                            max:
                                4095

                        }

                    }

                }

            }
        );

}


// ======================================================
// UPDATE LIVE CHART
// ======================================================

function updateLiveChart() {

    if (!liveGasChart)
        return;


    const now =
        new Date();


    const label =
        now.toLocaleTimeString(
            "en-IN",
            {
                hour:
                    "2-digit",

                minute:
                    "2-digit",

                second:
                    "2-digit"
            }
        );


    liveGasChart.data.labels.push(
        label
    );


    liveGasChart.data.datasets[0]
        .data
        .push(
            Number(
                state.status.maxGasReading ||
                0
            )
        );


    liveGasChart.data.datasets[1]
        .data
        .push(
            Number(
                state.status.averageGasReading ||
                0
            )
        );


    if (
        liveGasChart.data.labels.length >
        30
    ) {

        liveGasChart.data.labels.shift();

        liveGasChart.data.datasets
            .forEach(
                dataset =>
                    dataset.data.shift()
            );

    }


    liveGasChart.update(
        "none"
    );

}


// ======================================================
// ZONE CHART
// ======================================================

function createZoneChart() {

    const canvas =
        $("zoneChart");


    if (!canvas)
        return;


    zoneChart =
        new Chart(
            canvas,
            {

                type:
                    "bar",

                data: {

                    labels: [
                        "Zone 1",
                        "Zone 2",
                        "Zone 3"
                    ],

                    datasets: [

                        {

                            label:
                                "Maximum Gas",

                            data: [
                                0,
                                0,
                                0
                            ],

                            borderWidth:
                                1

                        }

                    ]

                },

                options: {

                    responsive:
                        true,

                    scales: {

                        y: {

                            beginAtZero:
                                true,

                            max:
                                4095

                        }

                    }

                }

            }
        );

}


// ======================================================
// UPDATE ZONE CHART
// ======================================================

function updateZoneChart() {

    if (!zoneChart)
        return;


    const values =
        Object.values(
            ZONES
        ).map(
            sensors =>
                calculateZone(
                    sensors
                ).max
        );


    zoneChart.data.datasets[0]
        .data =
        values;


    zoneChart.update();

}


// ======================================================
// HISTORY CHARTS
// ======================================================

function createHistoryCharts() {

    gasHistoryChart =
        createLineChart(
            "gasHistoryChart",
            "Gas",
            "Max Gas"
        );


    temperatureChart =
        createLineChart(
            "temperatureChart",
            "Temperature",
            "Temperature °C"
        );


    humidityChart =
        createLineChart(
            "humidityChart",
            "Humidity",
            "Humidity %"
        );


    batteryChart =
        createLineChart(
            "batteryChart",
            "Battery",
            "Battery V"
        );

}


// ======================================================
// GENERIC CHART
// ======================================================

function createLineChart(
    canvasId,
    title,
    datasetLabel
) {

    const canvas =
        $(canvasId);


    if (!canvas)
        return null;


    return new Chart(
        canvas,
        {

            type:
                "line",

            data: {

                labels: [],

                datasets: [

                    {

                        label:
                            datasetLabel,

                        data: [],

                        tension:
                            .3,

                        borderWidth:
                            2,

                        pointRadius:
                            1

                    }

                ]

            },

            options: {

                responsive:
                    true,

                maintainAspectRatio:
                    false,

                scales: {

                    y: {

                        beginAtZero:
                            false

                    }

                }

            }

        }
    );

}


// ======================================================
// UPDATE HISTORY CHARTS
// ======================================================

function updateHistoryCharts() {

    const records =
        getSortedHistory()
            .reverse();


    const labels =
        records.map(
            ([timestamp]) =>
                formatTime(
                    timestamp
                )
        );


    const gas =
        records.map(
            ([, item]) =>
                Number(
                    item.maxGas ||
                    0
                )
        );


    const temperature =
        records.map(
            ([, item]) =>
                Number(
                    item.temperature ||
                    0
                )
        );


    const humidity =
        records.map(
            ([, item]) =>
                Number(
                    item.humidity ||
                    0
                )
        );


    const battery =
        records.map(
            ([, item]) =>
                Number(
                    item.battery ||
                    0
                )
        );


    updateChart(
        gasHistoryChart,
        labels,
        gas
    );


    updateChart(
        temperatureChart,
        labels,
        temperature
    );


    updateChart(
        humidityChart,
        labels,
        humidity
    );


    updateChart(
        batteryChart,
        labels,
        battery
    );

}


// ======================================================
// UPDATE CHART
// ======================================================

function updateChart(
    chart,
    labels,
    data
) {

    if (!chart)
        return;


    chart.data.labels =
        labels;


    chart.data.datasets[0]
        .data =
        data;


    chart.update();

}


// ======================================================
// TIME FORMAT
// ======================================================

function formatTime(
    timestamp
) {

    const date =
        new Date(
            Number(timestamp)
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "--";

    }


    return date.toLocaleString(
        "en-IN",
        {

            day:
                "2-digit",

            month:
                "short",

            hour:
                "2-digit",

            minute:
                "2-digit",

            second:
                "2-digit"

        }
    );

}


// ======================================================
// CLOCK
// ======================================================

function updateClock() {

    $("clock").textContent =
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


// ======================================================
// TOAST
// ======================================================

let toastTimer = null;


function showToast(
    message
) {

    const element =
        $("toast");


    element.textContent =
        message;


    element.classList.add(
        "show"
    );


    clearTimeout(
        toastTimer
    );


    toastTimer =
        setTimeout(
            () => {

                element.classList.remove(
                    "show"
                );

            },
            2500
        );

}


// ======================================================
// INITIALIZE CHARTS
// ======================================================

setTimeout(
    () => {

        createLiveGasChart();

        createZoneChart();

        createHistoryCharts();

    },
    500
);
