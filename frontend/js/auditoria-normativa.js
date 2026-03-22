/**
 * Módulo de Auditoría de Integridad Normativa — Fase 2 (Arquitectura Pro)
 * =========================================================================
 * Módulo 100% AISLADO. Escanea archivos en Firebase Storage,
 * envía inventario a la Cloud Function 'getNormativeAudit' (backend seguro)
 * para auditoría normativa colombiana (NSR-10, NTC 6047, RETIE),
 * y renderiza resultados en el Dashboard.
 *
 * CAMBIO ARQUITECTÓNICO: La llamada a Gemini AI ya NO se hace desde el frontend.
 * Se delega a /api/getNormativeAudit (Firebase Cloud Function).
 * La API Key de Gemini está segura en Firebase Secret Manager.
 *
 * REGLAS DE ORO: Este módulo NO modifica ni referencia ninguna función
 * de mantenimiento.js (generateAIDiagnosis, renderMantCharts, exportarInformeOficial).
 */
import { storage } from './services/firebase.js';
import { ref, listAll, getMetadata } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js';
import { state } from './core/state.js';
import { on, EVENTS } from './core/events.js';
import { getCampusData } from './campus-data.js';
import { Logger } from './core/logger.js';
import { storageBasePath } from './core/config.js';

// ─── URL de la Cloud Function (relativa al mismo dominio en producción) ───
// En desarrollo local, apunta al emulador de Firebase Functions.
const AUDIT_FUNCTION_URL = '/api/getNormativeAudit';

// ─── Normative Requirements Definition ───
const REQUISITOS_NORMATIVOS = {
  'NSR-10': {
    label: 'NSR-10 (Sismo Resistencia)',
    icon: '🏗️',
    keywords: [
      'cimentacion', 'cimentación', 'fundacion', 'fundación',
      'viga', 'despiece', 'columna', 'memoria', 'calculo', 'cálculo',
      'estructural', 'placa', 'zapata', 'pedestal', 'refuerzo',
      'nsr', 'sismo', 'resistencia'
    ],
    descripcion: 'Planos de cimentación, despiece de vigas y memorias de cálculo estructural'
  },
  'NTC-6047': {
    label: 'NTC 6047 (Accesibilidad)',
    icon: '♿',
    keywords: [
      'accesibilidad', 'rampa', 'ntc', '6047',
      'discapacidad', 'movilidad', 'reducida', 'baranda',
      'señalizacion', 'señalización', 'braille', 'tactil', 'táctil',
      'matriz_accesibilidad', 'acceso_universal'
    ],
    descripcion: 'Planos de accesibilidad, rampas y matrices de cumplimiento NTC 6047'
  },
  'RETIE': {
    label: 'RETIE (Instalaciones Eléctricas)',
    icon: '⚡',
    keywords: [
      'electrico', 'eléctrico', 'carga', 'cuadro',
      'tablero', 'retie', 'acometida', 'circuito',
      'iluminacion', 'iluminación', 'subestacion', 'subestación',
      'transformador', 'potencia', 'diagrama_unifilar'
    ],
    descripcion: 'Cuadros de cargas, planos eléctricos y documentación RETIE'
  }
};

// ─── Cached state ───
let lastAuditResult = null;
let isAuditing = false;

/**
 * 1. EXTRACCIÓN DE DATOS — Escanea archivos de un bloque en Firebase Storage.
 * Usa listAll() recursivamente para inventariar toda la planoteca del bloque.
 *
 * @param {string} blockId — ID del bloque (ej: 'bloque_a')
 * @returns {Promise<Object>} — Inventario JSON con archivos, extensiones, subcarpetas
 */
