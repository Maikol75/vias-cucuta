// ══════════════════════════════════════════════════════════════════
//  VíasCúcuta — Configuración de Firebase
//  Credenciales y proyecto único compartido por todas las vistas
// ══════════════════════════════════════════════════════════════════

export const firebaseConfig = {
    apiKey:            "AIzaSyAW15yvAjBHQR068JguNhaL_Tmtzoovmio",
    authDomain:        "vias-cucuta.firebaseapp.com",
    projectId:         "vias-cucuta",
    storageBucket:     "vias-cucuta.firebasestorage.app",
    messagingSenderId: "1002872048654",
    appId:             "1:1002872048654:web:e673afed3fc382ef80c05f",
    measurementId:     "G-9JWZMMBF2T"
};

// Nombre de la colección principal en Firestore
export const COLLECTION_REPORTES = "reportes";

// Carpeta de Storage donde se suben las fotos de los reportes
export const STORAGE_FOLDER_REPORTES = "reportes";