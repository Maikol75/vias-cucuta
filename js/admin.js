// ══════════════════════════════════════════════════════════════════
//  MiVía — Frontend del Panel de Operador (admin.html)
//  Solo lógica de UI, mapa, tabla, filtros y modales.
//  El acceso a datos se delega 100% en /backend/admin-service.js
// ══════════════════════════════════════════════════════════════════

import {
    onAuthChange,
    login,
    logout,
    subscribeReportes,
    updateStatus,
    deleteReporte
} from "../backend/admin-service.js";

/* ──────────── CONSTANTES ──────────── */
const CUCUTA       = [7.8939, -72.5078];
const SEV_LABEL    = { critico:'🔴 Crítico', moderado:'🟠 Moderado', leve:'🟡 Leve' };
const STATUS_LABEL = { pending:'Pendiente', progress:'En proceso', done:'Resuelto', rejected:'Rechazado' };
// Colores de severidad — deben coincidir con las variables --coral/--gold/--green de admin.css
const SEVER_COLOR  = { critico:'#F0384F', moderado:'#FFA726', leve:'#2FD480' };
// Peso de cada severidad para la intensidad del mapa de calor
const SEV_WEIGHT   = { critico:1.0, moderado:0.6, leve:0.3 };

/* ──────────── ESTADO ──────────── */
let allReports     = [];
let filtroSev      = 'todos';
let filtroStatus   = 'todos';
let searchTerm     = '';
let currentPage    = 1;
const PAGE_SIZE    = 10;
let currentId      = null;
let reportesUnsub = null;
let adminMap, adminMarkersLayer;
let heatLayer      = null;
let heatmapMode    = false;

/* ──────────── HELPERS ──────────── */

/** Escapa texto que escribió un ciudadano antes de meterlo en el HTML */
function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function toJsDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();
    if (ts.seconds) return new Date(ts.seconds * 1000);
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
}