async function escanearArchivosBloque(blockId) {
  const sede = state.currentSede || 'pamplona';

  // VALIDACIÓN ORO: Según la traza y la Tabla Maestra, la raíz es documentos_iser/ 
  // y los bloques usan el ID en minúsculas (ej: 'ib').
  // Por ejemplo: documentos_iser/ib/01_Arquitectonico/...
  const basePath = `${storageBasePath}/${blockId}`;
  const storageRef = ref(storage, basePath);

  const campusInfo = getCampusData();
  const blockName = campusInfo[blockId]?.name || blockId;

  const inventario = {
    blockId,
    blockName,
    sede,
    basePath,
    archivos: [],
    subcarpetas: new Set(),
    totalArchivos: 0,
    scanTimestamp: new Date().toISOString()
  };

  // Recursive scan helper (escanea Nivel 1, 2, 3...)
  async function escanearCarpeta(folderRef, carpetaActual = '') {
    try {
      const result = await listAll(folderRef);

      // Process files (items)
      for (const itemRef of result.items) {
        const nombre = itemRef.name;
        const extension = nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : 'sin_extension';
        
        let metadata = {};
        try {
          const meta = await getMetadata(itemRef);
          metadata = {
            size: meta.size,
            contentType: meta.contentType,
            timeCreated: meta.timeCreated,
            updated: meta.updated
          };
        } catch {
          // Metadata might not be accessible
        }

        inventario.archivos.push({
          nombre,
          extension,
          carpeta: carpetaActual || 'raíz',
          rutaCompleta: itemRef.fullPath,
          ...metadata
        });
      }

      // Process subfolders (prefixes)
      for (const prefixRef of result.prefixes) {
        const subfolderName = prefixRef.name;
        const subfolderPath = carpetaActual ? `${carpetaActual}/${subfolderName}` : subfolderName;
        inventario.subcarpetas.add(subfolderPath);
        
        // Recurse into subfolder (Nivel 2, 3, etc.)
        await escanearCarpeta(prefixRef, subfolderPath);
      }
    } catch (err) {
      Logger.warn(`Error escaneando carpeta ${carpetaActual || basePath}:`, err.message);
    }
  }

  await escanearCarpeta(storageRef);

  // ── Fallback 1: intentando ruta 'documentos_iser/sede/blockId' en caso de legado ──
  if (inventario.archivos.length === 0) {
    Logger.info(`📂 Sin archivos en "${basePath}". Intentando fallback legado: "${storageBasePath}/${sede}/${blockId}"`);
    const fallbackRef = ref(storage, `${storageBasePath}/${sede}/${blockId}`);
    inventario.basePath_fallback = `${storageBasePath}/${sede}/${blockId}`;
    await escanearCarpeta(fallbackRef);
  }

  // ── Fallback 2: intentando ruta con blockName visible (para asegurar) ──
  if (inventario.archivos.length === 0 && blockName !== blockId) {
    Logger.info(`📂 Aún sin archivos. Intentando fallback con nombre: "${storageBasePath}/${blockName}"`);
    const fallbackNameRef = ref(storage, `${storageBasePath}/${blockName}`);
    await escanearCarpeta(fallbackNameRef);
  }

  // Convert Set to Array for JSON serialization
  inventario.subcarpetas = Array.from(inventario.subcarpetas);
  inventario.totalArchivos = inventario.archivos.length;

  Logger.info(`📂 Escaneo completado: ${inventario.totalArchivos} archivos en ${inventario.subcarpetas.length} carpetas`);
  return inventario;
}


/**
 * 2. LÓGICA DE AUDITORÍA — Envía inventario a la Cloud Function getNormativeAudit.
 * La Cloud Function actúa como proxy seguro hacia Gemini AI en el servidor.
 * La API Key de Gemini NUNCA se expone en el frontend.
 *
 * @param {Object} inventario — Resultado de escanearArchivosBloque()
 * @returns {Promise<Object>} — Resultado de auditoría con puntaje, faltantes, resumen
 */
