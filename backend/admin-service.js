// ══════════════════════════════════════════════════════════════════
//  MiVía — Servicio del Panel de Operador
//  Autenticación (usuario + contraseña, como la app) y
//  lectura / cambio de estado / eliminación de reportes.
// ══════════════════════════════════════════════════════════════════

import {
    supabase,
    isSupabaseReady,
    escucharReportes,
    recargarReportes,
    ESTADO_WEB_A_DB
} from "./supabase-client.js";
import { DOMINIO_INTERNO, BUCKET_FOTOS } from "./supabase-config.js";

export { isSupabaseReady };

// ════════════════ AUTH ════════════════════════════════════════════

function correoInterno(usuario) {
    return `${usuario.trim().toLowerCase()}@${DOMINIO_INTERNO}`;
}

/** Perfil del usuario con sesión, o null. */
async function miPerfil(userId) {
    const { data, error } = await supabase
        .from("perfiles")
        .select("id, usuario, nombre, rol")
        .eq("id", userId)
        .single();
    if (error) return null;
    return data;
}

const esOperador = perfil => perfil && (perfil.rol === "moderador" || perfil.rol === "admin");

/**
 * Observa la sesión. Llama a callback con el operador ({ email, usuario, nombre, rol })
 * o con null si no hay sesión o el usuario no es moderador/admin.
 * @param {(user: object|null) => void} callback
 * @param {(mensaje: string) => void}   [onDenied] se llama si alguien sin permisos inicia sesión
 */
export function onAuthChange(callback, onDenied) {
    if (!supabase) { callback(null); return () => {}; }

    let ultimoId; // evita re-dibujar el panel cuando solo se renueva el token

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evento, session) => {
        const id = session?.user?.id ?? null;
        if (id === ultimoId) return;
        ultimoId = id;

        if (!id) { callback(null); return; }

        // Supabase recomienda no llamar a la BD dentro de este callback: se difiere.
        setTimeout(async () => {
            const perfil = await miPerfil(id);
            if (!esOperador(perfil)) {
                await supabase.auth.signOut();
                if (onDenied) onDenied("Tu usuario no tiene permisos de operador.");
                return;
            }
            callback({
                email:   `${perfil.nombre} (@${perfil.usuario})`,
                usuario: perfil.usuario,
                nombre:  perfil.nombre,
                rol:     perfil.rol
            });
        }, 0);
    });

    return () => subscription.unsubscribe();
}

/**
 * Inicia sesión con nombre de usuario y contraseña.
 * @param {string} usuario
 * @param {string} password
 */
export async function login(usuario, password) {
    if (!supabase) throw new Error("Supabase no está configurado (backend/supabase-config.js).");
    const { error } = await supabase.auth.signInWithPassword({
        email: correoInterno(usuario),
        password
    });
    if (error) {
        const m = (error.message || "").toLowerCase();
        if (m.includes("invalid login credentials")) throw new Error("Usuario o contraseña incorrectos.");
        if (m.includes("rate limit")) throw new Error("Demasiados intentos. Intenta más tarde.");
        throw new Error(error.message);
    }
}

/** Cierra la sesión del operador actual. */
export function logout() {
    return supabase.auth.signOut();
}

// ════════════════ REPORTES ════════════════════════════════════════

/**
 * Suscribe un listener a todos los reportes ordenados por fecha.
 * @returns {() => void} Función unsubscribe
 */
export function subscribeReportes(onUpdate, onError) {
    return escucharReportes(onUpdate, onError);
}

/**
 * Cambia el estado de un reporte (pending | progress | done | rejected).
 * La fecha de resolución y el historial los registra la base de datos sola.
 * @param {string} reporteId
 * @param {string} newStatus
 */
export async function updateStatus(reporteId, newStatus) {
    const estado = ESTADO_WEB_A_DB[newStatus];
    if (!estado) throw new Error(`Estado desconocido: ${newStatus}`);
    const { data, error } = await supabase
        .from("reportes")
        .update({ estado, nota_moderador: null })
        .eq("id", Number(reporteId))
        .select("id");
    if (error) throw error;
    if (!data.length) throw new Error("No tienes permiso para modificar este reporte.");
    recargarReportes();
}

/**
 * Elimina un reporte y sus fotos.
 * @param {string} reporteId
 * @param {string[]} [photoPaths] rutas de las fotos en Storage
 */
export async function deleteReporte(reporteId, photoPaths = []) {
    if (photoPaths.length) {
        const { error } = await supabase.storage.from(BUCKET_FOTOS).remove(photoPaths);
        if (error) console.warn("No se pudieron borrar algunas fotos:", error);
    }
    const { data, error } = await supabase
        .from("reportes")
        .delete()
        .eq("id", Number(reporteId))
        .select("id");
    if (error) throw error;
    if (!data.length) throw new Error("No tienes permiso para eliminar este reporte.");
    recargarReportes();
}