function timeAgo(ts) {
    const date = toJsDate(ts);
    if (!date) return '—';
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60)    return 'Hace un momento';
    if (s < 3600)  return `Hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `Hace ${Math.floor(s / 3600)} h`;
    { const d = Math.floor(s / 86400); return `Hace ${d} ${d === 1 ? 'día' : 'días'}`; }
}

/** Formatea una fecha completa (para exportaciones) en formato es-CO */
function formatFechaCompleta(ts) {
    const date = toJsDate(ts);
    if (!date) return '';
    return date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Horas transcurridas entre la creación de un reporte (timestamp) y el
 * momento en que se marcó como resuelto (resolvedAt). Devuelve null si
 * falta alguno de los dos datos (p. ej. reportes resueltos antes de que
 * existiera este campo) — nunca inventa un número.
 */
function resolutionHours(r) {
    const start = toJsDate(r.timestamp);
    const end   = toJsDate(r.resolvedAt);
    if (!start || !end) return null;
    const ms = end.getTime() - start.getTime();
    return ms > 0 ? ms / 3600000 : null;
}

/**
 * Promedio de resolutionHours() sobre toda la lista de reportes.
 * Es la misma cuenta que usa el hero público (index.html) para el stat
 * "Resolución promedio" — aquí se muestra también al operador.
 */
function computeAvgResolutionHours(reports) {
    const horas = reports.map(resolutionHours).filter(h => h != null);
    if (!horas.length) return null;
    return horas.reduce((sum, h) => sum + h, 0) / horas.length;
}

/* ══════════════════════════════════════════════════════════════
   AUTENTICACIÓN
══════════════════════════════════════════════════════════════ */
function showPanel(user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('panel').style.display = 'block';
    document.getElementById('nav-email').textContent = user.email;
    if (!adminMap) initAdminMap();
    else setTimeout(() => adminMap.invalidateSize(), 50);
    iniciarReportes();
}

function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('panel').style.display = 'none';
    if (reportesUnsub) { reportesUnsub(); reportesUnsub = null; }
}

async function doLogin() {
    const usuario = document.getElementById('login-user').value.trim();
    const pass    = document.getElementById('login-pass').value;
    const btn     = document.getElementById('login-btn');
    const err     = document.getElementById('login-error');
    if (!usuario || !pass) { err.textContent = 'Completa todos los campos.'; return; }
    btn.disabled = true;
    btn.textContent = '⏳ Verificando...';
    err.textContent = '';
    try {
        await login(usuario, pass);
        // onAuthChange abre el panel si el usuario es moderador o admin
    } catch (e) {
        err.textContent = e.message || 'No se pudo iniciar sesión.';
    } finally {
        btn.disabled = false;
        btn.textContent = '🔐 Ingresar al panel';
    }
}

async function doLogout() {
    await logout();
}

/* ══════════════════════════════════════════════════════════════
   SUPABASE — sincronización en tiempo real
══════════════════════════════════════════════════════════════ */
function iniciarReportes() {
    if (reportesUnsub) reportesUnsub();
    reportesUnsub = subscribeReportes(reportes => {
        const prevCount = allReports.length;
        allReports = reportes;
        if (prevCount > 0 && allReports.length > prevCount) {
            showToast('🆕', `Nuevo reporte recibido — ${allReports.length} total`);
        }
        updateStats();
        renderTable();
        renderAdminMarkers();
        renderHeatPoints();
    }, () => {
        showToast('❌', 'Error al leer los reportes. Revisa la conexión.');
    });
}

/* ══════════════════════════════════════════════════════════════
   MAPA ADMINISTRATIVO
══════════════════════════════════════════════════════════════ */
function initAdminMap() {
    adminMap = L.map('admin-map', { center: CUCUTA, zoom: 13 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        maxZoom: 19
    }).addTo(adminMap);
    adminMarkersLayer = L.layerGroup().addTo(adminMap);

    // Capa de mapa de calor (se activa/desactiva con toggleHeatmap, no se añade al mapa aún)
    // Progresión "seguro → peligro": verde (leve) → ámbar (moderado) → coral (marca) → carmesí (crítico) → rojo intenso (máxima densidad)
    heatLayer = L.heatLayer([], {
        radius: 26,
        blur: 22,
        maxZoom: 17,
        gradient: { 0.2: '#2FD480', 0.4: '#FFA726', 0.6: '#FF6B4A', 0.8: '#F0384F', 1.0: '#ff2b2b' }
    });
}

/* ── Pantalla completa del mapa ── */
let mapIsFullscreen = false;
function toggleMapFullscreen() {
    const section = document.getElementById('map-section');
    const btn     = document.getElementById('fullscreen-btn');
    mapIsFullscreen = !mapIsFullscreen;
    if (mapIsFullscreen) {
        section.classList.add('map-fullscreen');
        btn.textContent = '✕ Salir de pantalla completa';
        document.body.style.overflow = 'hidden';
    } else {
        section.classList.remove('map-fullscreen');
        btn.textContent = '⛶ Pantalla completa';
        document.body.style.overflow = '';
    }
    setTimeout(() => adminMap && adminMap.invalidateSize(), 310);
}
/* Tecla Escape también sale del fullscreen */
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mapIsFullscreen) toggleMapFullscreen();
});


function makeAdminIcon(color) {
    return L.divIcon({
        className: '',
        html: `<div style="
            width:16px;height:16px;background:${color};border-radius:50%;
            border:3px solid rgba(255,255,255,.9);
            box-shadow:0 2px 10px rgba(0,0,0,.6), 0 0 0 3px ${color}44;
        "></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8]
    });
}

function renderAdminMarkers() {
    if (!adminMarkersLayer) return;
    adminMarkersLayer.clearLayers();
    let count = 0;
    allReports.forEach(r => {
        if (!r.lat || !r.lng) return;
        count++;
        const color = SEVER_COLOR[r.severity] || '#9C94A8';
        const m = L.marker([r.lat, r.lng], { icon: makeAdminIcon(color) });
        m.bindPopup(`
            <div class="popup-name">${escHtml(r.type) || '—'}</div>
            <div class="popup-meta">📍 ${escHtml(r.address) || '—'}</div>
            <div class="popup-meta">${SEV_LABEL[r.severity] || '—'} &nbsp;·&nbsp; ${STATUS_LABEL[r.status] || '—'}</div>
            <div class="popup-meta">🕐 ${timeAgo(r.timestamp)}</div>
            <a class="popup-link" onclick="event.preventDefault();openModal('${r.id}');" href="#">Ver detalle →</a>
        `, { maxWidth: 240 });
        m.addTo(adminMarkersLayer);
    });
    document.getElementById('map-count-tag').textContent =
        count ? `${count} marcador${count !== 1 ? 'es' : ''} activo${count !== 1 ? 's' : ''}` : 'Sin coordenadas';
}

/**
 * Recalcula los puntos del mapa de calor a partir de allReports.
 * La intensidad de cada punto depende de la severidad del daño.
 */
