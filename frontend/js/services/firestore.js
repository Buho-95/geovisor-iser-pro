/**
 * Servicio de datos: suscripción por bloque, auditoría e historial.
 * Migrado completamente a Supabase.
 */
import { state, setArchivos, setEstadosBloques } from '../core/state.js';
import { on, EVENTS } from '../core/events.js';
import { Logger } from '../core/logger.js';
import { authenticatedFetchAny, API_ENDPOINTS } from './api.js';

import { 
  getAllEstadosBloques, 
  guardarEstadoBloqueSupabase,
  getAuditoriaCachedSupabase,
  guardarAuditoriaSupabase,
  uploadToSupabaseStorage,
  saveReportMetadataSupabase,
  getReportHistorySupabase,
  deleteReportSupabase
} from './supabase.js';

const INVENTORY_FUNCTION_URL = API_ENDPOINTS.getBlockInventory;
let inventoryListenersInitialized = false;
let offBlockSelected = null;
let offAuthChanged = null;
let activeInventoryRequest = 0;

function applyCloudStatus(ok) {
  const status = document.getElementById('cloud-status');
  if (!status) return;
  if (ok) {
    status.innerHTML = '<i class="ph-fill ph-cloud-check"></i> BD Sincronizada';
    status.className =
      'flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-bold border border-emerald-200';
  } else {
    status.innerHTML = '<i class="ph-fill ph-cloud-slash"></i> Sin conexión a BD';
    status.className =
      'flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-200';
  }
}

function setErrorStatus(msg = 'Error de carga') {
  const status = document.getElementById('cloud-status');
  if (!status) return;
  status.innerHTML = `<i class="ph ph-warning-circle"></i> ${msg}`;
  status.className =
    'flex items-center gap-2 px-3 py-1 bg-rose-50 text-rose-700 rounded-full text-xs font-bold border border-rose-200';
}

function setLoading(loading, label = 'Conectando...') {
  const status = document.getElementById('cloud-status');
  if (!status) return;
  if (loading) {
    status.innerHTML = '<i class="ph ph-spinner-gap animate-spin"></i> ' + label;
    status.className =
      'flex items-center gap-2 px-3 py-1 bg-sky-50 text-sky-700 rounded-full text-xs font-bold border border-sky-200';
  } else if (status.innerHTML.includes('spinner-gap')) {
    status.innerHTML = '<i class="ph ph-map-pin"></i> Selecciona un bloque';
    status.className =
      'flex items-center gap-2 px-3 py-1 bg-slate-50 text-slate-600 rounded-full text-xs font-bold border border-slate-200';
  }
}

export function initArchivosSubscription(onUpdate) {
  if (inventoryListenersInitialized) {
    return () => {
      offBlockSelected?.();
      offAuthChanged?.();
      inventoryListenersInitialized = false;
    };
  }
  inventoryListenersInitialized = true;
  console.log('INIT APP');

  const subscribe = async (blockId) => {
    const requestId = ++activeInventoryRequest;
    if (!state.user) {
      Logger.warn('Auth aún no listo; se omite carga de inventario');
      setLoading(false);
      return;
    }

    setLoading(true, 'Conectando...');
    if (!blockId) {
      state.archivosNube = [];
      setArchivos([]);
      setLoading(false);
      onUpdate?.();
      return;
    }

    // Resolver ID corto del mapa (ej: 'admin') → ID canónico de Storage
    // (ej: '04_Bloque_Administrativo') para que Cloud Run escanee la ruta real.
    let canonicalBlockId = blockId;
    try {
      const { resolveBloqueCanonical } = await import('../core/structure-schema.js');
      const resolved = await resolveBloqueCanonical(state.currentSede || 'pamplona', blockId);
      if (resolved) canonicalBlockId = resolved;
    } catch (e) {
      Logger.warn('[firestore] resolveBloqueCanonical falló, usando blockId original');
    }

    Logger.debug(`[firestore] subscribe: ${blockId} → canonical: ${canonicalBlockId}`);
    try {
      const response = await authenticatedFetchAny(INVENTORY_FUNCTION_URL, {
        method: 'POST',
        body: JSON.stringify({
          blockId: canonicalBlockId,
          blockName: canonicalBlockId,
          sede: state.currentSede || 'pamplona',
        }),
      });
      const payload = await response.json();
      if (requestId !== activeInventoryRequest) return;
      const inventario = payload?.inventario;
      const rawDocs = Array.isArray(inventario?.archivos) ? inventario.archivos : [];
      // Normalizar bloque → ID original corto para que el fileMapper
      // y las vistas de UI encuentren los archivos correctamente.
      const docs = rawDocs.map(d => ({ ...d, bloque: blockId }));
      state.archivosNube = docs;
      setArchivos(docs);
      applyCloudStatus(true);
      onUpdate?.();
    } catch (error) {
      if (requestId !== activeInventoryRequest) return;
      Logger.error('Inventory backend sync error:', error);
      setErrorStatus('Error de carga');
      state.archivosNube = [];
      setArchivos([]);
      onUpdate?.();
    } finally {
      if (requestId === activeInventoryRequest) {
        setLoading(false);
      }
    }
  };

  offBlockSelected = on(EVENTS.BLOCK_SELECTED, (blockId) => subscribe(blockId));
  offAuthChanged = on(EVENTS.AUTH_STATE_CHANGED, (user) => {
    if (!user) {
      state.archivosNube = [];
      setArchivos([]);
      setLoading(false);
      onUpdate?.();
      return;
    }
    console.log('AUTH READY');
    subscribe(state.currentBlockId || null);
  });

  if (state.user) {
    subscribe(state.currentBlockId || null);
  } else {
    setLoading(false);
  }

  return () => {
    offBlockSelected?.();
    offAuthChanged?.();
    offBlockSelected = null;
    offAuthChanged = null;
    inventoryListenersInitialized = false;
  };
}

export function startArchivosSync(onUpdate) {
  Logger.warn('startArchivosSync está deprecado; use initArchivosSubscription');
  return initArchivosSubscription(onUpdate);
}

export function startEstadosBloquesSync(onUpdate) {
  // Carga inicial y luego polling liviano
  let intervalId = null;
  const syncSB = async () => {
    try {
      const docs = await getAllEstadosBloques();
      state.estadosBloques = docs;
      setEstadosBloques(docs);
      onUpdate?.();
    } catch (error) {
      Logger.error('Supabase bloques_estado sync error:', error);
      onUpdate?.();
    }
  };
  syncSB(); // carga inmediata
  intervalId = setInterval(syncSB, 30_000); // refrescar cada 30s
  return () => clearInterval(intervalId); // devolver unsub
}

export async function guardarEstadoBloque(blockId, datos) {
  return guardarEstadoBloqueSupabase(blockId, datos);
}

export async function getAuditoriaCached(blockId) {
  return getAuditoriaCachedSupabase(blockId);
}

export async function guardarAuditoria(blockId, auditResult, inventario) {
  return guardarAuditoriaSupabase(blockId, auditResult, inventario);
}

export async function uploadReportToStorage(blockId, pdfBlob, fileName) {
  const storagePath = `${blockId}/${fileName}`;
  const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
  return uploadToSupabaseStorage('auditorias', storagePath, file);
}

export async function saveReportMetadata(blockId, blockName, downloadUrl, storagePath, userEmail) {
  return saveReportMetadataSupabase(blockId, blockName, downloadUrl, storagePath, userEmail);
}

export async function getReportHistory() {
  return getReportHistorySupabase();
}

export async function deleteReport(reportId, storagePath) {
  return deleteReportSupabase(reportId, storagePath);
}
