// ══════════════════════════════════════════════════════════════════
//  VíasCúcuta — Frontend ciudadano (index.html)
//  Solo lógica de UI, mapa, formulario y validaciones.
//  El acceso a datos se delega 100% en /backend/reportes-service.js
// ══════════════════════════════════════════════════════════════════

import {
    isFirebaseReady,
    subscribeReportes,
    createReporte
} from "../backend/reportes-service.js";

import { geocodeAddress, reverseGeocode } from "../backend/geocoding-service.js";

/* ──────────── CONSTANTES ──────────── */
const CUCUTA = [7.8939, -72.5078];
// Colores de severidad — deben coincidir con las variables --coral/--gold/--green de index.css
const SEVER_COLOR  = { critico:"#F0384F", moderado:"#FFA726", leve:"#2FD480" };
const STATUS_LABEL = { pending:"Pendiente", progress:"En proceso", done:"Resuelto" };
const STATUS_CLASS = { pending:"badge-pending", progress:"badge-progress", done:"badge-done" };
const STATUS_LABEL_DUP = { pending:'⏳ Pendiente', progress:'🔧 En proceso' };

// Validación de fotos — debe coincidir con lo configurado en el preset de Cloudinary
// (Allowed formats: jpg,png,webp). El límite de tamaño es un respaldo del lado
// del cliente para dar feedback inmediato, ya que la consola de Cloudinary no
// siempre expone un campo de "Max file size" fácil de ubicar según la versión.
const MAX_PHOTO_MB        = 5;
const MAX_PHOTO_BYTES     = MAX_PHOTO_MB * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Reportes de ejemplo para el modo demo (sin Firebase configurado).
// RPT-004 y RPT-006 incluyen timestamp/resolvedAt para que el stat de
// "Resolución promedio" también funcione con datos reales en demo.
const SAMPLE = [
    { id:"RPT-001", type:"Hueco / Bache",       address:"Av. 5 con Calle 10, Caobos",         severity:"critico",  status:"pending",  lat:7.8990,  lng:-72.5050, desc:"Hueco de ~50 cm. Riesgo para motos.",              date:"Hace 2 días" },
    { id:"RPT-002", type:"Grieta en pavimento", address:"Calle 13 #8-40, La Playa",            severity:"moderado", status:"progress", lat:7.8920,  lng:-72.5120, desc:"Grieta longitudinal de 3 m en carril derecho.",    date:"Hace 3 días" },
    { id:"RPT-003", type:"Hundimiento",         address:"Av. Libertadores Km 2",               severity:"critico",  status:"pending",  lat:7.8870,  lng:-72.4990, desc:"Hundimiento severo con acumulación de agua.",     date:"Hace 1 día"  },
    { id:"RPT-004", type:"Bordillo deteriorado",address:"Calle 7 con Av. 4, Centro",           severity:"leve",     status:"done",     lat:7.9010,  lng:-72.5080, desc:"Bordillo roto afecta andén peatonal.",            date:"Hace 1 semana",
        timestamp:  new Date(Date.now() - 9 * 24 * 3600 * 1000),
        resolvedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
    { id:"RPT-005", type:"Hueco / Bache",       address:"Barrio Atalaya, Cra 12",              severity:"moderado", status:"progress", lat:7.8960,  lng:-72.5200, desc:"Múltiples huecos en 30 m de vía.",                date:"Hace 4 días" },
    { id:"RPT-006", type:"Falta señalización",  address:"Intersección Av. 0 con Calle 9",     severity:"leve",     status:"done",     lat:7.9040,  lng:-72.5010, desc:"Señal de 'Ceda el paso' desaparecida.",           date:"Hace 2 semanas",
        timestamp:  new Date(Date.now() - 20 * 24 * 3600 * 1000),
        resolvedAt: new Date(Date.now() - 14 * 24 * 3600 * 1000) },
    { id:"RPT-007", type:"Grieta en pavimento", address:"Diagonal Santander, Sector Norte",   severity:"moderado", status:"pending",  lat:7.9070,  lng:-72.5160, desc:"Grieta transversal de 2 m, riesgo vehicular.",    date:"Hace 5 horas"},
];

/* ──────────── ESTADO ──────────── */
let allReports        = [];
let selectedSeverity  = "";
let userLat           = null;
let userLng           = null;
let map, markersLayer;
let firebaseReady     = false;

// Fotos válidas seleccionadas por el usuario (tras pasar la validación de handlePhotos)
let selectedPhotoFiles = [];

// Pin manual en el mapa
let pinMode    = false;
let userPin    = null;
let mapClickFn = null;

/* ──────────── PIN MANUAL ──────────── */
function makeUserPinIcon() {
    return L.divIcon({
        className: "",
        html: `<div class="user-pin-icon">
                 <div class="user-pin-head"></div>
                 <div class="user-pin-tail"></div>
               </div>`,
        iconSize:   [28, 36],
        iconAnchor: [14, 36],
        popupAnchor:[0, -36]
    });
}

function setUserPin(lat, lng) {
    const latlng = [lat, lng];
    if (userPin) {
        userPin.setLatLng(latlng);
    } else {
        userPin = L.marker(latlng, {
            icon: makeUserPinIcon(),
            draggable: true,
            zIndexOffset: 1000
        }).addTo(map);

        userPin.on("dragend", e => {
            const pos = e.target.getLatLng();
            userLat = pos.lat.toFixed(5);
            userLng = pos.lng.toFixed(5);
            document.getElementById("gps-coords").textContent = `${userLat}, ${userLng}`;
            updateSteps();
            updateAddressFromCoords(pos.lat, pos.lng);
        });
    }
    userLat = lat.toFixed(5);
    userLng = lng.toFixed(5);
    showGPSResult("📌");
    disablePinMode();
}

function togglePinMode() {
    if (pinMode) { disablePinMode(); return; }
    enablePinMode();
}

function enablePinMode() {
    pinMode = true;
    document.getElementById("pin-btn").classList.add("active");
    document.getElementById("pin-btn").textContent = "✕ Cancelar marcado";
    document.getElementById("pin-hint").classList.add("show");
    map.getContainer().style.cursor = "crosshair";
    document.getElementById("mapa").scrollIntoView({ behavior: "smooth" });
    mapClickFn = e => {
        setUserPin(e.latlng.lat, e.latlng.lng);
        updateAddressFromCoords(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", mapClickFn);
}

function disablePinMode() {
    pinMode = false;
    const btn = document.getElementById("pin-btn");
    btn.classList.remove("active");
    btn.textContent = "📌 Marcar en el mapa";
    document.getElementById("pin-hint").classList.remove("show");
    map.getContainer().style.cursor = "";
    if (mapClickFn) { map.off("click", mapClickFn); mapClickFn = null; }
}

function clearUserPin() {
    if (userPin) { map.removeLayer(userPin); userPin = null; }
    disablePinMode();
}

/**
 * Geocodificación inversa: cuando el usuario coloca o arrastra el pin manual,
 * actualiza el campo "Dirección aproximada" con el nombre del lugar más cercano,
 * igual que ya ocurre al elegir una sugerencia del autocompletado.
 */
async function updateAddressFromCoords(lat, lng) {
    const addressInput = document.getElementById("address");
    if (!addressInput) return;
    const previousValue = addressInput.value;

    addressInput.value = "Buscando dirección...";
    const result = await reverseGeocode(lat, lng);

    if (result) {
        suppressNextSearch = true;
        addressInput.value = result;
    } else {
        addressInput.value = previousValue;
        showToast("⚠️", "No se pudo obtener la dirección para ese punto");
    }
    updateSteps();
}

/* ──────────── INTEGRACIÓN BACKEND ──────────── */
function setupBackend() {
    if (!isFirebaseReady()) {
        document.getElementById("setup-banner").classList.add("show");
        // Modo demo: cargar reportes de ejemplo
        allReports = [...SAMPLE];
        renderMarkers();
        renderList();
        updateStats();
        return;
    }

    firebaseReady = true;
    const badge = document.getElementById("db-badge");
    badge.textContent = "🟢 Firebase en vivo";
    badge.classList.remove("offline");

    let isFirstLoad = true;
    subscribeReportes(reportes => {
        const prevCount = allReports.length;
        allReports = reportes.map(r => ({
            ...r,
            date: timeAgo(r.timestamp?.toDate?.())
        }));

        const isNew = !isFirstLoad && allReports.length > prevCount;
        if (isNew) {
            showToast("🆕", `Nuevo reporte registrado — ${allReports.length} en total`);
        }
        isFirstLoad = false;

        renderMarkers();
        renderList(isNew);
        updateStats();

        const lu     = document.getElementById("last-updated");
        const luTime = document.getElementById("last-updated-time");
        if (lu && luTime) {
            lu.style.display = "flex";
            luTime.textContent = new Date().toLocaleTimeString("es-CO", { hour:"2-digit", minute:"2-digit" });
        }
    });
}

function timeAgo(date) {
    if (!date) return "Ahora mismo";
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60)    return "Hace un momento";
    if (s < 3600)  return `Hace ${Math.floor(s/60)} min`;
    if (s < 86400) return `Hace ${Math.floor(s/3600)} h`;
    return `Hace ${Math.floor(s/86400)} días`;
}

/* ──────────── MAPA ──────────── */
function initMap() {
    map = L.map("map", { center: CUCUTA, zoom: 13 });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        maxZoom: 19
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    renderMarkers();
}

function makeIcon(color, severity) {
    const glow = severity === "critico" ? `, 0 0 0 4px ${color}33` : "";
    return L.divIcon({
        className: "",
        html: `<div style="width:18px;height:18px;background:${color};border-radius:50%;border:3px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.5)${glow};"></div>`,
        iconSize: [18,18], iconAnchor: [9,9]
    });
}

function renderMarkers() {
    if (!markersLayer) return;
    markersLayer.clearLayers();
    allReports.forEach(r => {
        if (!r.lat || !r.lng) return;
        const color = SEVER_COLOR[r.severity] || "#9C94A8";
        const m = L.marker([r.lat, r.lng], { icon: makeIcon(color, r.severity) });

        let photosHtml = "";
        if (r.photos && r.photos.length) {
            const thumbs = r.photos.map((url, i) =>
                `<img class="popup-photo" src="${url}" alt="foto ${i+1}"
                      onclick='openLightbox(${JSON.stringify(r.photos)}, ${i})' />`
            ).join("");
            photosHtml = `<div class="popup-photos">${thumbs}</div>`;
        } else {
            photosHtml = `<p class="popup-no-photo">📷 Sin fotos adjuntas</p>`;
        }

        m.bindPopup(`
            <div class="popup-title">${escHtml(r.type)}</div>
            <div class="popup-meta">📍 ${escHtml(r.address)}</div>
            <div class="popup-meta" style="margin-top:4px;">
                <span style="color:${color};font-weight:700;">${escHtml(r.severity || "—")}</span>
                &nbsp;·&nbsp; ${STATUS_LABEL[r.status] || "Pendiente"}
            </div>
            <div style="margin-top:6px;font-size:.82rem;color:#EFE6E2;line-height:1.4;">${escHtml(r.desc || "")}</div>
            <div class="popup-meta" style="margin-top:6px;">🕐 ${escHtml(r.date)} · 👤 ${escHtml(r.reporter || "Anónimo")}</div>
            ${photosHtml}
        `, { maxWidth: 300 });
        m.addTo(markersLayer);
    });
}

/* ──────────── LISTA DE REPORTES ──────────── */
function renderList(highlightFirst = false) {
    const container = document.getElementById("report-list-container");
    const recent = allReports.slice(0, 8);
    if (!recent.length) {
        container.innerHTML = '<p style="color:var(--gray);font-size:.85rem;">Sin reportes aún.</p>';
        return;
    }
    container.innerHTML = recent.map((r, i) => `
        <div class="report-item ${highlightFirst && i===0 ? 'new-report' : ''}" onclick="flyTo(${r.lat},${r.lng})">
            <div class="report-dot" style="background:${SEVER_COLOR[r.severity]||'#9C94A8'}"></div>
            <div class="report-info">
                <strong>${escHtml(r.type)}</strong>
                <span>${escHtml(r.address)} · ${escHtml(r.date)}</span>
            </div>
            <span class="report-badge ${STATUS_CLASS[r.status] || 'badge-pending'}">${STATUS_LABEL[r.status] || 'Pendiente'}</span>
        </div>
    `).join("");
}

function flyTo(lat, lng) {
    if (!lat || !lng) return;
    map.flyTo([lat, lng], 16, { duration: 1 });
    document.getElementById("mapa").scrollIntoView({ behavior: "smooth" });
}

/* ──────────── LIGHTBOX ──────────── */
let lbPhotos = [], lbIndex = 0;

function openLightbox(photos, index) {
    lbPhotos = photos;
    lbIndex = index;
    renderLightbox();
    document.getElementById("lightbox").classList.add("show");
}

function renderLightbox() {
    document.getElementById("lb-img").src = lbPhotos[lbIndex];
    document.getElementById("lb-prev").style.display = lbPhotos.length > 1 ? "flex" : "none";
    document.getElementById("lb-next").style.display = lbPhotos.length > 1 ? "flex" : "none";
    const thumbsEl = document.getElementById("lb-thumbs");
    thumbsEl.innerHTML = lbPhotos.map((url, i) =>
        `<img class="lightbox-thumb ${i===lbIndex?'active':''}" src="${url}" onclick="lbNav(${i - lbIndex})" />`
    ).join("");
}

function lbNav(delta) {
    lbIndex = (lbIndex + delta + lbPhotos.length) % lbPhotos.length;
    renderLightbox();
}

function closeLightbox(e) {
    if (e.target === document.getElementById("lightbox"))
        document.getElementById("lightbox").classList.remove("show");
}

function closeLightboxBtn() {
    document.getElementById("lightbox").classList.remove("show");
}

document.addEventListener("keydown", e => {
    const lb = document.getElementById("lightbox");
    if (e.key === "Escape") {
        if (lb.classList.contains("show")) lb.classList.remove("show");
        if (pinMode) disablePinMode();
        return;
    }
    if (!lb.classList.contains("show")) return;
    if (e.key === "ArrowRight") lbNav(1);
    if (e.key === "ArrowLeft")  lbNav(-1);
});

/* ──────────── ESTADÍSTICAS ──────────── */
function updateStats() {
    setStatNum("stat-total",   allReports.length);
    setStatNum("stat-pending", allReports.filter(r => r.status === "pending").length);
    setStatNum("stat-done",    allReports.filter(r => r.status === "done").length);
    updateAvgResolutionStat();
}

function setStatNum(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = parseInt(el.textContent) || 0;
    el.textContent = val;
    if (prev !== val) {
        el.classList.add("bump");
        setTimeout(() => el.classList.remove("bump"), 350);
    }
}

/**
 * Calcula el tiempo promedio de resolución (en horas) entre la creación
 * de un reporte (timestamp) y el momento en que un operador lo marcó
 * como resuelto (resolvedAt). Solo cuenta reportes que tienen ambos
 * datos — los que se resolvieron antes de que existiera este campo no
 * se pueden calcular retroactivamente, así que se ignoran (mejor "sin
 * datos" que un número inventado).
 * @param {object[]} reports
 * @returns {number|null} Horas promedio, o null si no hay datos suficientes
 */
function computeAvgResolutionHours(reports) {
    const toDate = v => (v && typeof v.toDate === "function") ? v.toDate() : (v ? new Date(v) : null);
    const resueltos = reports
        .map(r => ({ start: toDate(r.timestamp), end: toDate(r.resolvedAt) }))
        .filter(r => r.start && r.end && r.end.getTime() > r.start.getTime());

    if (!resueltos.length) return null;
    const totalMs = resueltos.reduce((sum, r) => sum + (r.end.getTime() - r.start.getTime()), 0);
    return totalMs / resueltos.length / 3600000;
}

/** Actualiza el stat "Resolución promedio" del hero con un valor calculado de verdad. */
function updateAvgResolutionStat() {
    const el = document.getElementById("stat-avg");
    if (!el) return;

    const avgHours = computeAvgResolutionHours(allReports);
    const html = avgHours == null
        ? "—"
        : avgHours < 48
            ? `${Math.round(avgHours)}<span>h</span>`
            : `${Math.round(avgHours / 24)}<span>d</span>`;

    if (el.innerHTML !== html) {
        el.innerHTML = html;
        el.classList.add("bump");
        setTimeout(() => el.classList.remove("bump"), 350);
    }
}

/* ──────────── FORMULARIO ──────────── */
function setSeverity(val, btn) {
    selectedSeverity = val;
    document.querySelectorAll(".severity-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    updateSteps();
}

function getGPS() {
    const btn = document.getElementById("gps-btn");
    btn.textContent = "⏳ Obteniendo ubicación...";
    btn.disabled = true;
    const onSuccess = pos => {
        userLat = pos.coords.latitude.toFixed(5);
        userLng = pos.coords.longitude.toFixed(5);
        showGPSResult();
    };
    const onError = () => {
        userLat = (7.8939 + (Math.random()-.5)*.02).toFixed(5);
        userLng = (-72.5078 + (Math.random()-.5)*.02).toFixed(5);
        showGPSResult();
        showToast("📍", "Usando ubicación de demostración en Cúcuta");
    };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(onSuccess, onError);
    else onError();
}

function showGPSResult(icon = "✅") {
    const btn = document.getElementById("gps-btn");
    btn.textContent = `${icon} Ubicación capturada`;
    btn.style.borderColor = "var(--green)";
    btn.style.color = "var(--green)";
    btn.disabled = false;
    document.getElementById("gps-coords").textContent = `${userLat}, ${userLng}`;
    document.getElementById("gps-result").classList.add("show");
    updateSteps();
}

/**
 * Valida y previsualiza las fotos seleccionadas por el usuario.
 * Solo se aceptan formatos jpg/png/webp y hasta MAX_PHOTO_MB por archivo
 * (debe coincidir con "Allowed formats" del preset de Cloudinary).
 * Las fotos que no pasan la validación se descartan y se avisa al usuario;
 * el resto queda guardado en selectedPhotoFiles, que es lo que realmente
 * se envía al backend en el submit del formulario.
 */
function handlePhotos(input) {
    const preview    = document.getElementById("photo-preview");
    const candidatos = Array.from(input.files).slice(0, 5);

    const validos    = [];
    const rechazados = [];

    candidatos.forEach(f => {
        if (!ALLOWED_PHOTO_TYPES.includes(f.type)) {
            rechazados.push(`${f.name} (formato no permitido)`);
            return;
        }
        if (f.size > MAX_PHOTO_BYTES) {
            rechazados.push(`${f.name} (supera ${MAX_PHOTO_MB} MB)`);
            return;
        }
        validos.push(f);
    });

    selectedPhotoFiles = validos;

    preview.innerHTML = "";
    validos.forEach(f => {
        const url = URL.createObjectURL(f);
        const img = document.createElement("img");
        img.src = url;
        img.className = "photo-thumb";
        preview.appendChild(img);
    });

    if (rechazados.length) {
        showToast("⚠️", `${rechazados.length} foto(s) rechazada(s): ${rechazados.join(", ")}`);
    }

    if (validos.length) updateSteps();
}

function updateSteps() {
    const type = document.getElementById("damage-type").value;
    const addr = document.getElementById("address").value;
    const s1 = type && selectedSeverity;
    const s2 = addr && userLat;
    document.getElementById("step1").className = "step " + (s1 ? "done" : "active");
    document.getElementById("step2").className = "step " + (s2 ? "done" : (s1 ? "active" : ""));
    document.getElementById("step3").className = "step " + (s2 ? "active" : "");
}

/* ──────────── SEGURIDAD ──────────── */
function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const RATE_KEY   = 'vias_last_report';
const RATE_LIMIT = 5 * 60 * 1000; // 5 minutos

function checkRateLimit() {
    const last = parseInt(localStorage.getItem(RATE_KEY) || '0');
    const now  = Date.now();
    const diff = now - last;
    if (diff < RATE_LIMIT) {
        const resta = Math.ceil((RATE_LIMIT - diff) / 60000);
        showToast('⏳', `Espera ${resta} min antes de enviar otro reporte`);
        return false;
    }
    return true;
}

function markRateLimit() {
    localStorage.setItem(RATE_KEY, Date.now().toString());
}

/* ──────────── DUPLICADOS ──────────── */
function haversineMetros(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat  = toRad(lat2 - lat1);
    const dLng  = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
        * Math.sin(dLng/2)**2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

function buscarDuplicado(lat, lng, radioMetros = 50) {
    return allReports.find(r => {
        if (!r.lat || !r.lng) return false;
        if (r.status !== 'pending' && r.status !== 'progress') return false;
        return haversineMetros(lat, lng, r.lat, r.lng) <= radioMetros;
    }) || null;
}

function mostrarDupModal(dup, distMetros) {
    document.getElementById('dup-type').textContent    = escHtml(dup.type    || '—');
    document.getElementById('dup-address').textContent = escHtml(dup.address || '—');
    document.getElementById('dup-status').textContent  = STATUS_LABEL_DUP[dup.status] || dup.status;
    document.getElementById('dup-date').textContent    = escHtml(dup.date    || 'Hace un momento');
    document.getElementById('dup-dist').textContent    = `📍 ${Math.round(distMetros)} m de distancia`;
    document.getElementById('dup-modal').dataset.lat = dup.lat;
    document.getElementById('dup-modal').dataset.lng = dup.lng;
    document.getElementById('dup-modal').classList.add('show');
}

function closeDupModal() {
    document.getElementById('dup-modal').classList.remove('show');
    const btn = document.getElementById('submit-btn');
    btn.disabled = false;
    btn.innerHTML = '📤 Enviar reporte';
}

function verDuplicadoEnMapa() {
    const el  = document.getElementById('dup-modal');
    const lat = parseFloat(el.dataset.lat);
    const lng = parseFloat(el.dataset.lng);
    closeDupModal();
    if (lat && lng) flyTo(lat, lng);
}

/* ──────────── AUTOCOMPLETADO DE DIRECCIONES ──────────── */
let addressDebounceTimer = null;
let currentSuggestions   = [];
let activeSuggestionIdx  = -1;
let suppressNextSearch   = false; // Evita re-buscar al rellenar el input

const ADDRESS_DEBOUNCE_MS = 400;

/** Maneja cada tecla escrita en el input de dirección */
function onAddressInput() {
    if (suppressNextSearch) {
        suppressNextSearch = false;
        return;
    }
    const query = document.getElementById("address").value.trim();
    clearTimeout(addressDebounceTimer);

    if (query.length < 3) {
        hideSuggestions();
        return;
    }

    showSuggestionsLoading();
    addressDebounceTimer = setTimeout(async () => {
        const results = await geocodeAddress(query, 5);
        renderSuggestions(results);
    }, ADDRESS_DEBOUNCE_MS);
}

function showSuggestionsLoading() {
    const box = document.getElementById("address-suggestions");
    box.innerHTML = `
        <div class="suggestions-header">
            <span class="label">🔍 Buscando en Cúcuta</span>
        </div>
        <div class="suggestion-loading">
            <div class="spinner"></div>
            <span>Consultando OpenStreetMap...</span>
        </div>
    `;
    box.classList.add("show");
}

function renderSuggestions(results) {
    const box = document.getElementById("address-suggestions");
    currentSuggestions  = results;
    activeSuggestionIdx = -1;

    if (!results.length) {
        box.innerHTML = `
            <div class="suggestions-header">
                <span class="label">🔍 Sin resultados</span>
            </div>
            <div class="suggestion-empty">
                <span class="icon">🤷</span>
                <span>No encontramos esa dirección en Cúcuta</span>
                <span class="hint">Prueba con otro término, o usa el GPS / pin manual</span>
            </div>
            ${suggestionsFooter()}
        `;
        box.classList.add("show");
        return;
    }

    const items = results.map((r, i) => `
        <div class="suggestion-item" data-idx="${i}">
            <div class="suggestion-icon">${r.icon}</div>
            <div class="suggestion-text">
                <span class="suggestion-main">${escHtml(r.mainName)}</span>
                <span class="suggestion-sub">${escHtml(r.subName)}</span>
            </div>
            <span class="suggestion-badge">${escHtml(r.typeLabel)}</span>
        </div>
    `).join("");

    box.innerHTML = `
        <div class="suggestions-header">
            <span class="label">📍 Sugerencias en Cúcuta</span>
            <span class="count">${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}</span>
        </div>
        <div class="suggestions-list">${items}</div>
        ${suggestionsFooter()}
    `;

    box.classList.add("show");
    box.querySelectorAll(".suggestion-item").forEach(el => {
        el.addEventListener("click", () => selectSuggestion(parseInt(el.dataset.idx)));
    });
}

function suggestionsFooter() {
    return `
        <div class="suggestions-footer">
            Datos de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
        </div>
    `;
}

function selectSuggestion(idx) {
    const s = currentSuggestions[idx];
    if (!s) return;

    suppressNextSearch = true;
    document.getElementById("address").value = s.mainName + (s.subName ? `, ${s.subName.split(",")[0]}` : "");

    // Coloca el pin dorado y captura las coordenadas
    setUserPin(s.lat, s.lng);
    flyTo(s.lat, s.lng);

    hideSuggestions();
    showToast("✅", `Ubicación encontrada: ${s.mainName}`);
}

function hideSuggestions() {
    document.getElementById("address-suggestions").classList.remove("show");
    activeSuggestionIdx = -1;
}

/** Navegación por teclado en el dropdown */
function onAddressKeydown(e) {
    const box = document.getElementById("address-suggestions");
    if (!box.classList.contains("show") || !currentSuggestions.length) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        activeSuggestionIdx = (activeSuggestionIdx + 1) % currentSuggestions.length;
        highlightActive();
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeSuggestionIdx = activeSuggestionIdx <= 0
            ? currentSuggestions.length - 1
            : activeSuggestionIdx - 1;
        highlightActive();
    } else if (e.key === "Enter" && activeSuggestionIdx >= 0) {
        e.preventDefault();
        selectSuggestion(activeSuggestionIdx);
    } else if (e.key === "Escape") {
        hideSuggestions();
    }
}

function highlightActive() {
    const items = document.querySelectorAll(".suggestions-list .suggestion-item");
    items.forEach((el, i) => el.classList.toggle("active", i === activeSuggestionIdx));
    if (activeSuggestionIdx >= 0 && items[activeSuggestionIdx]) {
        items[activeSuggestionIdx].scrollIntoView({ block: "nearest" });
    }
}

/* ──────────── MODAL & TOAST ──────────── */
function closeModal() {
    document.getElementById("modal").classList.remove("show");
    document.getElementById("mapa").scrollIntoView({ behavior: "smooth" });
}

function showToast(icon, msg) {
    document.getElementById("toast-icon").textContent = icon;
    document.getElementById("toast-msg").textContent  = msg;
    const t = document.getElementById("toast");
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3500);
}

/* ──────────── EXPONER FUNCIONES AL HTML (onclick) ──────────── */
window.setSeverity         = setSeverity;
window.getGPS              = getGPS;
window.togglePinMode       = togglePinMode;
window.handlePhotos        = handlePhotos;
window.flyTo               = flyTo;
window.openLightbox        = openLightbox;
window.lbNav               = lbNav;
window.closeLightbox       = closeLightbox;
window.closeLightboxBtn    = closeLightboxBtn;
window.closeModal          = closeModal;
window.closeDupModal       = closeDupModal;
window.verDuplicadoEnMapa  = verDuplicadoEnMapa;

/* ══════════════════════════════════════════════════════════════════
   INICIALIZACIÓN Y EVENTOS
══════════════════════════════════════════════════════════════════ */
window.addEventListener("load", () => {
    initMap();
    renderList();
    updateStats();
    setupBackend();

    // ── Listeners del formulario ──
    document.getElementById("damage-type").addEventListener("change", updateSteps);
    document.getElementById("address").addEventListener("input", () => {
        updateSteps();
        onAddressInput();
    });
    document.getElementById("address").addEventListener("keydown", onAddressKeydown);

    // Cierre del dropdown al hacer clic fuera
    document.addEventListener("click", e => {
        if (!e.target.closest(".address-wrap")) hideSuggestions();
    });

    // ── Cierre de modales por clic en fondo ──
    document.getElementById('dup-modal').addEventListener('click', e => {
        if (e.target === document.getElementById('dup-modal')) closeDupModal();
    });
    document.getElementById("modal").addEventListener("click", e => {
        if (e.target === e.currentTarget) closeModal();
    });

    // ── SUBMIT del formulario de reporte ──
    document.getElementById("report-form").addEventListener("submit", async function(e) {
        e.preventDefault();

        if (!checkRateLimit()) return;
        if (!document.getElementById("damage-type").value) { showToast("⚠️","Selecciona el tipo de daño"); return; }
        if (!selectedSeverity)  { showToast("⚠️","Selecciona la severidad"); return; }
        if (!userLat || !userLng) { showToast("📍","Captura tu ubicación GPS primero"); return; }

        // Validar duplicados
        const latNum = parseFloat(userLat);
        const lngNum = parseFloat(userLng);
        const dup = buscarDuplicado(latNum, lngNum, 50);
        if (dup) {
            const dist = haversineMetros(latNum, lngNum, dup.lat, dup.lng);
            mostrarDupModal(dup, dist);
            return;
        }

        const btn = document.getElementById("submit-btn");
        btn.disabled = true;
        btn.innerHTML = "⏳ Guardando en base de datos...";

        // Solo se envían las fotos que ya pasaron la validación de formato/tamaño en handlePhotos()
        const photoFiles = selectedPhotoFiles;

        const newReport = {
            type:     document.getElementById("damage-type").value,
            address:  document.getElementById("address").value,
            desc:     document.getElementById("description").value || "Sin descripción adicional.",
            severity: selectedSeverity,
            status:   "pending",
            lat:      parseFloat(userLat),
            lng:      parseFloat(userLng),
            date:     "Hace un momento",
            reporter: document.getElementById("reporter-name").value || "Ciudadano anónimo"
        };

        let docId;
        if (firebaseReady) {
            try {
                if (photoFiles.length) {
                    btn.innerHTML = `⏳ Subiendo ${photoFiles.length} foto(s)...`;
                }
                docId = await createReporte(newReport, photoFiles);
                document.getElementById("modal-db-note").textContent = "✅ Guardado en Firebase — todos los usuarios lo verán al instante";
            } catch (err) {
                console.error(err);
                showToast("❌", "Error al guardar en Firebase. Revisa las reglas de seguridad.");
                btn.disabled = false;
                btn.innerHTML = "📤 Enviar reporte a la base de datos";
                return;
            }
        } else {
            // Modo demo local
            docId = "LOCAL-" + Date.now();
            const localPhotos = photoFiles.map(f => URL.createObjectURL(f));
            newReport.id = docId;
            newReport.photos = localPhotos;
            allReports.unshift(newReport);
            renderMarkers();
            renderList(true);
            updateStats();
            document.getElementById("modal-db-note").textContent = "⚠️ Guardado solo en este navegador (modo demo)";
            flyTo(newReport.lat, newReport.lng);
        }

        markRateLimit();
        document.getElementById("modal-id").textContent = `ID: ${docId}`;
        document.getElementById("modal").classList.add("show");

        btn.disabled = false;
        btn.innerHTML = "📤 Enviar reporte a la base de datos";
        this.reset();
        document.querySelectorAll(".severity-btn").forEach(b => b.classList.remove("selected"));
        document.getElementById("gps-result").classList.remove("show");
        document.getElementById("gps-btn").textContent = "📍 Obtener mi ubicación actual";
        document.getElementById("gps-btn").style.cssText = "";
        document.getElementById("photo-preview").innerHTML = "";
        selectedPhotoFiles = [];
        selectedSeverity = "";
        userLat = null;
        userLng = null;
        clearUserPin();
        updateSteps();
    });

    // ── Navegación activa al hacer scroll ──
    window.addEventListener("scroll", () => {
        let current = "inicio";
        ["inicio","mapa","reporte"].forEach(id => {
            const el = document.getElementById(id);
            if (el && window.scrollY >= el.offsetTop - 120) current = id;
        });
        document.querySelectorAll(".nav-links a").forEach(a =>
            a.classList.toggle("active", a.getAttribute("href") === "#"+current)
        );
    });
});