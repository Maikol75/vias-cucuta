// ══════════════════════════════════════════════════════════════════
//  MiVía — Servicio de Reportes (vista ciudadana)
//  Capa de acceso a datos: Supabase (base de datos + fotos en Storage)
//  Expone las mismas funciones que la versión con Firebase.
// ══════════════════════════════════════════════════════════════════

import {
    supabase,
    isSupabaseReady,
    escucharReportes,
    recargarReportes,
    SEV_WEB_A_DB
} from "./supabase-client.js";
import { BUCKET_FOTOS, FOTO_LADO_MAX_PX, FOTO_CALIDAD_JPEG } from "./supabase-config.js";

export { isSupabaseReady };

/**
 * Suscribe un listener en tiempo real a los reportes.
 * @param {(reportes: object[]) => void} onUpdate
 * @param {(error: Error) => void}      [onError]
 * @returns {() => void} Función para cancelar la suscripción
 */
export function subscribeReportes(onUpdate, onError) {
    return escucharReportes(onUpdate, onError);
}

/** Categorías de daño activas (las mismas que ve la app). */
export async function getCategorias() {
    const { data, error } = await supabase
        .from("categorias")
        .select("id, nombre, icono")
        .eq("activa", true)
        .order("id");
    if (error) throw error;
    return data;
}

// ─── Ciudades (para asignar cada reporte a la más cercana) ─────────
let ciudadesCache = null;

async function getCiudades() {
    if (ciudadesCache) return ciudadesCache;
    const { data, error } = await supabase
        .from("ciudades")
        .select("id, nombre, lat_centro, lng_centro")
        .eq("activa", true);
    if (error) throw error;
    if (!data.length) throw new Error("No hay ciudades activas en la base de datos.");
    ciudadesCache = data;
    return data;
}

function distanciaKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const rad = x => x * Math.PI / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

async function ciudadMasCercana(lat, lng) {
    const ciudades = await getCiudades();
    return ciudades.reduce((mejor, c) =>
        distanciaKm(lat, lng, c.lat_centro, c.lng_centro) <
        distanciaKm(lat, lng, mejor.lat_centro, mejor.lng_centro) ? c : mejor
    );
}

// ─── Fotos ─────────────────────────────────────────────────────────

/**
 * Reduce la foto en el navegador (máx. 1280 px, JPEG) para no pasar
 * del límite de 2 MB del bucket y ahorrar el almacenamiento gratuito.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
async function comprimirFoto(file) {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, FOTO_LADO_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return new Promise((resolve, reject) =>
        canvas.toBlob(
            b => b ? resolve(b) : reject(new Error("No se pudo procesar la foto")),
            "image/jpeg",
            FOTO_CALIDAD_JPEG
        )
    );
}

/**
 * Sube las fotos de un reporte a Supabase Storage y las enlaza al reporte.
 * @param {number} reporteId
 * @param {string} carpeta   uid del usuario, o "anonimo"
 * @param {File[]} files
 * @returns {Promise<number>} cuántas fotos se subieron
 */
export async function uploadPhotos(reporteId, carpeta, files) {
    if (!files?.length) return 0;
    const rutas = [];
    for (let i = 0; i < files.length; i++) {
        try {
            const blob = await comprimirFoto(files[i]);
            const ruta = `${carpeta}/${reporteId}/${i + 1}.jpg`;
            const { error } = await supabase.storage
                .from(BUCKET_FOTOS)
                .upload(ruta, blob, { contentType: "image/jpeg", upsert: false });
            if (error) throw error;
            rutas.push(ruta);
        } catch (e) {
            console.error(`No se pudo subir la foto ${i + 1}:`, e);
        }
    }
    if (rutas.length) {
        const { error } = await supabase
            .from("reporte_fotos")
            .insert(rutas.map(ruta => ({ reporte_id: reporteId, ruta })));
        if (error) throw error;
    }
    return rutas.length;
}

// ─── Crear reporte ─────────────────────────────────────────────────

/**
 * Crea un nuevo reporte. Funciona con o sin sesión iniciada:
 * sin sesión queda como reporte anónimo con el nombre que escribió la persona.
 *
 * @param {object} report  { categoriaId, type, address, desc, severity, lat, lng, reporter }
 * @param {File[]} photoFiles
 * @returns {Promise<{id: string, fotosSubidas: number}>}
 */
export async function createReporte(report, photoFiles = []) {
    if (!supabase) throw new Error("Supabase no está configurado");

    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;

    const ciudad = await ciudadMasCercana(report.lat, report.lng);

    // La BD exige una descripción de 10 a 1000 caracteres
    let descripcion = (report.desc || "").trim();
    if (descripcion.length < 10) {
        descripcion = `${report.type}: ${descripcion || "sin descripción adicional"}`;
    }
    descripcion = descripcion.slice(0, 1000);

    const { data, error } = await supabase
        .from("reportes")
        .insert({
            usuario_id:       uid,
            ciudad_id:        ciudad.id,
            categoria_id:     report.categoriaId,
            descripcion,
            severidad:        SEV_WEB_A_DB[report.severity] || "media",
            lat:              report.lat,
            lng:              report.lng,
            direccion:        report.address || null,
            reportero_nombre: report.reporter || null
        })
        .select("id")
        .single();
    if (error) throw error;

    const fotosSubidas = await uploadPhotos(data.id, uid ?? "anonimo", photoFiles);
    recargarReportes();
    return { id: String(data.id), fotosSubidas };
}
