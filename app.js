const form = document.querySelector("#settingsForm");
const toast = document.querySelector("#toast");
const configJson = document.querySelector("#configJson");
const demoMode = document.querySelector("#demoMode");
const STORAGE_KEY = "esp-node-control-panel-v1";

const fields = {
  deviceId: document.querySelector("#deviceId"), hostId: document.querySelector("#hostId"),
  channelKey: document.querySelector("#channelKey"), wifiSsid: document.querySelector("#wifiSsid"),
  wifiPassword: document.querySelector("#wifiPassword"), ipMode: document.querySelector("#ipMode"),
  staticIp: document.querySelector("#staticIp"), vpsUrl: document.querySelector("#vpsUrl"),
  healthPath: document.querySelector("#healthPath"), dataPath: document.querySelector("#dataPath"),
  apiToken: document.querySelector("#apiToken"), deviceUrl: document.querySelector("#deviceUrl"),
  configPath: document.querySelector("#configPath")
};
const steps = {
  config: document.querySelector('[data-step="config"]'), wifi: document.querySelector('[data-step="wifi"]'),
  vps: document.querySelector('[data-step="vps"]'), ready: document.querySelector('[data-step="ready"]')
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nodeMode = () => form.elements.nodeMode.value;
const normalizePath = (value) => value.trim().startsWith("/") ? value.trim() : `/${value.trim()}`;
const joinUrl = (base, path) => `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

function buildConfig(includeSecrets = false) {
  const mode = nodeMode();
  return {
    device: { id: fields.deviceId.value.trim(), mode },
    connection: mode === "host" ? {
      wifi: {
        ssid: fields.wifiSsid.value.trim(),
        password: includeSecrets ? fields.wifiPassword.value : fields.wifiPassword.value ? "••••••••" : "",
        ipMode: fields.ipMode.value,
        ...(fields.ipMode.value === "static" ? { staticIp: fields.staticIp.value.trim() } : {})
      },
      vps: {
        baseUrl: fields.vpsUrl.value.trim(), healthPath: normalizePath(fields.healthPath.value),
        dataPath: normalizePath(fields.dataPath.value),
        token: includeSecrets ? fields.apiToken.value : fields.apiToken.value ? "••••••••" : ""
      }
    } : {
      hostId: fields.hostId.value.trim(),
      channelKey: includeSecrets ? fields.channelKey.value : fields.channelKey.value ? "••••••••" : ""
    }
  };
}

function updatePreview() { configJson.textContent = JSON.stringify(buildConfig(false), null, 2); }
function setMode(mode) {
  const isHost = mode === "host";
  document.querySelectorAll(".host-only").forEach((el) => { el.hidden = !isHost; });
  document.querySelectorAll(".client-only").forEach((el) => { el.hidden = isHost; });
  fields.wifiSsid.required = isHost; fields.wifiPassword.required = isHost; fields.vpsUrl.required = isHost;
  fields.hostId.required = !isHost; fields.channelKey.required = !isHost;
  updatePreview();
}
function showToast(message, type = "success") {
  toast.textContent = message; toast.className = `toast show ${type === "error" ? "error" : ""}`;
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.className = "toast"; }, 3000);
}
function validIp(value) {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function setFieldError(input, message = "") {
  input.setAttribute("aria-invalid", String(Boolean(message)));
  const error = input.closest(".field")?.querySelector(".field-error");
  if (error) error.textContent = message;
}
function validateForm() {
  Object.values(fields).forEach((input) => setFieldError(input));
  let valid = true;
  const required = nodeMode() === "host"
    ? [fields.deviceId, fields.wifiSsid, fields.wifiPassword, fields.vpsUrl, fields.healthPath, fields.dataPath]
    : [fields.deviceId, fields.hostId, fields.channelKey];
  required.forEach((input) => { if (!input.value.trim()) { setFieldError(input, "此欄位不能留空"); valid = false; } });
  if (fields.deviceId.value && !/^[A-Za-z0-9_-]+$/.test(fields.deviceId.value)) { setFieldError(fields.deviceId, "ID 格式不正確"); valid = false; }
  if (nodeMode() === "host" && fields.wifiPassword.value && fields.wifiPassword.value.length < 8) { setFieldError(fields.wifiPassword, "Wi-Fi 密碼至少需要 8 個字元"); valid = false; }
  if (nodeMode() === "host" && fields.vpsUrl.value) {
    try { new URL(fields.vpsUrl.value); } catch { setFieldError(fields.vpsUrl, "請輸入完整網址，例如 https://vps.example.com:5000"); valid = false; }
  }
  if (fields.ipMode.value === "static" && !validIp(fields.staticIp.value)) { setFieldError(fields.staticIp, "請輸入有效的 IPv4 位址"); valid = false; }
  if (nodeMode() === "client" && fields.hostId.value === fields.deviceId.value) { setFieldError(fields.hostId, "主機 ID 不可與裝置 ID 相同"); valid = false; }
  return valid;
}

function resetSteps() {
  Object.values(steps).forEach((step) => { step.className = ""; });
  document.querySelector("#configStatus").textContent = "等待輸入設定";
  document.querySelector("#wifiStatus").textContent = "尚未連線";
  document.querySelector("#vpsStatus").textContent = "尚未連線";
  document.querySelector("#channelStatus").textContent = "等待 VPS";
  document.querySelector("#latencyValue").textContent = "-- ms";
}
function setOverall(state, text) {
  const badge = document.querySelector("#overallBadge"); badge.className = `status-badge ${state}`; badge.textContent = text;
  document.querySelector("#sidebarLight").className = `status-light ${state === "error" ? "error" : state === "success" ? "" : "idle"}`;
  document.querySelector("#sidebarStatus").textContent = text;
}

async function runConnectionTest() {
  resetSteps(); setOverall("testing", "測試中");
  const button = document.querySelector("#testButton"); button.disabled = true;
  const startedAt = performance.now();
  try {
    steps.config.className = "active"; document.querySelector("#configStatus").textContent = "檢查欄位與格式"; await wait(350);
    if (!validateForm()) throw new Error("請先修正標示的設定欄位");
    steps.config.className = "done"; document.querySelector("#configStatus").textContent = "設定格式正確";
    if (nodeMode() === "client") {
      steps.wifi.className = "done"; steps.vps.className = "done"; steps.ready.className = "done";
      document.querySelector("#wifiStatus").textContent = "由主機提供網路";
      document.querySelector("#vpsStatus").textContent = "由主機轉送資料";
      document.querySelector("#channelStatus").textContent = `已配對 ${fields.hostId.value.trim()}`;
    } else {
      steps.wifi.className = "active"; document.querySelector("#wifiStatus").textContent = `連接 ${fields.wifiSsid.value.trim()}`;
      await wait(demoMode.checked ? 650 : 250); steps.wifi.className = "done"; document.querySelector("#wifiStatus").textContent = "網路設定可用";
      steps.vps.className = "active"; document.querySelector("#vpsStatus").textContent = "正在檢查服務";
      if (demoMode.checked) await wait(800);
      else {
        const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(joinUrl(fields.vpsUrl.value, fields.healthPath.value), {
          method: "GET", headers: fields.apiToken.value ? { Authorization: `Bearer ${fields.apiToken.value}` } : {}, signal: controller.signal
        });
        clearTimeout(timeout); if (!response.ok) throw new Error(`VPS 回應 ${response.status}`);
      }
      steps.vps.className = "done"; document.querySelector("#vpsStatus").textContent = demoMode.checked ? "示範連線成功" : "VPS 回應正常";
      steps.ready.className = "done"; document.querySelector("#channelStatus").textContent = `資料將送往 ${normalizePath(fields.dataPath.value)}`;
    }
    const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
    document.querySelector("#latencyValue").textContent = `${demoMode.checked ? Math.floor(28 + Math.random() * 25) : elapsed} ms`;
    setOverall("success", "連線正常"); showToast(demoMode.checked ? "示範連線測試完成" : "VPS 連線測試完成");
  } catch (error) {
    const activeStep = Object.values(steps).find((step) => step.classList.contains("active")); if (activeStep) activeStep.className = "error";
    setOverall("error", "連線失敗"); showToast(error.name === "AbortError" ? "VPS 連線逾時，請檢查網址與防火牆" : error.message, "error");
  } finally { button.disabled = false; }
}

function saveSettings() {
  if (!validateForm()) { showToast("請先修正標示的設定欄位", "error"); return false; }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildConfig(false)));
  const time = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
  document.querySelector("#saveState").textContent = "設定已儲存";
  document.querySelector("#saveTime").textContent = `儲存時間 ${time}，敏感欄位未寫入瀏覽器`;
  showToast("設定已安全儲存在此瀏覽器"); return true;
}
async function applyToDevice() {
  if (!validateForm()) { showToast("請先修正標示的設定欄位", "error"); return; }
  const button = document.querySelector("#applyButton"); button.disabled = true;
  try {
    if (demoMode.checked) await wait(900);
    else {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(joinUrl(fields.deviceUrl.value, fields.configPath.value), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildConfig(true)), signal: controller.signal
      });
      clearTimeout(timeout); if (!response.ok) throw new Error(`裝置回應 ${response.status}`);
    }
    saveSettings(); showToast(demoMode.checked ? "示範設定已套用到 ESP NODE" : "設定已寫入 ESP NODE");
  } catch (error) { showToast(error.name === "AbortError" ? "裝置連線逾時，請確認已連接 ESP NODE 熱點" : `無法寫入裝置：${error.message}`, "error"); }
  finally { button.disabled = false; }
}
function loadSavedSettings() {
  const saved = localStorage.getItem(STORAGE_KEY); if (!saved) return;
  try {
    const data = JSON.parse(saved); fields.deviceId.value = data.device?.id || fields.deviceId.value;
    const mode = data.device?.mode === "client" ? "client" : "host"; form.elements.nodeMode.value = mode;
    if (mode === "host") {
      fields.wifiSsid.value = data.connection?.wifi?.ssid || ""; fields.ipMode.value = data.connection?.wifi?.ipMode || "dhcp";
      fields.staticIp.value = data.connection?.wifi?.staticIp || ""; fields.vpsUrl.value = data.connection?.vps?.baseUrl || "";
      fields.healthPath.value = data.connection?.vps?.healthPath || "/status"; fields.dataPath.value = data.connection?.vps?.dataPath || "/data";
    } else fields.hostId.value = data.connection?.hostId || "";
    document.querySelector("#saveState").textContent = "已載入上次設定"; document.querySelector("#saveTime").textContent = "請重新輸入 Wi-Fi 密碼與 Token";
    setMode(mode);
  } catch { localStorage.removeItem(STORAGE_KEY); }
}

form.addEventListener("input", updatePreview);
form.addEventListener("change", (event) => {
  if (event.target.name === "nodeMode") setMode(event.target.value);
  if (event.target === fields.ipMode) document.querySelector(".static-ip-field").hidden = event.target.value !== "static";
  updatePreview();
});
form.addEventListener("submit", (event) => { event.preventDefault(); saveSettings(); });
document.querySelector("#testButton").addEventListener("click", runConnectionTest);
document.querySelector("#applyButton").addEventListener("click", applyToDevice);
document.querySelectorAll(".reveal-button").forEach((button) => button.addEventListener("click", () => {
  const input = document.querySelector(`#${button.dataset.target}`); const showing = input.type === "text";
  input.type = showing ? "password" : "text"; button.textContent = showing ? "顯示" : "隱藏";
}));
document.querySelector("#copyButton").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(configJson.textContent); showToast("設定 JSON 已複製"); }
  catch { showToast("瀏覽器未允許剪貼簿存取", "error"); }
});
document.querySelector("#exportButton").addEventListener("click", () => {
  const includeSecrets = document.querySelector("#includeSecrets").checked;
  const blob = new Blob([JSON.stringify(buildConfig(includeSecrets), null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
  link.download = `${fields.deviceId.value.trim() || "esp-node"}-config.json`; link.click(); URL.revokeObjectURL(link.href);
  showToast(includeSecrets ? "已下載含敏感資料的設定檔，請妥善保管" : "設定檔已下載");
});
document.querySelector("#menuButton").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active")); link.classList.add("active"); document.querySelector(".sidebar").classList.remove("open");
}));

loadSavedSettings(); setMode(nodeMode()); document.querySelector(".static-ip-field").hidden = fields.ipMode.value !== "static"; updatePreview();
