// ══════════════════════════════════════════════════════════════════
//  VíasCúcuta — Frontend del Panel de Operador (admin.html)
//  Solo lógica de UI, mapa, tabla, filtros y modales.
//  El acceso a Firebase se delega 100% en /backend/admin-service.js
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
const STATUS_LABEL = { pending:'Pendiente', progress:'En proceso', done:'Resuelto' };
const SEVER_COLOR  = { critico:'#E05C4A', moderado:'#F0A500', leve:'#27AE60' };

/* ──────────── ESTADO ──────────── */
let allReports     = [];
let filtroSev      = 'todos';
let filtroStatus   = 'todos';
let searchTerm     = '';
let currentPage    = 1;
const PAGE_SIZE    = 10;
let currentId      = null;
let firestoreUnsub = null;
let adminMap, adminMarkersLayer;

/* ──────────── HELPERS ──────────── */
function timeAgo(ts) {
    if (!ts) return '—';
    const date = ts.toDate
        ? ts.toDate()
        : (ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts));
    if (isNaN(date.getTime())) return '—';
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60)    return 'Hace un momento';
    if (s < 3600)  return `Hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `Hace ${Math.floor(s / 3600)} h`;
    return `Hace ${Math.floor(s / 86400)} días`;
}

/* ══════════════════════════════════════════════════════════════
   AUTENTICACIÓN
══════════════════════════════════════════════════════════════ */
function showPanel(user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('panel').style.display = 'block';
    document.getElementById('nav-email').textContent = user.email;
    initAdminMap();
    startFirestore();
}

function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('panel').style.display = 'none';
    if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
}

async function doLogin() {
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-pass').value;
    const btn   = document.getElementById('login-btn');
    const err   = document.getElementById('login-error');
    if (!email || !pass) { err.textContent = 'Completa todos los campos.'; return; }
    btn.disabled = true;
    btn.textContent = '⏳ Verificando...';
    err.textContent = '';
    try {
        await login(email, pass);
    } catch (e) {
        const msgs = {
            'auth/user-not-found':     'Usuario no encontrado.',
            'auth/wrong-password':     'Contraseña incorrecta.',
            'auth/invalid-email':      'Correo inválido.',
            'auth/invalid-credential': 'Credenciales incorrectas.',
            'auth/too-many-requests':  'Demasiados intentos. Intenta más tarde.',
        };
        err.textContent = msgs[e.code] || `Error: ${e.message}`;
        btn.disabled = false;
        btn.textContent = '🔐 Ingresar al panel';
    }
}

async function doLogout() {
    await logout();
}

/* ══════════════════════════════════════════════════════════════
   FIRESTORE — sincronización en tiempo real
══════════════════════════════════════════════════════════════ */
function startFirestore() {
    firestoreUnsub = subscribeReportes(reportes => {
        const prevCount = allReports.length;
        allReports = reportes;
        if (prevCount > 0 && allReports.length > prevCount) {
            showToast('🆕', `Nuevo reporte recibido — ${allReports.length} total`);
        }
        updateStats();
        renderTable();
        renderAdminMarkers();
    }, () => {
        showToast('❌', 'Error al leer Firestore. Revisa reglas de seguridad.');
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
}

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
        const color = SEVER_COLOR[r.severity] || '#8BA5BA';
        const m = L.marker([r.lat, r.lng], { icon: makeAdminIcon(color) });
        m.bindPopup(`
            <div class="popup-name">${r.type || '—'}</div>
            <div class="popup-meta">📍 ${r.address || '—'}</div>
            <div class="popup-meta">${SEV_LABEL[r.severity] || '—'} &nbsp;·&nbsp; ${STATUS_LABEL[r.status] || '—'}</div>
            <div class="popup-meta">🕐 ${timeAgo(r.timestamp)}</div>
            <a class="popup-link" onclick="event.preventDefault();openModal('${r.id}');" href="#">Ver detalle →</a>
        `, { maxWidth: 240 });
        m.addTo(adminMarkersLayer);
    });
    document.getElementById('map-count-tag').textContent =
        count ? `${count} marcador${count !== 1 ? 'es' : ''} activo${count !== 1 ? 's' : ''}` : 'Sin coordenadas';
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
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;
    el.textContent = target;
    el.style.transform = 'scale(1.15)';
    setTimeout(() => { el.style.transform = ''; el.style.transition = 'transform .3s'; }, 200);
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
                <td class="td-type">${r.type || '—'}</td>
                <td class="td-addr" title="${r.address || ''}">${r.address || '—'}</td>
                <td><span class="badge badge-${r.severity}">${SEV_LABEL[r.severity] || r.severity}</span></td>
                <td><span class="badge badge-${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td>
                <td>${r.photos && r.photos.length
            ? `<span class="photos-count">📷 ${r.photos.length}</span>`
            : `<span style="color:var(--gray);font-size:.8rem;">—</span>`}
                </td>
                <td class="td-date">${timeAgo(r.timestamp)}</td>
                <td class="td-date">${r.reporter || 'Anónimo'}</td>
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
    dz.classList.toggle('show', r.status === 'done');
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
    try {
        await deleteReporte(currentId);
        showToast('🗑️', 'Reporte eliminado correctamente');
        closeModal();
    } catch (e) {
        console.error(e);
        showToast('❌', 'Error al eliminar. Revisa las reglas de Firestore.');
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
        showToast('❌', 'Error al actualizar. Revisa las reglas de Firestore.');
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

/* ══════════════════════════════════════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════════════════════════════════════ */
window.addEventListener('load', () => {
    // Auth listener
    onAuthChange(user => {
        if (user) showPanel(user);
        else      showLogin();
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