function renderHeatPoints() {
    if (!heatLayer) return;
    const points = allReports
        .filter(r => r.lat && r.lng)
        .map(r => [r.lat, r.lng, SEV_WEIGHT[r.severity] || 0.5]);
    heatLayer.setLatLngs(points);
}

/** Alterna entre la vista de marcadores individuales y el mapa de calor */
function toggleHeatmap() {
    if (!adminMap || !heatLayer) return;
    heatmapMode = !heatmapMode;
    const btn = document.getElementById('heatmap-btn');
    if (heatmapMode) {
        adminMap.removeLayer(adminMarkersLayer);
        heatLayer.addTo(adminMap);
        btn.classList.add('active');
        btn.textContent = '📍 Ver marcadores';
    } else {
        adminMap.removeLayer(heatLayer);
        adminMarkersLayer.addTo(adminMap);
        btn.classList.remove('active');
        btn.textContent = '🔥 Mapa de calor';
    }
}

function flyToReport(lat, lng) {
    if (!adminMap || !lat || !lng) return;
    adminMap.flyTo([lat, lng], 16, { duration: 1.2 });
    document.getElementById('admin-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ══════════════════════════════════════════════════════════════
   ESTADÍSTICAS
══════════════════════════════════════════════════════════════ */
function updateStats() {
    animateNumber('s-total',    allReports.length);
    animateNumber('s-pending',  allReports.filter(r => r.status === 'pending').length);
    animateNumber('s-progress', allReports.filter(r => r.status === 'progress').length);
    animateNumber('s-done',     allReports.filter(r => r.status === 'done').length);
    updateAvgResolutionStat();
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;
    el.textContent = target;
    el.style.transform = 'scale(1.15)';
    setTimeout(() => { el.style.transform = ''; el.style.transition = 'transform .3s'; }, 200);
}

/** Actualiza la tarjeta "Resolución promedio" con un valor calculado de verdad. */
function updateAvgResolutionStat() {
    const el = document.getElementById('s-avg-time');
    if (!el) return;
    const avgHours = computeAvgResolutionHours(allReports);
    el.textContent = avgHours == null
        ? '—'
        : avgHours < 48
            ? `${Math.round(avgHours)}h`
            : `${Math.round(avgHours / 24)}d`;
}

/* ══════════════════════════════════════════════════════════════
   FILTROS, BÚSQUEDA Y PAGINACIÓN
══════════════════════════════════════════════════════════════ */
function getFiltered() {
    const term = searchTerm.toLowerCase();
    return allReports.filter(r => {
        const okSev    = filtroSev    === 'todos' || r.severity === filtroSev;
        const okStatus = filtroStatus === 'todos' || r.status   === filtroStatus;
        const okSearch = !term ||
            (r.type     && r.type.toLowerCase().includes(term))     ||
            (r.address  && r.address.toLowerCase().includes(term))  ||
            (r.reporter && r.reporter.toLowerCase().includes(term)) ||
            (r.desc     && r.desc.toLowerCase().includes(term));
        return okSev && okStatus && okSearch;
    });
}

function onSearch() {
    searchTerm  = document.getElementById('search-input').value.trim();
    currentPage = 1;
    renderTable();
}

function changePage(delta) {
    const maxPage = Math.ceil(getFiltered().length / PAGE_SIZE) || 1;
    currentPage = Math.max(1, Math.min(currentPage + delta, maxPage));
    renderTable();
}

/* ══════════════════════════════════════════════════════════════
   TABLA
══════════════════════════════════════════════════════════════ */
function renderTable() {
    const filtered = getFiltered();
    const maxPage  = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    if (currentPage > maxPage) currentPage = maxPage;
    const start = (currentPage - 1) * PAGE_SIZE;
    const page  = filtered.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById('tabla-body');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">No hay reportes con estos filtros.</td></tr>';
    } else {
        tbody.innerHTML = page.map(r => `
            <tr onclick="openModal('${r.id}')">
                <td class="td-type">${escHtml(r.type) || '—'}</td>
                <td class="td-addr" title="${escHtml(r.address)}">${escHtml(r.address) || '—'}</td>
                <td><span class="badge badge-${r.severity}">${SEV_LABEL[r.severity] || r.severity}</span></td>
                <td><span class="badge badge-${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td>
                <td>${r.photos && r.photos.length
            ? `<span class="photos-count">📷 ${r.photos.length}</span>`
            : `<span style="color:var(--gray);font-size:.8rem;">—</span>`}
                </td>
                <td class="td-date">${timeAgo(r.timestamp)}</td>
                <td class="td-date">${escHtml(r.reporter) || 'Anónimo'}</td>
            </tr>
        `).join('');
    }

    const total = filtered.length;
    const from  = total ? start + 1 : 0;
    const to    = Math.min(start + PAGE_SIZE, total);
    document.getElementById('page-info').textContent = total
        ? `Mostrando ${from}–${to} de ${total} reportes`
        : '0 reportes encontrados';
    document.getElementById('page-current').textContent = `${currentPage} / ${maxPage}`;
    document.getElementById('btn-prev').disabled = currentPage <= 1;
    document.getElementById('btn-next').disabled = currentPage >= maxPage;
}

/* ══════════════════════════════════════════════════════════════
   EXPORTACIÓN A CSV
══════════════════════════════════════════════════════════════ */

/** Envuelve un valor en comillas dobles y escapa comillas internas (RFC 4180) */
function csvField(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
}

/**
 * Exporta a un archivo .csv los reportes que cumplen los filtros
 * y la búsqueda activos en ese momento (mismo criterio que la tabla).
 * Incluye fecha de resolución y horas de resolución cuando el reporte
 * las tiene (ver resolutionHours) — útil para armar reportes de gestión.
 * Usa ";" como delimitador para abrir bien en Excel con configuración regional es-CO,
 * y añade BOM UTF-8 para que las tildes y "ñ" se vean correctamente.
 */
function exportCSV() {
    const filtered = getFiltered();
    if (!filtered.length) {
        showToast('⚠️', 'No hay reportes para exportar con estos filtros');
        return;
    }

    const headers = [
        'ID', 'Tipo de daño', 'Dirección', 'Severidad', 'Estado',
        'Descripción', 'Reportado por', 'Latitud', 'Longitud',
        'Fecha del reporte', 'Fecha de resolución', 'Tiempo de resolución (h)',
        'Cantidad de fotos', 'URLs de fotos'
    ];

    const rows = filtered.map(r => {
        const horas = resolutionHours(r);
        return [
            r.id || '',
            r.type || '',
            r.address || '',
            SEV_LABEL[r.severity] || r.severity || '',
            STATUS_LABEL[r.status] || r.status || '',
            r.desc || '',
            r.reporter || 'Ciudadano anónimo',
            r.lat != null ? Number(r.lat).toFixed(5) : '',
            r.lng != null ? Number(r.lng).toFixed(5) : '',
            formatFechaCompleta(r.timestamp),
            r.resolvedAt ? formatFechaCompleta(r.resolvedAt) : '',
            horas != null ? horas.toFixed(1) : '',
            r.photos ? r.photos.length : 0,
            r.photos ? r.photos.join(' | ') : ''
        ];
    });

    const DELIM = ';';
    const csvLines  = [headers, ...rows].map(row => row.map(csvField).join(DELIM));
    const csvContent = '﻿' + csvLines.join('\r\n'); // BOM para acentos correctos en Excel

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const fecha = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `mivia-reportes-${fecha}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('⬇️', `${filtered.length} reporte(s) exportado(s) a CSV`);
}

/* ══════════════════════════════════════════════════════════════
   MODAL DETALLE
══════════════════════════════════════════════════════════════ */
function openModal(id) {
    const r = allReports.find(x => x.id === id);
    if (!r) return;
    currentId = id;

    document.getElementById('m-title').textContent    = r.type    || '—';
    document.getElementById('m-addr').textContent     = r.address || '—';
    document.getElementById('m-desc').textContent     = r.desc    || 'Sin descripción.';
    document.getElementById('m-reporter').textContent = r.reporter || 'Ciudadano anónimo';
    document.getElementById('m-date').textContent     = timeAgo(r.timestamp);

    const lat = r.lat ? Number(r.lat).toFixed(5) : null;
    const lng = r.lng ? Number(r.lng).toFixed(5) : null;
    document.getElementById('m-coords').textContent = lat && lng ? `${lat}, ${lng}` : '—';

    const gmaps = document.getElementById('m-gmaps');
    if (lat && lng) {
        gmaps.href = `https://www.google.com/maps?q=${lat},${lng}`;
        gmaps.style.display = 'inline-flex';
    } else {
        gmaps.style.display = 'none';
    }

    document.getElementById('m-badges').innerHTML =
        `<span class="badge badge-${r.severity}">${SEV_LABEL[r.severity] || r.severity}</span>
         <span class="badge badge-${r.status}">${STATUS_LABEL[r.status] || r.status}</span>`;

    const photosSection = document.getElementById('m-photos-section');
    const photosGrid    = document.getElementById('m-photos');
    if (r.photos && r.photos.length) {
        photosSection.style.display = 'block';
        photosGrid.innerHTML = r.photos.map(url =>
            `<img src="${url}" alt="foto" onclick="openLightbox('${url}')" />`
        ).join('');
    } else {
        photosSection.style.display = 'none';
    }

    ['pending', 'progress', 'done'].forEach(s => {
        document.getElementById('btn-' + s).classList.toggle('current', r.status === s);
    });

    const dz = document.getElementById('delete-zone');
    dz.classList.toggle('show', r.status === 'done' || r.status === 'rejected');
    cancelDelete();

    if (r.lat && r.lng) flyToReport(r.lat, r.lng);

    document.getElementById('modal').classList.add('show');
}

