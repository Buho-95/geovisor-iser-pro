/**
 * Módulo de Auditoría de Integridad Normativa — Fase 3 (Persistencia + Visitante)
 * =========================================================================
 * Módulo 100% AISLADO. Inventario vía Cloud Function getBlockInventory (Admin SDK),
 * auditoría vía getNormativeAudit (Gemini en backend).
 * para auditoría normativa colombiana (NSR-10, NTC 6047, RETIE),
 * y renderiza resultados en el Dashboard.
 *
 * NUEVO: Persistencia en Firestore (auditorias_bloques).
 * - Al generar auditoría exitosa, se guarda el resultado en caché.
 * - Al seleccionar un bloque, se consulta primero la caché.
 * - Si hay informe cacheado y los archivos no cambiaron, se muestra directamente.
 * - Solo admins pueden "Refrescar Auditoría" para forzar nueva consulta IA.
 *
 * CAMBIO ARQUITECTÓNICO: La llamada a Gemini AI ya NO se hace desde el frontend.
 * Se delega a /api/getNormativeAudit (Firebase Cloud Function).
 * La API Key de Gemini está segura en Firebase Secret Manager.
 *
 * REGLAS DE ORO: Este módulo NO modifica ni referencia ninguna función
 * de mantenimiento.js (generateAIDiagnosis, renderMantCharts, exportarInformeOficial).
 */
import { state } from './core/state.js';
import { on, EVENTS } from './core/events.js';
import { getCampusData } from './campus-data.js';
import { Logger } from './core/logger.js';
import { getAuditoriaCached, guardarAuditoria, guardarEstadoBloque } from './services/firestore.js';
import { isAdmin } from './services/auth.js';
import { authenticatedFetch, authenticatedFetchAny } from './services/api.js';
import { computeInventoryFingerprint } from './core/inventoryHash.js';
import { setTextContent, escapeHtml } from './core/safe-dom.js';
import normative from '../shared/normative-config.json' assert { type: 'json' };

const AUDIT_FUNCTION_URL = '/api/getNormativeAudit';
const INVENTORY_FUNCTION_URL = '/api/getBlockInventory';

const REQUISITOS_NORMATIVOS = {
  'NSR-10': {
    label: 'NSR-10 (Sismo Resistencia)',
    icon: '🏗️',
    descripcion: 'Planos de cimentación, despiece de vigas y memorias de cálculo estructural'
  },
  'NTC-6047': {
    label: 'NTC 6047 (Accesibilidad)',
    icon: '♿',
    descripcion: 'Planos de accesibilidad, rampas y matrices de cumplimiento NTC 6047'
  },
  'RETIE': {
    label: 'RETIE (Instalaciones Eléctricas)',
    icon: '⚡',
    descripcion: 'Cuadros de cargas, planos eléctricos y documentación RETIE'
  }
};

// ─── Cached state ───
let lastAuditResult = null;
let isAuditing = false;

/**
 * Inventario del bloque vía Cloud Function (Admin SDK + mismas rutas legado que antes).
 */
async function escanearArchivosBloque(blockId) {
  const campusInfo = getCampusData();
  const blockName = campusInfo[blockId]?.name || blockId;
  const sede = state.currentSede || 'pamplona';

  Logger.info(`🔐 Solicitando inventario al backend: ${INVENTORY_FUNCTION_URL}`);

  const response = await authenticatedFetchAny(INVENTORY_FUNCTION_URL, {
    method: 'POST',
    body: JSON.stringify({ blockId, blockName, sede }),
  });
  const data = await response.json();
  if (!data.inventario) {
    throw new Error('Respuesta de inventario inválida');
  }
  Logger.info(
    `📂 Inventario servidor: ${data.inventario.totalArchivos} archivos en ${(data.inventario.subcarpetas || []).length} carpetas`
  );
  return data.inventario;
}

async function auditoriaDocumentalIA(inventario) {
  Logger.info(`🔐 Enviando inventario a Cloud Function: ${AUDIT_FUNCTION_URL}`);

  const response = await authenticatedFetch(AUDIT_FUNCTION_URL, {
    method: 'POST',
    body: JSON.stringify({ inventario }),
  });
  return response.json();
}

/**
 * Aplica los datos de auditoría al estado global del bloque y actualiza el mapa.
 */
