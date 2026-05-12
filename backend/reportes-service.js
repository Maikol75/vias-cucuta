// ══════════════════════════════════════════════════════════════════
//  VíasCúcuta — Servicio de Reportes (vista ciudadana)
//  Capa de acceso a datos: Firestore (reportes) + Cloudinary (fotos)
// ══════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getFirestore, collection, addDoc,
    onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
    firebaseConfig,
    COLLECTION_REPORTES
} from "./firebase-config.js";

// ─── Configuración de Cloudinary ───────────────────────────────────
const CLOUDINARY_CLOUD_NAME    = "denpau9b7";
const CLOUDINARY_UPLOAD_PRESET = "vias_cucuta";
const CLOUDINARY_FOLDER        = "reportes";

// ─── Inicialización de Firebase ────────────────────────────────────
let db         = null;
let firebaseOK = false;

try {
    const app = initializeApp(firebaseConfig);
    db        = getFirestore(app);
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
 * Sube una foto a Cloudinary usando unsigned upload.
 * Devuelve la URL segura (HTTPS) de la imagen.
 * @param {File} file
 * @returns {Promise<string>}
 */
async function uploadOnePhotoToCloudinary(file) {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    if (CLOUDINARY_FOLDER) formData.append("folder", CLOUDINARY_FOLDER);

    const res = await fetch(url, { method: "POST", body: formData });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Cloudinary upload falló (${res.status}): ${errText}`);
    }
    const data = await res.json();
    return data.secure_url;
}

/**
 * Sube un conjunto de fotos a Cloudinary y devuelve sus URLs.
 * @param {File[]} files
 * @returns {Promise<string[]>}
 */
export async function uploadPhotos(files) {
    if (!files?.length) return [];
    return Promise.all(files.map(uploadOnePhotoToCloudinary));
}

/**
 * Crea un nuevo reporte en Firestore. Si recibe archivos los sube a Cloudinary primero.
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