function closeModal() {
    document.getElementById('modal').classList.remove('show');
    currentId = null;
}

/* ══════════════════════════════════════════════════════════════
   ELIMINACIÓN DE REPORTES
══════════════════════════════════════════════════════════════ */
function promptDelete() {
    document.getElementById('confirm-zone').classList.add('show');
}

function cancelDelete() {
    document.getElementById('confirm-zone').classList.remove('show');
}

async function confirmDelete() {
    if (!currentId) return;
    const r = allReports.find(x => x.id === currentId);
    try {
        await deleteReporte(currentId, r?.photoPaths || []);
        showToast('🗑️', 'Reporte eliminado correctamente');
        closeModal();
    } catch (e) {
        console.error(e);
        showToast('❌', e.message || 'Error al eliminar el reporte.');
        cancelDelete();
    }
}

/* ══════════════════════════════════════════════════════════════
   CAMBIO DE ESTADO
══════════════════════════════════════════════════════════════ */
async function setStatus(newStatus) {
    if (!currentId) return;
    try {
        await updateStatus(currentId, newStatus);
        showToast('✅', `Estado cambiado a "${STATUS_LABEL[newStatus]}"`);
        closeModal();
    } catch (e) {
        console.error(e);
        showToast('❌', e.message || 'Error al actualizar el estado.');
    }
}

