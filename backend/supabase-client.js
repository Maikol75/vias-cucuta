// ══════════════════════════════════════════════════════════════════
//  MiVía — Cliente único de Supabase + conversión de datos
//  Traduce las filas de la base de datos al formato que ya usaba
//  el frontend (type, address, desc, severity, status, photos...),
//  para que js/index.js y js/admin.js casi no tengan que cambiar.
// ══════════════════════════════════════════════════════════════════

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET_FOTOS } from "./supabase-config.js";

const configurado =
    SUPABASE_URL.startsWith("https://") && !SUPABASE_ANON_KEY.includes("PEGA_");

export const supabase = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export function isSupabaseReady() {
    return supabase !== null;
}

// ─── Equivalencias base de datos ⇄ web ─────────────────────────────

// Severidad: la BD usa baja/media/alta; la web muestra leve/moderado/critico
export const SEV_DB_A_WEB = { baja: "leve", media: "moderado", alta: "critico" };
export const SEV_WEB_A_DB = { leve: "baja", moderado: "media", critico: "alta" };

// Estado: la BD tiene 5 estados; la web agrupa en 3 (+ rechazado)
export const ESTADO_DB_A_WEB = {
    pendiente:     "pending",
    en_revision:   "progress",
    en_reparacion: "progress",
    reparado:      "done",
    rechazado:     "rejected"
};
export const ESTADO_WEB_A_DB = {
    pending:  "pendiente",
    progress: "en_reparacion",
    done:     "reparado",
    rejected: "rechazado"
};

// Columnas que se piden de cada reporte (con su categoría y fotos)
export const COLUMNAS_REPORTE =
    "id, ciudad_id, categoria_id, descripcion, severidad, lat, lng, direccion, " +
    "estado, reportero_nombre, created_at, resuelto_en, " +
    "categorias(nombre), reporte_fotos(ruta)";

export function urlFoto(ruta) {
    return supabase.storage.from(BUCKET_FOTOS).getPublicUrl(ruta).data.publicUrl;
}

/** Convierte una fila de `reportes` al objeto que usa el frontend. */
export function filaAReporte(f) {
    const fotos = (f.reporte_fotos || []).map(x => x.ruta);
    return {
        id:          String(f.id),
        categoriaId: f.categoria_id,
        ciudadId:    f.ciudad_id,
        type:        f.categorias?.nombre || "Sin categoría",
        address:     f.direccion || "Sin dirección",
        desc:        f.descripcion,
        severity:    SEV_DB_A_WEB[f.severidad] || "moderado",
        status:      ESTADO_DB_A_WEB[f.estado] || "pending",
        estadoDb:    f.estado,
        lat:         Number(f.lat),
        lng:         Number(f.lng),
        reporter:    f.reportero_nombre || "Ciudadano anónimo",
        timestamp:   f.created_at ? new Date(f.created_at) : null,
        resolvedAt:  f.resuelto_en ? new Date(f.resuelto_en) : null,
        photoPaths:  fotos,
        photos:      fotos.map(urlFoto)
    };
}

/** Trae todos los reportes, del más nuevo al más viejo. */
export async function fetchReportes() {
    const { data, error } = await supabase
        .from("reportes")
        .select(COLUMNAS_REPORTE)
        .order("created_at", { ascending: false })
        .limit(1000);
    if (error) throw error;
    return data.map(filaAReporte);
}

// Funciones de recarga de cada suscripción activa
const recargas = new Set();

/**
 * Recarga ya mismo la lista en todas las suscripciones de esta página.
 * Se usa después de crear, cambiar o eliminar un reporte, para no
 * depender de que llegue el aviso de tiempo real.
 */
export function recargarReportes() {
    recargas.forEach(fn => fn());
}

/**
 * Escucha cambios en tiempo real y entrega la lista completa cada vez.
 * Si el tiempo real no está activo, igual se recarga cada 60 s.
 * @returns {() => void} función para dejar de escuchar
 */
export function escucharReportes(onUpdate, onError) {
    if (!supabase) return () => {};

    let activo = true;
    let espera = null;

    const cargar = async () => {
        try {
            const lista = await fetchReportes();
            if (activo) onUpdate(lista);
        } catch (e) {
            console.error("Error leyendo reportes:", e);
            if (activo && onError) onError(e);
        }
    };
    const programar = () => { clearTimeout(espera); espera = setTimeout(cargar, 400); };

    recargas.add(programar);
    cargar();

    const canal = supabase
        .channel("reportes-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: "reportes" }, programar)
        .on("postgres_changes", { event: "*", schema: "public", table: "reporte_fotos" }, programar)
        .subscribe();

    const respaldo = setInterval(cargar, 60000);

    return () => {
        activo = false;
        recargas.delete(programar);
        clearTimeout(espera);
        clearInterval(respaldo);
        supabase.removeChannel(canal);
    };
}
