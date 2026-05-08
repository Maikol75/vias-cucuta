// ══════════════════════════════════════════════════════════════════
//  VíasCúcuta — Servicio de Reportes (vista ciudadana)
//  Capa de acceso a datos: Firestore + Storage
//  Expone una API simple para que el frontend no toque Firebase directo
// ══════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getFirestore, collection, addDoc,
    onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

import {
    firebaseConfig,
    COLLECTION_REPORTES,
    STORAGE_FOLDER_REPORTES
} from "./firebase-config.js";

// ─── Inicialización ────────────────────────────────────────────────
let db        = null;
let storage   = null;
let firebaseOK = false;

try {
    const app = initializeApp(firebaseConfig);
    db        = getFirestore(app);
    storage   = getStorage(app);
    firebaseOK = !firebaseConfig.apiKey.includes("TU_");
} catch (e) {
    console.warn("Firebase no configurado, usando modo demo local.", e);
}

/**
 * Indica si Firebase está listo y configurado correctamente.
 */
export function isFirebaseReady() {
    return firebaseOK;
}

/**
 * Suscribe un listener en tiempo real a la colección de reportes.
 * @param {(reportes: object[]) => void} onUpdate  Callback con la lista actualizada
 * @returns {() => void}                            Función para cancelar la suscripción
 */
export function subscribeReportes(onUpdate) {
    if (!db) return () => {};
    const q = query(collection(db, COLLECTION_REPORTES), orderBy("timestamp", "desc"));
    return onSnapshot(q, snapshot => {
        const reportes = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        onUpdate(reportes);
    });
}

/**
 * Sube un conjunto de fotos al Storage y devuelve sus URLs públicas.
 * @param {File[]} files
 * @returns {Promise<string[]>}
 */
export async function uploadPhotos(files) {
    if (!storage || !files?.length) return [];
    const urls = await Promise.all(files.map(async file => {
        const path       = `${STORAGE_FOLDER_REPORTES}/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        return await getDownloadURL(storageRef);
    }));
    return urls;
}

/**
 * Crea un nuevo reporte en Firestore. Si recibe archivos los sube primero.
 * @param {object} report     Datos del reporte (sin id ni timestamp)
 * @param {File[]} photoFiles Archivos de fotos a subir
 * @returns {Promise<string>} ID del documento creado
 */
export async function createReporte(report, photoFiles = []) {
    if (!db) throw new Error("Firestore no inicializado");
    const photoUrls = await uploadPhotos(photoFiles);
    const docRef = await addDoc(collection(db, COLLECTION_REPORTES), {
        ...report,
        photos:    photoUrls,
        timestamp: serverTimestamp()
    });
    return docRef.id;
}