/* ══════════════════════════════════════════════════════════════
   LIGHTBOX
══════════════════════════════════════════════════════════════ */
function openLightbox(url) {
    document.getElementById('lb-img').src = url;
    document.getElementById('lightbox').classList.add('show');
}

function closeLightbox() {
    document.getElementById('lightbox').classList.remove('show');
}

/* ══════════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════════ */
function showToast(icon, msg) {
    document.getElementById('toast-icon').textContent = icon;
    document.getElementById('toast-msg').textContent  = msg;
    const t = document.getElementById('toast');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
}

/* ──────────── EXPONER FUNCIONES AL HTML (onclick) ──────────── */
window.doLogin        = doLogin;
window.doLogout       = doLogout;
window.openModal      = openModal;
window.closeModal     = closeModal;
window.setStatus      = setStatus;
window.promptDelete   = promptDelete;
window.cancelDelete   = cancelDelete;
window.confirmDelete  = confirmDelete;
window.openLightbox   = openLightbox;
window.closeLightbox  = closeLightbox;
window.changePage     = changePage;
window.onSearch       = onSearch;
window.toggleMapFullscreen = toggleMapFullscreen;
window.toggleHeatmap  = toggleHeatmap;
window.exportCSV      = exportCSV;

/* ══════════════════════════════════════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════════════════════════════════════ */
window.addEventListener('load', () => {
    // Auth listener
    onAuthChange(user => {
        if (user) showPanel(user);
        else      showLogin();
    }, mensaje => {
        showLogin();
        document.getElementById('login-error').textContent = mensaje;
    });

    // Filtros por severidad
    document.querySelectorAll('[data-sev]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-sev]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filtroSev = btn.dataset.sev;
            currentPage = 1;
            renderTable();
        });
    });

    // Filtros por estado
    document.querySelectorAll('[data-status]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filtroStatus = btn.dataset.status;
            currentPage = 1;
            renderTable();
        });
    });

    // Cierre del modal por clic en fondo
    document.getElementById('modal').addEventListener('click', e => {
        if (e.target === document.getElementById('modal')) closeModal();
    });

    // Atajos de teclado
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeModal(); closeLightbox(); }
        if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') {
            doLogin();
        }
    });
});