async function auditoriaDocumentalIA(inventario) {
  Logger.info(`🔐 Enviando inventario a Cloud Function: ${AUDIT_FUNCTION_URL}`);

  const response = await fetch(AUDIT_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ inventario })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Cloud Function falló (${response.status}): ${errorData.error || response.statusText}`);
  }

  const result = await response.json();
  return result;
}

/**
 * 3. INTERFAZ — Renderiza el panel de auditoría dentro del Dashboard Maestro.
 * Se monta en #panel-auditoria-normativa (Columna B).
 */
function renderPanelAuditoria() {
  const mountPoint = document.getElementById('panel-auditoria-normativa');
  const wideTasksContainer = document.getElementById('audit-tasks-container-wide');
  
  if (!mountPoint) return;

  const campusData = getCampusData();
  const blockOptions = Object.entries(campusData)
    .map(([id, data]) => `<option value="${id}">${data.name || id}</option>`)
    .join('');

  // ── 1. Render Columna B (Estado Normativo) ──
  mountPoint.innerHTML = `
    <div class="audit-card" id="audit-card-main" style="border:none; background:transparent; padding:0; box-shadow:none;">
      <div class="audit-header" style="margin-bottom: 1.5rem;">
        <div class="audit-header-icon">
          <i class="ph ph-shield-check"></i>
        </div>
        <div class="audit-header-text">
          <h3 class="audit-title">Auditoría de Integridad Normativa</h3>
          <p class="audit-subtitle">Escaneo de planoteca vs. normativa (NSR-10, NTC 6047, RETIE)</p>
        </div>
      </div>

      <div class="audit-controls">
        <div class="audit-field">
          <label class="audit-label" for="audit-bloque-select">Bloque a auditar</label>
          <select id="audit-bloque-select" class="audit-select">
            <option value="">— Selecciona un bloque —</option>
            ${blockOptions}
          </select>
        </div>
        <button type="button" id="audit-btn-start" class="audit-btn admin-only" disabled>
          <i class="ph ph-magnifying-glass"></i>
          <span>Iniciar Auditoría de Planoteca</span>
        </button>
      </div>

      <!-- Results area -->
      <div id="audit-results" class="audit-results" style="display:none; padding-top: 1rem;">
        <!-- Semáforo global -->
        <div class="audit-score-strip">
          <div class="audit-semaforo" id="audit-semaforo">
            <span class="audit-semaforo-dot" id="audit-semaforo-dot"></span>
            <span class="audit-semaforo-label" id="audit-semaforo-label">--</span>
          </div>
          <div class="audit-score-value" id="audit-score-value">--%</div>
        </div>

        <!-- Resumen ejecutivo -->
        <div class="audit-resumen" id="audit-resumen"></div>

        <!-- Normas breakdown -->
        <div class="audit-normas-grid" id="audit-normas-grid"></div>

        <!-- Inventario resumen -->
        <div class="audit-inventario-badge" id="audit-inventario-badge" style="margin-top: 1rem;"></div>
      </div>

      <!-- Spinner overlay -->
      <div id="audit-spinner-overlay" class="audit-spinner-overlay" style="display:none; border-radius: var(--radius-lg);">
        <div class="audit-spinner-content">
          <div class="audit-spinner-ring"></div>
          <p class="audit-spinner-text">Escaneando archivos en Firebase Storage...</p>
        </div>
      </div>
    </div>
  `;

  // ── 2. Render Full Width Footer (Tareas) ──
  if (wideTasksContainer) {
    wideTasksContainer.innerHTML = `
      <div class="audit-tasks-section" id="audit-tasks-section" style="background:transparent; border:none; padding:0;">
        <h4 class="audit-tasks-title" style="margin-bottom: 1rem;">
          <i class="ph ph-list-checks" style="color:var(--amber);"></i> Tareas Pendientes Detectadas
        </h4>
        <ul class="audit-task-list" id="audit-task-list" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:10px;"></ul>
      </div>
    `;
  }

  // ── Wire event listeners ──
  const selectEl = document.getElementById('audit-bloque-select');
  const btnStart = document.getElementById('audit-btn-start');

  selectEl?.addEventListener('change', () => {
    if (btnStart) btnStart.disabled = !selectEl.value;
    
    // Configurar PDF y mapa (Solo habilitar si hay diagnóstico previo)
    const mantBtnPdf = document.getElementById('btn-generate-pdf');
    if (mantBtnPdf) {
      const bId = selectEl.value;
      mantBtnPdf.disabled = !(bId && state.estadosBloques?.[bId]?.diagnostico_texto);
    }

    const navDropdown = document.getElementById('global-block-dropdown');
    if (navDropdown && navDropdown.value !== selectEl.value && selectEl.value) {
      navDropdown.value = selectEl.value;
      navDropdown.dispatchEvent(new Event('change'));
    }
  });

  // Sync with global block selection
  on(EVENTS.BLOCK_SELECTED, (id) => {
    if (selectEl && id && selectEl.value !== id) {
      selectEl.value = id;
      selectEl.dispatchEvent(new Event('change')); // trigger PDF logic
    }
  });

  // Start audit button
  btnStart?.addEventListener('click', async () => {
    const blockId = selectEl?.value;
    if (!blockId || isAuditing) return;

    isAuditing = true;
    const spinner = document.getElementById('audit-spinner-overlay');
    const results = document.getElementById('audit-results');
    const spinnerText = document.querySelector('.audit-spinner-text');

    try {
      // Show spinner, hide previous results
      if (spinner) spinner.style.display = 'flex';
      if (results) results.style.display = 'none';
      btnStart.disabled = true;
      btnStart.innerHTML = '<i class="ph ph-spinner animate-spin"></i> <span>Auditando...</span>';

      // Step 1: Scan files
      if (spinnerText) spinnerText.textContent = 'Escaneando archivos en Firebase Storage...';
      const inventario = await escanearArchivosBloque(blockId);

      if (inventario.totalArchivos === 0) {
        renderEmptyState(results, blockId);
        return;
      }

      // Step 2: AI Audit
      if (spinnerText) spinnerText.textContent = 'Analizando cumplimiento normativo con IA...';
      const auditResult = await auditoriaDocumentalIA(inventario);
      lastAuditResult = auditResult;

      // Update global state for PDF export
      if (!state.estadosBloques) state.estadosBloques = {};
      if (!state.estadosBloques[blockId]) state.estadosBloques[blockId] = {};
      
      const score = auditResult.puntaje_global || 0;
      let colorSugerido = '#EF4444'; // Red < 50
      if (score > 80) colorSugerido = '#10B981'; // Green > 80
      else if (score >= 50) colorSugerido = '#F59E0B'; // Yellow 50-80

      state.estadosBloques[blockId].diagnostico_texto = auditResult.resumen_ejecutivo;
      state.estadosBloques[blockId].score_infraestructura = score;
      state.estadosBloques[blockId].color_sugerido = colorSugerido;
      
      const radar_scores = {};
      if (auditResult.normas) {
        Object.entries(auditResult.normas).forEach(([norma, info]) => {
          radar_scores[norma] = info.puntaje;
        });
      }
      state.estadosBloques[blockId].radar_scores = radar_scores;
      state.estadosBloques[blockId].tareas_pendientes = auditResult.tareas_pendientes || [];
      state.estadosBloques[blockId].normas = auditResult.normas || {};

      // Save to Firestore for persistence across map reloads
      try {
        const { guardarEstadoBloque } = await import('./services/firestore.js');
        await guardarEstadoBloque(blockId, {
          diagnostico_texto: auditResult.resumen_ejecutivo,
          score_infraestructura: score,
          color_sugerido: colorSugerido,
          radar_scores: radar_scores,
          tareas_pendientes: auditResult.tareas_pendientes || [],
          normas: auditResult.normas || {}
        });
        Logger.info(`Estado del bloque ${blockId} guardado con éxito en Firestore.`);
      } catch (err) {
        Logger.warn('No se pudo invocar o guardar persistencia en Firestore', err);
      }

      // Enable the Generate PDF button
      const mantBtnPdf = document.getElementById('btn-generate-pdf');
      if (mantBtnPdf) mantBtnPdf.disabled = false;

      // TAREA 2: Actualizar estilo de Leaflet directamente
      console.log("Actualizando color de bloque:", blockId, "Color:", colorSugerido);
      try {
        const { getMapPolygons } = await import('./map.js');
        const polygons = getMapPolygons();
        if (polygons && polygons[blockId]) {
          // Direct Leaflet style injection as requested
          polygons[blockId].setStyle({ fillColor: colorSugerido, color: colorSugerido, fillOpacity: 0.8, weight: 3 });
        }
        // Force the map module to update its highlight logic via a standard DOM event
        window.dispatchEvent(new CustomEvent('updateMapColor', { detail: { blockId, color: colorSugerido } }));
      } catch (err) {
        Logger.warn('No se pudo invocar el módulo map.js para actualizar color', err);
      }

      // Step 3: Render results
      renderAuditResults(auditResult);

    } catch (err) {
      Logger.error('Error en auditoría normativa:', err);
      renderErrorState(results, err.message);
    } finally {
      if (spinner) spinner.style.display = 'none';
      isAuditing = false;
      btnStart.disabled = false;
      btnStart.innerHTML = '<i class="ph ph-magnifying-glass"></i> <span>Iniciar Auditoría de Planoteca</span>';
    }
  });
}

/**
 * Render audit results into the panel.
 */
function renderAuditResults(data) {
  const results = document.getElementById('audit-results');
  if (!results) return;
  results.style.display = '';

  // ── Semáforo ──
  const dot = document.getElementById('audit-semaforo-dot');
  const label = document.getElementById('audit-semaforo-label');
  const scoreValue = document.getElementById('audit-score-value');

  if (dot) {
    dot.style.backgroundColor = data.colorHex;
    dot.style.boxShadow = `0 0 12px ${data.colorHex}80`;
  }
  if (label) {
    const nivelTexto = { verde: 'Cumplimiento Alto', amarillo: 'Cumplimiento Parcial', rojo: 'Cumplimiento Crítico' };
    label.textContent = nivelTexto[data.nivel] || data.nivel;
    label.style.color = data.colorHex;
  }
  if (scoreValue) {
    scoreValue.textContent = `${data.puntaje_global || 0}%`;
    scoreValue.style.color = data.colorHex;
  }

  // ── Resumen ejecutivo ──
  const resumen = document.getElementById('audit-resumen');
  if (resumen) {
    // Reemplaza los caracteres extraños si quedan y lo inyecta como HTML
    const textoIA = (data.resumen_ejecutivo || 'Sin resumen disponible.').replace(/[%!&🛡️⚠️]/g, '');
    resumen.innerHTML = textoIA;
    resumen.style.overflowY = 'auto';
    resumen.style.maxHeight = '250px';
    resumen.style.paddingRight = '8px';
    resumen.style.textAlign = 'justify';
  }

  // ── Normas grid ──
  const normasGrid = document.getElementById('audit-normas-grid');
  if (normasGrid && data.normas) {
    let normasHtml = '';
    Object.entries(data.normas).forEach(([normaKey, normaData]) => {
      const config = REQUISITOS_NORMATIVOS[normaKey] || { icon: '📋', label: normaKey };
      const puntaje = normaData.puntaje || 0;
      let barColor = '#EF4444';
      if (puntaje >= 85) barColor = '#10B981';
      else if (puntaje >= 60) barColor = '#F59E0B';

      const encontradosHtml = (normaData.encontrados || [])
        .map(d => `<span class="audit-doc-tag found"><i class="ph ph-check-circle"></i> ${d}</span>`)
        .join('');

      const faltantesHtml = (normaData.faltantes_criticos || [])
        .map(d => `<span class="audit-doc-tag missing"><i class="ph ph-warning-circle"></i> ${d}</span>`)
        .join('');

      normasHtml += `
        <div class="audit-norma-card">
          <div class="audit-norma-header">
            <span class="audit-norma-icon">${config.icon}</span>
            <span class="audit-norma-name">${config.label}</span>
            <span class="audit-norma-score" style="color:${barColor}">${puntaje}%</span>
          </div>
          <div class="audit-norma-bar">
            <div class="audit-norma-bar-fill" style="width:${puntaje}%;background:${barColor}"></div>
          </div>
          ${normaData.observacion ? `<p class="audit-norma-obs">${normaData.observacion}</p>` : ''}
          ${encontradosHtml ? `<div class="audit-doc-list">${encontradosHtml}</div>` : ''}
          ${faltantesHtml ? `<div class="audit-doc-list">${faltantesHtml}</div>` : ''}
        </div>
      `;
    });
    normasGrid.innerHTML = normasHtml;
  }

  // ── Tareas pendientes ──
  const taskList = document.getElementById('audit-task-list');
  if (taskList && data.tareas_pendientes) {
    const prioridadColors = {
      'CRITICA': '#EF4444',
      'ALTA': '#F59E0B',
      'MEDIA': '#3B82F6'
    };

    taskList.innerHTML = data.tareas_pendientes.map(t => {
      const color = prioridadColors[t.prioridad] || '#64748B';
      return `
        <li class="audit-task-item">
          <span class="audit-task-priority" style="background:${color}20;color:${color};border:1px solid ${color}40">${t.prioridad}</span>
          <span class="audit-task-desc">${t.descripcion}</span>
        </li>
      `;
    }).join('');
  }

  // ── Inventario badge ──
  const invBadge = document.getElementById('audit-inventario-badge');
  if (invBadge && data.inventario_resumen) {
    invBadge.innerHTML = `
      <i class="ph ph-folder-open"></i>
      ${data.inventario_resumen.totalArchivos} archivos escaneados en ${data.inventario_resumen.totalCarpetas} carpetas
      <span class="audit-timestamp">· ${new Date(data.timestamp).toLocaleString('es-CO')}</span>
    `;
  }
}

/**
 * Render empty state when no files found.
 */
function renderEmptyState(container, blockId) {
  if (!container) return;
  container.style.display = '';
  container.innerHTML = `
    <div class="audit-empty-state">
      <i class="ph ph-folder-dashed" style="font-size:2.5rem;color:var(--text-muted);"></i>
      <p>No se encontraron archivos para el bloque <strong>${blockId}</strong> en Firebase Storage.</p>
      <p class="audit-empty-hint">Sube documentos a la planoteca antes de ejecutar la auditoría normativa.</p>
    </div>
  `;
}

/**
 * Render error state.
 */
function renderErrorState(container, message) {
  if (!container) return;
  container.style.display = '';
  container.innerHTML = `
    <div class="audit-error-state">
      <i class="ph ph-warning-octagon" style="font-size:2rem;color:#EF4444;"></i>
      <p>Error durante la auditoría: ${message}</p>
      <p class="audit-error-hint">El Dashboard sigue funcionando normalmente. Intenta de nuevo o verifica la conexión.</p>
    </div>
  `;
}

/**
 * Initialize the Normative Audit module.
 * Called from bootstrap.js via lazy loading.
 */
export function initAuditoriaNormativa() {
  // Wait for the dashboard to render its shell first
  const tryMount = () => {
    const mountPoint = document.getElementById('panel-auditoria-normativa');
    if (mountPoint) {
      renderPanelAuditoria();
      Logger.info('✅ Módulo de Auditoría Normativa inicializado.');
    }
  };

  // Try immediately
  tryMount();

  // Also re-mount when dashboard re-renders (Firestore sync rebuilds the shell)
  on(EVENTS.FIRESTORE_SYNC, () => {
    // Small delay to let dashboard.js rebuild its shell first
    setTimeout(tryMount, 200);
  });
}
