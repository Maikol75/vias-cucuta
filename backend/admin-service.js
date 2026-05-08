// ══════════════════════════════════════════════════════════════════
//  VíasCúcuta — Servicio del Panel de Operador
//  Autenticación + lectura/actualización/eliminación de reportes
// ══════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getFirestore, collection, onSnapshot, query, orderBy,
    doc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { firebaseConfig, COLLECTION_REPORTES } from "./firebase-config.js";

// ─── Inicialización ────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ════════════════ AUTH ════════════════════════════════════════════

/**
 * Observa cambios en el estado de autenticación.
 * @param {(user: object|null) => void} callback
 */
export function onAuthChange(callback) {
    return onAuthStateChanged(auth, callback);
}

/**
 * Inicia sesión con correo y contraseña.
 * @param {string} email
 * @param {string} password
 * @returns {Promise}
 */
export function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

/**
 * Cierra la sesión del operador actual.
 */
export function logout() {
    return signOut(auth);
}

// ════════════════ REPORTES ════════════════════════════════════════

/**
 * Suscribe un listener a todos los reportes ordenados por fecha.
 * @param {(reportes: object[]) => void} onUpdate
 * @param {(error: Error) => void}      onError
 * @returns {() => void} Función unsubscribe
 */
export function subscribeReportes(onUpdate, onError) {
    const q = query(collection(db, COLLECTION_REPORTES), orderBy("timestamp", "desc"));
    return onSnapshot(q, snapshot => {
        const reportes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        onUpdate(reportes);
    }, err => {
        console.error("Firestore error:", err);
        if (onError) onError(err);
    });
}

/**
 * Cambia el estado de un reporte (pending | progress | done).
 * @param {string} reporteId
 * @param {string} newStatus
 */
export function updateStatus(reporteId, newStatus) {
    return updateDoc(doc(db, COLLECTION_REPORTES, reporteId), { status: newStatus });
}

/**
 * Elimina un reporte de Firestore (solo si está resuelto, según las reglas).
 * @param {string} reporteId
 */
export function deleteReporte(reporteId) {
    return deleteDoc(doc(db, COLLECTION_REPORTES, reporteId));
}
