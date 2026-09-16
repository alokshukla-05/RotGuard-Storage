import {
  auth, db,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
  ref, onValue, update, remove
} from "./firebase-config.js";

const state = {
  status: {}, sensors: {}, zones: {}, control: {}, settings: {},
  diagnostics: {}, history: {}
};

const SENSOR_COUNT = 9;
const ZONES = { 1:[1,2,3], 2:[4,5,6], 3:[7,8,9] };
const OFFLINE_MS = 15000;

const $ = id => document.getElementById(id);
let liveGasChart, zoneChart, gasHistoryChart, temperatureChart, humidityChart, batteryChart;
let firebaseStarted = false;

function safeNum(v, fallback=0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function showToast(message, type="") {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.className = "toast show " + type;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.className = "toast", 2600);
}
function formatTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "--";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-IN", {
    day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit", second:"2-digit"
  });
}
function formatShortTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "--";
  return new Date(n).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("loginError").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
    showToast("Login successful");
  } catch (err) {
    console.error(err);
    $("loginError").textContent = "Login failed. Check Firebase Authentication and credentials.";
  }
});
$("logoutBtn").addEventListener("click", () => signOut(auth));

document.querySelectorAll("[data-section]").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.section));
});
function navigate(section) {
  document.querySelectorAll(".page-section").forEach(p => p.classList.remove("active-section"));
  const target = $(section);
  if (target) target.classList.add("active-section");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const nav = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (nav) nav.classList.add("active");
  $("pageTitle").textContent = ({
    dashboard:"System Dashboard", zones:"3-Zone Monitor", sensors:"Gas Sensors",
    analytics:"Analytics", control:"System Controls", history:"System History",
    settings:"System Settings", diagnostics:"Diagnostics"
  })[section] || "SILO Guard";
  window.scrollTo({top:0, behavior:"smooth"});
}

