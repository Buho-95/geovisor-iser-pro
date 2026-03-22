/**
 * Módulo de Auditoría de Integridad Normativa — Fase 2
 * =====================================================
 * Módulo 100% AISLADO. Escanea archivos en Firebase Storage,
 * envía inventario a Gemini AI para auditoría normativa colombiana
 * (NSR-10, NTC 6047, RETIE), y renderiza resultados en el Dashboard.
 *
 * REGLAS DE ORO: Este módulo NO modifica ni referencia ninguna función
 * de mantenimiento.js (generateAIDiagnosis, renderMantCharts, exportarInformeOficial).
 */
import { storage } from './services/firebase.js';
import { ref, listAll, getMetadata } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js';
import { state } from './core/state.js';
import { on, EVENTS } from './core/events.js';
import { getCampusData } from './campus-data.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Logger } from './core/logger.js';
import { storageBasePath } from './core/config.js';

// ─── API Key (aislada, no referencia mantenimiento.js) ───
const GEMINI_API_KEY = 'AIzaSyBtW6xf9FLNN7j8wwy9jpg0PUuOaz6Vz-8';

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
 * 2. LÓGICA DE AUDITORÍA — Envía inventario a Gemini AI para evaluación normativa.
 * System Prompt: "Interventor Técnico Senior de Proyectos ISER"
 *
 * @param {Object} inventario — Resultado de escanearArchivosBloque()
 * @returns {Promise<Object>} — Resultado de auditoría con puntaje, faltantes, resumen
 */
async function auditoriaDocumentalIA(inventario) {
  if (!GEMINI_API_KEY) {
    throw new Error('API Key de Gemini no configurada para auditoría normativa.');
  }

  // ── Pre-analysis: check keywords locally first ──
  const preAnalisis = {};
  Object.entries(REQUISITOS_NORMATIVOS).forEach(([norma, config]) => {
    const encontrados = inventario.archivos.filter(archivo => {
      const nombreLower = archivo.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const carpetaLower = archivo.carpeta.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return config.keywords.some(kw => nombreLower.includes(kw) || carpetaLower.includes(kw));
    });
    preAnalisis[norma] = {
      encontrados: encontrados.map(a => a.nombre),
      count: encontrados.length,
      carpetas: [...new Set(encontrados.map(a => a.carpeta))]
    };
  });

  // ── Build the prompt ──
  const listaArchivos = inventario.archivos
    .map(a => `  - [${a.carpeta}] ${a.nombre} (${a.extension.toUpperCase()}${a.size ? `, ${(a.size / 1024).toFixed(1)}KB` : ''})`)
    .join('\n');

  const listaCarpetas = inventario.subcarpetas.join(', ');

  const prompt = `
Actúa como un INTERVENTOR TÉCNICO SENIOR DE PROYECTOS ISER (Instituto Superior de Educación Rural) en Colombia.

Tu tarea es realizar una AUDITORÍA DOCUMENTAL del bloque "${inventario.blockId}" ubicado en la sede "${inventario.sede}".

INVENTARIO DE ARCHIVOS ENCONTRADOS (${inventario.totalArchivos} archivos en ${inventario.subcarpetas.length} carpetas):
${listaArchivos}

CARPETAS DETECTADAS: ${listaCarpetas}

PRE-ANÁLISIS DE COINCIDENCIAS:
${Object.entries(preAnalisis).map(([norma, data]) => 
  `- ${norma}: ${data.count} archivo(s) potencialmente relacionados${data.count > 0 ? ': ' + data.encontrados.slice(0, 5).join(', ') : ''}`
).join('\n')}

INSTRUCCIONES DE AUDITORÍA:
Compara este inventario contra los REQUISITOS MÍNIMOS de cada normativa colombiana:

1. **NSR-10 (Norma Sismo Resistente):**
   - Busca: Planos de cimentación, despiece de vigas/columnas, memorias de cálculo estructural, planos de refuerzo.
   - Evalúa si los documentos estructurales son suficientes.

2. **NTC 6047 (Accesibilidad para personas con movilidad reducida):**
   - Busca: Planos de accesibilidad, diseño de rampas, matrices de cumplimiento, señalización inclusiva.
   - Verifica si hay documentación de accesibilidad universal.

3. **RETIE (Reglamento Técnico de Instalaciones Eléctricas):**
   - Busca: Cuadros de cargas, diagramas unifilares, planos eléctricos, certificaciones.
   - Evalúa completitud eléctrica.

FORMATO DE RESPUESTA OBLIGATORIO (JSON puro, sin markdown):
{
  "resumen_ejecutivo": "Párrafo de 3-4 líneas con hallazgos principales.",
  "normas": {
    "NSR-10": {
      "encontrados": ["lista de documentos encontrados relevantes"],
      "faltantes_criticos": ["lista de documentos faltantes críticos"],
      "puntaje": 0-100,
      "observacion": "Observación breve"
    },
    "NTC-6047": {
      "encontrados": ["..."],
      "faltantes_criticos": ["..."],
      "puntaje": 0-100,
      "observacion": "..."
    },
    "RETIE": {
      "encontrados": ["..."],
      "faltantes_criticos": ["..."],
      "puntaje": 0-100,
      "observacion": "..."
    }
  },
  "puntaje_global": 0-100,
  "tareas_pendientes": [
    {"prioridad": "CRITICA|ALTA|MEDIA", "descripcion": "Tarea específica a realizar"}
  ]
}

IMPORTANTE: Responde SOLO con el JSON. Sin texto adicional, sin bloques de código markdown.
`;

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

  // Try models with fallback
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash-latest'];
  let lastError = null;

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel(
        { model: modelName },
        { apiVersion: 'v1' }
      );
      const result = await model.generateContent(prompt);
      const rawText = result.response.text().trim();

      // Parse JSON response (handle possible markdown wrapping)
      let jsonStr = rawText;
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();

      try {
        const parsed = JSON.parse(jsonStr);
        
        // Determine traffic light level
        const puntaje = parsed.puntaje_global || 0;
        let nivel = 'rojo';
        let colorHex = '#EF4444';
        if (puntaje >= 85) { nivel = 'verde'; colorHex = '#10B981'; }
        else if (puntaje >= 60) { nivel = 'amarillo'; colorHex = '#F59E0B'; }

        return {
          ...parsed,
          nivel,
          colorHex,
          inventario_resumen: {
            totalArchivos: inventario.totalArchivos,
            totalCarpetas: inventario.subcarpetas.length,
            blockId: inventario.blockId
          },
          timestamp: new Date().toISOString()
        };
      } catch (parseErr) {
        Logger.warn('Fallo al parsear JSON de auditoría:', parseErr);
        // Return a structured fallback with the raw text
        return {
          resumen_ejecutivo: rawText.substring(0, 500),
          normas: {},
          puntaje_global: 0,
          nivel: 'rojo',
          colorHex: '#EF4444',
          tareas_pendientes: [{ prioridad: 'CRITICA', descripcion: 'Error en el análisis. Reintentar auditoría.' }],
          inventario_resumen: {
            totalArchivos: inventario.totalArchivos,
            totalCarpetas: inventario.subcarpetas.length,
            blockId: inventario.blockId
          },
          timestamp: new Date().toISOString(),
          _parseError: true
        };
      }
    } catch (modelErr) {
      Logger.warn(`Modelo ${modelName} falló:`, modelErr.message);
      lastError = modelErr;
    }
  }

  throw lastError || new Error('Todos los modelos de IA fallaron.');
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