async function aplicarEstadoBloque(blockId, auditResult) {
  if (!state.estadosBloques) state.estadosBloques = {};
  if (!state.estadosBloques[blockId]) state.estadosBloques[blockId] = {};
  
  const score = auditResult.puntaje_global || 0;
  const th = normative.thresholds;
  let colorSugerido = '#EF4444';
  if (score > th.mapaVerde) colorSugerido = '#10B981';
  else if (score >= th.mapaAmarillo) colorSugerido = '#F59E0B';

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
    Logger.warn('No se pudo guardar persistencia en Firestore', err);
  }

  // Enable the Generate PDF button
  const mantBtnPdf = document.getElementById('btn-generate-pdf');
  if (mantBtnPdf) mantBtnPdf.disabled = false;

  // Actualizar estilo de Leaflet directamente
  try {
    const { getMapPolygons } = await import('./map.js');
    const polygons = getMapPolygons();
    if (polygons && polygons[blockId]) {
      polygons[blockId].setStyle({ fillColor: colorSugerido, color: colorSugerido, fillOpacity: 0.8, weight: 3 });
    }
    window.dispatchEvent(new CustomEvent('updateMapColor', { detail: { blockId, color: colorSugerido } }));
  } catch (err) {
    Logger.warn('No se pudo invocar el módulo map.js para actualizar color', err);
  }
}

/**
 * 3. INTERFAZ — Renderiza el panel de auditoría dentro del Dashboard Maestro.
 * Se monta en #panel-auditoria-normativa (Columna B).
 *
 * NUEVO: Lógica de visitante con caché Firestore.
 */