onAuthStateChanged(auth, user => {
  if (user) {
    $("loginScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    if (!firebaseStarted) startFirebase();
  } else {
    $("loginScreen").classList.remove("hidden");
    $("app").classList.add("hidden");
  }
});

function startFirebase() {
  firebaseStarted = true;

  onValue(ref(db,"siloSystem/status"), snap => {
    state.status = snap.val() || {};
    renderStatus();
    renderCuring();
    updateOnlineStatus();
    updateLiveChart();
  }, err => showToast("Status read failed: " + err.message, "error"));

  onValue(ref(db,"siloSystem/sensors"), snap => {
    state.sensors = snap.val() || {};
    renderSensors(); renderZones(); updateZoneChart();
  }, err => console.error("Sensors:", err));

  onValue(ref(db,"siloSystem/zones"), snap => {
    state.zones = snap.val() || {};
    renderZones(); updateZoneChart();
  }, err => console.error("Zones:", err));

  onValue(ref(db,"siloSystem/control"), snap => {
    state.control = snap.val() || {};
    renderControls();
  }, err => console.error("Control:", err));

  onValue(ref(db,"siloSystem/settings"), snap => {
    state.settings = snap.val() || {};
    renderSettings(); renderSensors(); renderZones();
  }, err => console.error("Settings:", err));

  onValue(ref(db,"siloSystem/diagnostics"), snap => {
    state.diagnostics = snap.val() || {};
    renderDiagnostics();
  }, err => console.error("Diagnostics:", err));

  onValue(ref(db,"siloSystem/history"), snap => {
    state.history = snap.val() || {};
    renderHistory(); updateHistoryCharts();
  }, err => console.error("History:", err));
}

function renderStatus() {
  const s = state.status;
  const threshold = safeNum(state.settings.gasThreshold,2000);
  const warning = safeNum(state.settings.warningThreshold,1500);
  const maxGas = safeNum(s.maxGasReading,0);
  $("maxGas").textContent = Math.round(maxGas);
  $("averageGas").textContent = Math.round(safeNum(s.averageGasReading,0));
  $("thresholdText").textContent = threshold;
  $("gasProgress").style.width = Math.min(maxGas/4095*100,100) + "%";

  const battery = safeNum(s.batteryPercentage,0);
  $("batteryVoltage").textContent = safeNum(s.batteryVoltage,0).toFixed(2)+"V";
  $("batteryPercentage").textContent = Math.round(battery)+"%";
  $("batteryProgress").style.width = Math.max(0,Math.min(battery,100))+"%";

  $("internalTemp").textContent = safeNum(s.temperatureInternal,0).toFixed(1)+"°C";
  $("internalHumidity").textContent = Math.round(safeNum(s.humidityInternal,0))+"%";
  $("externalTemp").textContent = safeNum(s.temperatureExternal,0).toFixed(1)+"°C";
  $("externalHumidity").textContent = Math.round(safeNum(s.humidityExternal,0))+"%";

  $("fanStatus").textContent = s.fan ? "ACTIVE" : "STANDBY";
  $("ipAddress").textContent = s.ipAddress || "--";
  $("wifiRSSI").textContent = s.wifiRSSI !== undefined ? s.wifiRSSI+" dBm" : "--";
  $("activeReason").textContent = s.activeFanReason || "STANDBY";
  $("activeZone").textContent = safeNum(s.activeRotZone,-1) < 0 ? "None" : "Zone "+s.activeRotZone;
  $("rotAngle").textContent = safeNum(s.preciseRotAngle,0).toFixed(1)+"°";
  $("vectorMagnitude").textContent = safeNum(s.vectorMagnitude,0).toFixed(0);
  $("fillStatus").textContent = s.fillStatus || "0% (EMPTY)";
  $("fanRequested").textContent = s.remoteFan ? "ON" : "OFF";
  $("lastUpdate").textContent = formatTime(s.lastUpdate);
  $("lastHeartbeatValue").textContent = formatTime(s.lastHeartbeat);

  const gas = Boolean(s.gasDetected);
  $("dangerAlert").classList.toggle("hidden", !gas && maxGas < warning);
  $("systemBadge").className = "system-badge " + (gas ? "danger" : maxGas >= warning ? "warning" : "safe");
  $("systemBadge").textContent = gas ? "GAS DETECTED" : maxGas >= warning ? "WARNING" : "SYSTEM SECURE";
  $("dangerMessage").textContent = gas
    ? `Maximum ADC ${Math.round(maxGas)}. Danger threshold ${threshold}. Local safety ventilation is active.`
    : maxGas >= warning
      ? `Gas level ${Math.round(maxGas)} is above the warning threshold ${warning}.`
      : "No gas danger condition detected.";

  $("gasState").textContent = gas ? "DANGER" : maxGas >= warning ? "WARNING" : "NORMAL";
  $("gasState").className = "pill " + (gas ? "danger" : maxGas >= warning ? "warning" : "safe");

  renderCuring();
}
function renderCuring() {
  const s = state.status;
  const active = Boolean(s.curingActive);
  const days = safeNum(s.curingDay,0);
  const progress = Math.max(0,Math.min(100,safeNum(s.curingProgress,0)));
  $("curingStatus").textContent = s.curingStatus || (active ? "CURING ACTIVE" : "CURING COMPLETE");
  $("curingDay").textContent = active ? `${days} / 14 days` : "14 / 14 days";
  $("curingProgress").style.width = progress+"%";
  $("harvestDate").textContent = s.harvestTimestamp ? formatTime(s.harvestTimestamp) : "Not set";
}

function updateOnlineStatus() {
  const hb = safeNum(state.status.lastHeartbeat,0);
  const online = hb > 0 && (Date.now()-hb) < OFFLINE_MS;
  $("connectionDot").classList.toggle("online",online);
  $("connectionDot").classList.toggle("offline",!online);
  $("connectionText").textContent = online ? "Device Online" : "Device Offline";
  $("lastSeen").textContent = online ? "Heartbeat "+formatShortTime(hb) : hb ? "Last seen "+formatTime(hb) : "Waiting for ESP32...";
  $("onlineCard").textContent = online ? "ONLINE" : "OFFLINE";
  $("onlineCard").className = "mini-state "+(online ? "online" : "offline");
}
setInterval(updateOnlineStatus,3000);

function sensorState(v) {
  const t = safeNum(state.settings.gasThreshold,2000);
  const w = safeNum(state.settings.warningThreshold,1500);
  return v >= t ? ["danger","DANGER"] : v >= w ? ["warning","WARNING"] : ["","NORMAL"];
}
function createSensorCard(i,v) {
  const [cls,label] = sensorState(v);
  const diag = state.diagnostics["mq"+i] || {};
  const healthy = diag.healthy !== false;
  return `<div class="sensor-card ${cls}">
    <div class="sensor-top"><span class="sensor-name">MQ-135 Sensor ${i}</span>
    <span class="sensor-status ${cls}">${label}</span></div>
    <div class="sensor-value">${Math.round(v)}</div>
    <div class="sensor-meta"><span>ADC 0–4095</span><span class="${healthy?'ok':'bad'}">${healthy?'● HEALTHY':'● FAULT'}</span></div>
  </div>`;
}
function renderSensors() {
  let html="";
  for(let i=1;i<=SENSOR_COUNT;i++) html += createSensorCard(i,safeNum(state.sensors["gas"+i],0));
  $("allSensors").innerHTML=html; $("sensorPreview").innerHTML=html;
}
function calculateZone(zoneNo) {
  const nums=ZONES[zoneNo];
  const vals=nums.map(n=>safeNum(state.sensors["gas"+n],0));
  const dbz=state.zones["zone"+zoneNo] || {};
  return { values:vals, max:safeNum(dbz.peak,Math.max(...vals)), average:safeNum(dbz.average,vals.reduce((a,b)=>a+b,0)/vals.length),
    danger:Boolean(dbz.danger) || vals.some(v=>v>=safeNum(state.settings.gasThreshold,2000)) };
}
function createZoneCard(z) {
  const q=calculateZone(z), cls=q.danger?"danger":q.max>=safeNum(state.settings.warningThreshold,1500)?"warning":"";
  return `<div class="zone-card ${cls}">
    <div class="zone-header"><span class="zone-name">Zone ${z}</span><span class="zone-status ${cls}">${q.danger?"DANGER":q.max>=safeNum(state.settings.warningThreshold,1500)?"WARNING":"NORMAL"}</span></div>
    <div class="zone-value">${Math.round(q.max)}</div><small>Maximum gas ADC</small>
    <div class="zone-sensors">${ZONES[z].map(n=>`<div class="zone-sensor"><small>MQ-${n}</small><strong>${Math.round(safeNum(state.sensors["gas"+n],0))}</strong></div>`).join("")}</div>
    <div class="zone-foot">Average ${Math.round(q.average)}</div>
  </div>`;
}
function renderZones() {
  let html="";
  [1,2,3].forEach(z=>html+=createZoneCard(z));
  $("zoneCards").innerHTML=html; $("zonePreview").innerHTML=html;
}

function renderControls() {
  const c=state.control, s=state.status;
  const fan=Boolean(c.fan), buz=Boolean(c.buzzer), remote=c.mode==="REMOTE";
  $("fanToggle").textContent=fan?"FAN ON":"FAN OFF";
  $("buzzerToggle").textContent=buz?"BUZZER ON":"BUZZER OFF";
  $("fanIndicator").classList.toggle("on",fan); $("buzzerIndicator").classList.toggle("on",buz);
  $("autoMode").classList.toggle("active",!remote); $("remoteMode").classList.toggle("active",remote);
  $("quickFan").querySelector("strong").textContent=fan?"ON":"OFF";
  $("quickBuzzer").querySelector("strong").textContent=buz?"ON":"OFF";
  $("controlModeText").textContent=c.mode || "AUTO";
  $("emergencyState").textContent=c.emergency ? "ACTIVE" : "CLEAR";
  $("actualFanState").textContent=s.fan ? "ON" : "OFF";
  $("activeFanReasonControl").textContent=s.activeFanReason || "STANDBY";
}

async function writeControl(patch,msg) {
  try {
    await update(ref(db,"siloSystem/control"),{...patch,commandId:Date.now()});
    showToast(msg);
  } catch(e) { console.error(e); showToast("Command failed: "+e.message,"error"); }
}
async function toggleFan() { await writeControl({fan:!Boolean(state.control.fan),mode:"REMOTE"},"Fan command sent"); }
async function toggleBuzzer() { await writeControl({buzzer:!Boolean(state.control.buzzer),mode:"REMOTE"},"Buzzer command sent"); }
async function enableAuto(){ await writeControl({mode:"AUTO"},"AUTO mode enabled"); }
async function enableRemote(){ await writeControl({mode:"REMOTE"},"REMOTE mode enabled"); }
async function emergency(){
  if(confirm("Activate emergency ventilation and alarm?"))
    await writeControl({emergency:true,fan:true,buzzer:true,mode:"REMOTE"},"EMERGENCY ACTIVATED");
}
async function resetEmergency(){
  if(confirm("Reset emergency command?"))
    await writeControl({emergency:false,fan:false,buzzer:false,mode:"AUTO"},"Emergency reset requested");
}
$("fanToggle").onclick=toggleFan; $("quickFan").onclick=toggleFan;
$("buzzerToggle").onclick=toggleBuzzer; $("quickBuzzer").onclick=toggleBuzzer;
$("autoMode").onclick=enableAuto; $("remoteMode").onclick=enableRemote;
$("emergencyBtn").onclick=emergency; $("quickEmergency").onclick=emergency; $("resetEmergency").onclick=resetEmergency;

function renderSettings(){
  $("gasThresholdInput").value=safeNum(state.settings.gasThreshold,2000);
  $("warningThresholdInput").value=safeNum(state.settings.warningThreshold,1500);
}
$("saveThreshold").onclick=async()=>{
  const v=safeNum($("gasThresholdInput").value,-1);
  if(v<0||v>4095)return showToast("Danger threshold must be 0–4095","error");
  try{await update(ref(db,"siloSystem/settings"),{gasThreshold:v});showToast("Danger threshold saved");}
  catch(e){showToast("Save failed: "+e.message,"error");}
};
$("saveWarning").onclick=async()=>{
  const v=safeNum($("warningThresholdInput").value,-1);
  if(v<0||v>4095)return showToast("Warning threshold must be 0–4095","error");
  try{await update(ref(db,"siloSystem/settings"),{warningThreshold:v});showToast("Warning threshold saved");}
  catch(e){showToast("Save failed: "+e.message,"error");}
};

function renderDiagnostics(){
  const d=state.diagnostics;
  $("diagFirebase").textContent=d.firebaseHealthy===false?"FAULT":"OK";
  $("diagWiFi").textContent=d.wifiConnected===false?"FAULT":"OK";
  $("diagDhtInt").textContent=d.dhtInternalHealthy===false?"FAULT":"OK";
  $("diagDhtExt").textContent=d.dhtExternalHealthy===false?"FAULT":"OK";
  $("diagFan").textContent=d.fanDiagnosticFault?"FAULT":"OK";
  $("diagHeartbeat").textContent=formatTime(state.status.lastHeartbeat);
  let html="";
  for(let i=1;i<=9;i++){
    const x=d["mq"+i]||{};
    html+=`<div class="diag-row"><span>MQ-135 ${i}</span><b class="${x.healthy===false?'bad':'ok'}">${x.healthy===false?'FAULT':'HEALTHY'}</b></div>`;
  }
  $("mqDiagnostics").innerHTML=html;
}

function historyEntries(){
  return Object.entries(state.history).sort(([a],[b])=>Number(b)-Number(a)).slice(0,500);
}
function renderHistory(){
  const rows=historyEntries();
  const t=safeNum(state.settings.gasThreshold,2000), w=safeNum(state.settings.warningThreshold,1500);
  $("historyCount").textContent=`${Object.keys(state.history).length} total records`;
  $("historyTable").innerHTML=rows.map(([ts,x])=>{
    const max=safeNum(x.maxGas,0), status=max>=t?"DANGER":max>=w?"WARNING":"NORMAL";
    return `<tr><td>${formatTime(ts)}</td><td>${x.activeZone>0?"Zone "+x.activeZone:"None"}</td>
      <td>${Math.round(max)}</td><td>${Math.round(safeNum(x.averageGas,0))}</td>
      <td>${safeNum(x.temperature,0).toFixed(1)}°C</td><td>${safeNum(x.humidity,0).toFixed(1)}%</td>
      <td>${safeNum(x.battery,0).toFixed(2)}V</td><td>${x.fan?"ON":"OFF"}</td>
      <td class="${status==="DANGER"?"danger-text":status==="WARNING"?"warning-text":"safe-text"}">${status}</td></tr>`;
  }).join("") || `<tr><td colspan="10">No history available</td></tr>`;
}
$("clearHistory").onclick=async()=>{
  if(!confirm("Delete ALL history records? This cannot be undone.")) return;
  try{await remove(ref(db,"siloSystem/history"));showToast("History cleared");}
  catch(e){showToast("Delete failed: "+e.message,"error");}
};

function makeChart(id,type,labels=[],datasets=[]){
  const c=$(id); if(!c||typeof Chart==="undefined")return null;
  return new Chart(c,{type,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,
    scales:{y:{beginAtZero:true}},plugins:{legend:{labels:{color:"#aeb9c7"}}}}});
}
function initCharts(){
  liveGasChart=makeChart("liveGasChart","line",[],[
    {label:"Maximum Gas",data:[],tension:.3,borderWidth:2,pointRadius:1},
    {label:"Average Gas",data:[],tension:.3,borderWidth:2,pointRadius:1}
  ]);
  zoneChart=makeChart("zoneChart","bar",["Zone 1","Zone 2","Zone 3"],[{label:"Peak Gas",data:[0,0,0],borderWidth:1}]);
  gasHistoryChart=makeChart("gasHistoryChart","line",[],[{label:"Max Gas",data:[],tension:.3,pointRadius:1}]);
  temperatureChart=makeChart("temperatureChart","line",[],[{label:"Temperature °C",data:[],tension:.3,pointRadius:1}]);
  humidityChart=makeChart("humidityChart","line",[],[{label:"Humidity %",data:[],tension:.3,pointRadius:1}]);
  batteryChart=makeChart("batteryChart","line",[],[{label:"Battery V",data:[],tension:.3,pointRadius:1}]);
}
function updateLiveChart(){
  if(!liveGasChart)return;
  const labels=liveGasChart.data.labels, a=liveGasChart.data.datasets[0].data, b=liveGasChart.data.datasets[1].data;
  labels.push(formatShortTime(state.status.lastUpdate||Date.now())); a.push(safeNum(state.status.maxGasReading,0)); b.push(safeNum(state.status.averageGasReading,0));
  while(labels.length>40){labels.shift();a.shift();b.shift();}
  liveGasChart.update("none");
}
function updateZoneChart(){
  if(!zoneChart)return;
  zoneChart.data.datasets[0].data=[1,2,3].map(z=>calculateZone(z).max);zoneChart.update("none");
}
function updateHistoryCharts(){
  const rows=historyEntries().reverse();
  const labels=rows.map(([t])=>formatShortTime(t));
  updateChart(gasHistoryChart,labels,rows.map(([,x])=>safeNum(x.maxGas,0)));
  updateChart(temperatureChart,labels,rows.map(([,x])=>safeNum(x.temperature,0)));
  updateChart(humidityChart,labels,rows.map(([,x])=>safeNum(x.humidity,0)));
  updateChart(batteryChart,labels,rows.map(([,x])=>safeNum(x.battery,0)));
}
function updateChart(ch,labels,data){if(!ch)return;ch.data.labels=labels;ch.data.datasets[0].data=data;ch.update("none");}

window.addEventListener("DOMContentLoaded",()=>initCharts());
setInterval(()=>{ $("clock").textContent=new Date().toLocaleTimeString("en-IN"); },1000);
$("clock").textContent=new Date().toLocaleTimeString("en-IN");