function renderPanelAuditoria() {
  const mountPoint = document.getElementById('panel-auditoria-normativa');
  const wideTasksContainer = document.getElementById('audit-tasks-container-wide');
  
  if (!mountPoint) return;

  const campusData = getCampusData();
  const blockOptions = Object.entries(campusData)
    .map(([id, data]) => `<option value="${id}">${data.name || id}</option>`)
    .join('');

  const userIsAdmin = isAdmin();

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
        <button type="button" id="audit-btn-start" class="audit-btn admin-only" disabled style="display:none;">
          <i class="ph ph-magnifying-glass"></i>
          <span>Iniciar Auditoría de Planoteca</span>
        </button>
        <button type="button" id="audit-btn-refresh" class="audit-btn admin-only" disabled style="display:none;">
          <i class="ph ph-arrows-clockwise"></i>
          <span>Refrescar Auditoría</span>
        </button>
      </div>

      <!-- Cache info badge -->
      <div id="audit-cache-info" class="audit-cache-badge" style="display:none;">
        <i class="ph ph-database"></i>
        <span id="audit-cache-text">Informe cargado desde caché</span>
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
  const btnRefresh = document.getElementById('audit-btn-refresh');

  // ── On block selection: check cache first ──
  selectEl?.addEventListener('change', async () => {
    const blockId = selectEl.value;
    
    // Reset buttons
    if (btnStart) { btnStart.style.display = 'none'; btnStart.disabled = true; }
    if (btnRefresh) { btnRefresh.style.display = 'none'; btnRefresh.disabled = true; }
    
    const cacheInfo = document.getElementById('audit-cache-info');
    if (cacheInfo) cacheInfo.style.display = 'none';

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

    if (!blockId) return;

    // ── LÓGICA DE VISITOR: Consultar caché primero ──
    const spinner = document.getElementById('audit-spinner-overlay');
    const spinnerText = document.querySelector('.audit-spinner-text');
    const results = document.getElementById('audit-results');

    if (spinner) spinner.style.display = 'flex';
    if (spinnerText) spinnerText.textContent = 'Consultando informe en base de datos...';

    try {
      const cached = await getAuditoriaCached(blockId);
      
      if (cached && cached.resumen_ejecutivo) {
        // ── Escanear archivos para comparar fingerprint ──
        if (spinnerText) spinnerText.textContent = 'Verificando vigencia del inventario...';
        const inventario = await escanearArchivosBloque(blockId);
        const currentHash = computeInventoryFingerprint(inventario);
        
        const cacheVigente = cached.archivoHash === currentHash;

        if (cacheVigente) {
          // ✅ Caché vigente: renderizar directamente
          Logger.info(`📋 Caché vigente para ${blockId}. Mostrando informe guardado.`);
          
          lastAuditResult = cached;
          await aplicarEstadoBloque(blockId, cached);
          renderAuditResults(cached);

          // Mostrar badge de caché
          if (cacheInfo) {
            cacheInfo.style.display = 'flex';
            const cacheText = document.getElementById('audit-cache-text');
            if (cacheText) {
              const fecha = cached.fechaAuditoria 
                ? new Date(cached.fechaAuditoria).toLocaleString('es-CO') 
                : 'Fecha desconocida';
              cacheText.textContent = `Informe cargado desde caché · ${fecha}`;
            }
          }

          // Solo admins pueden refrescar
          if (userIsAdmin && btnRefresh) {
            btnRefresh.style.display = '';
            btnRefresh.disabled = false;
          }
          // No mostrar "Iniciar" porque ya hay informe
          if (btnStart) btnStart.style.display = 'none';
          
        } else {
          // ❌ Caché obsoleta: archivos cambiaron
          Logger.info(`🔄 Archivos cambiaron para ${blockId}. Caché obsoleta.`);
          
          // Mostrar informe antiguo como referencia pero indicar que es obsoleto
          lastAuditResult = cached;
          renderAuditResults(cached);
          await aplicarEstadoBloque(blockId, cached);
          
          if (cacheInfo) {
            cacheInfo.style.display = 'flex';
            const cacheText = document.getElementById('audit-cache-text');
            if (cacheText) {
              cacheText.textContent = `⚠️ Informe desactualizado — los archivos han cambiado desde la última auditoría`;
            }
          }

          // Admins ven el botón de refrescar
          if (userIsAdmin) {
            if (btnRefresh) { btnRefresh.style.display = ''; btnRefresh.disabled = false; }
            if (btnStart) btnStart.style.display = 'none';
          } else {
            // Visitantes ven el informe obsoleto pero no pueden regenerar
            if (btnStart) btnStart.style.display = 'none';
          }
        }
      } else {
        // ── Sin caché: primera vez ──
        Logger.info(`📭 Sin auditoría en caché para ${blockId}.`);
        if (results) results.style.display = 'none';
        
        if (userIsAdmin) {
          if (btnStart) { btnStart.style.display = ''; btnStart.disabled = false; }
        } else {
          // Visitantes ven mensaje informativo
          renderEmptyState(results, blockId, true);
        }
      }
    } catch (err) {
      Logger.warn('Error consultando caché de auditoría:', err);
      // Fallback: mostrar botón normal para admin
      if (userIsAdmin) {
        if (btnStart) { btnStart.style.display = ''; btnStart.disabled = false; }
      }
    } finally {
      if (spinner) spinner.style.display = 'none';
    }
  });

  // Sync with global block selection
  on(EVENTS.BLOCK_SELECTED, (id) => {
    if (selectEl && id && selectEl.value !== id) {
      selectEl.value = id;
      selectEl.dispatchEvent(new Event('change'));
    }
  });

  // ── Función reutilizable para ejecutar auditoría ──
  async function ejecutarAuditoria(blockId) {
    if (!blockId || isAuditing) return;

    isAuditing = true;
    const spinner = document.getElementById('audit-spinner-overlay');
    const results = document.getElementById('audit-results');
    const spinnerText = document.querySelector('.audit-spinner-text');
    const cacheInfo = document.getElementById('audit-cache-info');

    try {
      if (spinner) spinner.style.display = 'flex';
      if (results) results.style.display = 'none';
      if (cacheInfo) cacheInfo.style.display = 'none';
      if (btnStart) { btnStart.disabled = true; btnStart.innerHTML = '<i class="ph ph-spinner animate-spin"></i> <span>Auditando...</span>'; }
      if (btnRefresh) { btnRefresh.disabled = true; btnRefresh.innerHTML = '<i class="ph ph-spinner animate-spin"></i> <span>Refrescando...</span>'; }

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

      // Step 3: Apply state
      await aplicarEstadoBloque(blockId, auditResult);

      // Step 4: Guardar en caché de Firestore (auditorias_bloques)
      try {
        await guardarAuditoria(blockId, auditResult, inventario);
        Logger.info(`💾 Auditoría guardada en caché Firestore para ${blockId}.`);
      } catch (err) {
        Logger.warn('No se pudo guardar auditoría en caché:', err);
      }

      // Step 5: Render results
      renderAuditResults(auditResult);

      // Show cache badge con fecha actual
      if (cacheInfo) {
        cacheInfo.style.display = 'flex';
        const cacheText = document.getElementById('audit-cache-text');
        if (cacheText) {
          cacheText.textContent = `✅ Auditoría generada y guardada · ${new Date().toLocaleString('es-CO')}`;
        }
      }

    } catch (err) {
      Logger.error('Error en auditoría normativa:', err);
      renderErrorState(results, err.message);
    } finally {
      if (spinner) spinner.style.display = 'none';
      isAuditing = false;
      if (btnStart) {
        btnStart.disabled = false;
        btnStart.innerHTML = '<i class="ph ph-magnifying-glass"></i> <span>Iniciar Auditoría de Planoteca</span>';
      }
      if (btnRefresh) {
        btnRefresh.disabled = false;
        btnRefresh.innerHTML = '<i class="ph ph-arrows-clockwise"></i> <span>Refrescar Auditoría</span>';
      }
    }
  }

  // Start audit button (first time)
  btnStart?.addEventListener('click', () => {
    const blockId = selectEl?.value;
    ejecutarAuditoria(blockId);
  });

  // Refresh audit button (admin forces re-generation)
  btnRefresh?.addEventListener('click', () => {
    const blockId = selectEl?.value;
    ejecutarAuditoria(blockId);
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
    const textoIA = (data.resumen_ejecutivo || 'Sin resumen disponible.').replace(/[%!&🛡️⚠️]/g, '');
    setTextContent(resumen, textoIA);
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
      const th = normative.thresholds;
      let barColor = '#EF4444';
      if (puntaje >= th.semaforoVerde) barColor = '#10B981';
      else if (puntaje >= th.semaforoAmarillo) barColor = '#F59E0B';

      const encontradosHtml = (normaData.encontrados || [])
        .map((d) => `<span class="audit-doc-tag found"><i class="ph ph-check-circle"></i> ${escapeHtml(d)}</span>`)
        .join('');

      const faltantesHtml = (normaData.faltantes_criticos || [])
        .map((d) => `<span class="audit-doc-tag missing"><i class="ph ph-warning-circle"></i> ${escapeHtml(d)}</span>`)
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
          ${normaData.observacion ? `<p class="audit-norma-obs">${escapeHtml(normaData.observacion)}</p>` : ''}
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

    taskList.innerHTML = data.tareas_pendientes.map((t) => {
      const color = prioridadColors[t.prioridad] || '#64748B';
      return `
        <li class="audit-task-item">
          <span class="audit-task-priority" style="background:${color}20;color:${color};border:1px solid ${color}40">${escapeHtml(t.prioridad)}</span>
          <span class="audit-task-desc">${escapeHtml(t.descripcion)}</span>
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
      <span class="audit-timestamp">· ${new Date(data.timestamp || data.fechaAuditoria).toLocaleString('es-CO')}</span>
    `;
  }
}

/**
 * Render empty state when no files found.
 */
function renderEmptyState(container, blockId, isVisitorNoCache = false) {
  if (!container) return;
  container.style.display = '';
  
  if (isVisitorNoCache) {
    container.innerHTML = `
      <div class="audit-empty-state">
        <i class="ph ph-clock-countdown" style="font-size:2.5rem;color:var(--text-muted);"></i>
        <p>Aún no se ha generado una auditoría para el bloque <strong>${blockId}</strong>.</p>
        <p class="audit-empty-hint">Un administrador debe ejecutar la auditoría por primera vez para que el informe quede disponible.</p>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="audit-empty-state">
        <i class="ph ph-folder-dashed" style="font-size:2.5rem;color:var(--text-muted);"></i>
        <p>No se encontraron archivos para el bloque <strong>${blockId}</strong> en Firebase Storage.</p>
        <p class="audit-empty-hint">Sube documentos a la planoteca antes de ejecutar la auditoría normativa.</p>
      </div>
    `;
  }
}

/**
 * Render error state.
 */
function renderErrorState(container, message) {
  if (!container) return;
  container.style.display = '';
  const safe = escapeHtml(message || '');
  container.innerHTML = `
    <div class="audit-error-state">
      <i class="ph ph-warning-octagon" style="font-size:2rem;color:#EF4444;"></i>
      <p>Error durante la auditoría: ${safe}</p>
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
      Logger.info('✅ Módulo de Auditoría Normativa inicializado (con persistencia).');
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
