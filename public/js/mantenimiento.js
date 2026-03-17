/**
 * Módulo de Mantenimiento — Diagnóstico técnico asistido por IA.
 * Recopila contexto de archivos, genera diagnósticos simulados,
 * y exporta informes oficiales en PDF con jsPDF.
 */
import { state } from './core/state.js';
import { getCampusData } from './campus-data.js';
import { getFilesInPath } from './services/fileMapper.js';

// ─── DOM References ───
let formEl, bloqueSelect, estadoSelect, fechaInput;
let diagnosticoArea, recomendacionesArea;
let btnIA, btnPDF, spinnerOverlay;
let contextSummary, contextList;

// ─── Relevant folders for AI context ───
const AI_CONTEXT_PATHS = [
  { path: '02_Estructural', label: 'Estructural' },
  { path: '03_Electricos_y_Red_de_Datos', label: 'Eléctricos y Redes' },
  { path: '08_Registro_Fotografico', label: 'Registro Fotográfico' }
];

/**
 * Get file context for AI analysis from specific folders.
 * @param {string} blockId
 * @returns {{ files: Array, summary: string }}
 */
export function getContextForAI(blockId) {
  const campusData = getCampusData();
  const blockName = campusData?.[blockId]?.name || blockId;
  const allContextFiles = [];

  AI_CONTEXT_PATHS.forEach(({ path, label }) => {
    const files = getFilesInPath(blockId, path);
    files.forEach(f => {
      allContextFiles.push({
        nombre: f.nombre || f.name || 'Sin nombre',
        carpeta: label,
        tipo: f.tipo || 'desconocido',
        fecha: f.fechaSubida || f.fecha || '--'
      });
    });
  });

  const summary = allContextFiles.length > 0
    ? `Se encontraron ${allContextFiles.length} archivo(s) relevantes en ${blockName}.`
    : `No se encontraron archivos de contexto para ${blockName}.`;

  return { files: allContextFiles, summary, blockName };
}

/**
 * Build a structured prompt for AI analysis.
 */
function buildAIPrompt(blockId) {
  const campusData = getCampusData();
  const blockInfo = campusData?.[blockId]?.info || {};
  const blockName = campusData?.[blockId]?.name || blockId;
  const estado = estadoSelect?.value || 'regular';
  const fecha = fechaInput?.value || 'No registrada';
  const context = getContextForAI(blockId);

  let fileList = 'Ninguno disponible.';
  if (context.files.length > 0) {
    fileList = context.files.map(f =>
      `- [${f.carpeta}] ${f.nombre} (${f.tipo})`
    ).join('\n');
  }

  return `DIAGNÓSTICO TÉCNICO DE MANTENIMIENTO — ${blockName}
══════════════════════════════════════════════

DATOS DEL BLOQUE:
• Nombre: ${blockName}
• Área: ${blockInfo.area || '--'} m²
• Recintos: ${blockInfo.rooms || '--'}
• Sistema Constructivo: ${blockInfo.construction || '--'}
• Cubierta: ${blockInfo.roof || '--'}
• Estado General Reportado: ${estado.toUpperCase()}
• Última Inspección: ${fecha}

ARCHIVOS CONSULTADOS (${context.files.length}):
${fileList}

═══ DIAGNÓSTICO GENERADO ═══

Basado en el análisis de la documentación técnica disponible para ${blockName}:

1. ESTADO ESTRUCTURAL: ${estado === 'critico' ? 'Se detectan condiciones que requieren intervención inmediata. Los planos estructurales disponibles indican que es necesario realizar una evaluación de patologías en elementos portantes.' : estado === 'regular' ? 'El bloque presenta desgaste normal para su antigüedad. Se recomienda programar mantenimiento preventivo en las áreas identificadas.' : 'La edificación se encuentra en condiciones óptimas de servicio. Se recomienda continuar con el plan de mantenimiento preventivo establecido.'}

2. INSTALACIONES ELÉCTRICAS: ${context.files.some(f => f.carpeta.includes('Eléctric')) ? 'Se cuenta con documentación eléctrica actualizada. Se recomienda verificar el estado de tableros y acometidas según los planos registrados.' : 'No se encontraron planos eléctricos en el sistema. Se recomienda realizar un levantamiento eléctrico completo.'}

3. REGISTRO FOTOGRÁFICO: ${context.files.some(f => f.carpeta.includes('Fotográfico')) ? `Se dispone de ${context.files.filter(f => f.carpeta.includes('Fotográfico')).length} fotografía(s) de referencia para comparación visual del estado actual vs. registros previos.` : 'No se encontraron fotografías de referencia. Se recomienda realizar un registro fotográfico completo del bloque.'}

4. RECOMENDACIONES PRIORITARIAS:
   ${estado === 'critico' ? '⚠️ URGENTE: Programar inspección presencial en las próximas 48 horas.\n   • Evaluar integridad de elementos portantes.\n   • Verificar estado de instalaciones eléctricas.\n   • Documentar con fotografías todas las patologías encontradas.' : '• Continuar con el cronograma de mantenimiento preventivo.\n   • Actualizar el registro fotográfico del bloque.\n   • Verificar vigencia de certificaciones técnicas.'}`;
}

/**
 * Render file context summary in the UI.
 */
function renderContextSummary(blockId) {
  const context = getContextForAI(blockId);

  if (context.files.length === 0) {
    contextSummary.style.display = 'none';
    return;
  }

  contextSummary.style.display = '';

  // Group by folder label
  const groups = {};
  context.files.forEach(f => {
    if (!groups[f.carpeta]) groups[f.carpeta] = [];
    groups[f.carpeta].push(f);
  });

  let html = '';
  Object.entries(groups).forEach(([label, files]) => {
    html += `<div class="mant-ctx-group">
      <span class="mant-ctx-label">${label}</span>
      <span class="mant-ctx-count">${files.length} archivo(s)</span>
    </div>`;
  });

  contextList.innerHTML = html;
}

/**
 * Generate PDF report using jsPDF.
 */
function exportarInformeOficial() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('Error crítico: La librería de reportes no cargó. Verifica que no tengas un bloqueador de publicidad activado.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const blockId = bloqueSelect.value;
  const campusData = getCampusData();
  const blockName = campusData?.[blockId]?.name || blockId;
  const blockInfo = campusData?.[blockId]?.info || {};
  const context = getContextForAI(blockId);
  const estado = estadoSelect?.value || '';
  const fecha = fechaInput?.value || 'No registrada';

  // ── Header ──
  doc.setFillColor(46, 125, 50);
  doc.rect(0, 0, 210, 38, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('ISER — Informe de Mantenimiento', 14, 16);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Instituto Superior de Educación Rural', 14, 24);
  doc.text(`Fecha de generación: ${new Date().toLocaleDateString('es-CO')}`, 14, 30);

  // ── Block Info ──
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`Bloque: ${blockName}`, 14, 50);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const infoY = 58;
  doc.text(`Estado General: ${estado.toUpperCase()}`, 14, infoY);
  doc.text(`Última Inspección: ${fecha}`, 14, infoY + 6);
  doc.text(`Área: ${blockInfo.area || '--'} m²  |  Recintos: ${blockInfo.rooms || '--'}`, 14, infoY + 12);
  doc.text(`Construcción: ${blockInfo.construction || '--'}  |  Cubierta: ${blockInfo.roof || '--'}`, 14, infoY + 18);

  // ── Diagnóstico ──
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Diagnóstico de la IA', 14, infoY + 32);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const diagText = diagnosticoArea?.value || 'Sin diagnóstico generado.';
  const splitDiag = doc.splitTextToSize(diagText, 180);
  doc.text(splitDiag, 14, infoY + 40);

  // ── Recomendaciones ──
  const recoY = infoY + 42 + (splitDiag.length * 4);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Recomendaciones Técnicas', 14, recoY);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const recoText = recomendacionesArea?.value || 'Sin recomendaciones adicionales.';
  const splitReco = doc.splitTextToSize(recoText, 180);
  doc.text(splitReco, 14, recoY + 8);

  // ── File Table ──
  if (context.files.length > 0) {
    const tableY = recoY + 12 + (splitReco.length * 4);

    doc.autoTable({
      startY: tableY,
      head: [['#', 'Archivo', 'Carpeta', 'Tipo']],
      body: context.files.map((f, i) => [
        i + 1,
        f.nombre,
        f.carpeta,
        f.tipo
      ]),
      styles: {
        fontSize: 8,
        cellPadding: 3
      },
      headStyles: {
        fillColor: [46, 125, 50],
        textColor: 255,
        fontStyle: 'bold'
      },
      alternateRowStyles: {
        fillColor: [240, 248, 240]
      },
      margin: { left: 14, right: 14 }
    });
  }

  // ── Footer ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `ISER - Geovisor CDE Institucional  |  Página ${i} de ${pageCount}`,
      105, 290,
      { align: 'center' }
    );
  }

  doc.save(`Informe_Mantenimiento_${blockId}.pdf`);
}

/**
 * Initialize the Mantenimiento module.
 */
export function initMantenimiento() {
  formEl = document.getElementById('mant-form');
  bloqueSelect = document.getElementById('mant-bloque');
  estadoSelect = document.getElementById('mant-estado');
  fechaInput = document.getElementById('mant-fecha');
  diagnosticoArea = document.getElementById('mant-diagnostico');
  recomendacionesArea = document.getElementById('mant-recomendaciones');
  btnIA = document.getElementById('mant-btn-ia');
  btnPDF = document.getElementById('mant-btn-pdf');
  spinnerOverlay = document.getElementById('mant-spinner-overlay');
  contextSummary = document.getElementById('mant-context-summary');
  contextList = document.getElementById('mant-context-list');

  if (!bloqueSelect) return;

  // Populate block selector from campus data
  const campusData = getCampusData();
  if (campusData) {
    Object.entries(campusData).forEach(([id, data]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = data.name || id;
      bloqueSelect.appendChild(opt);
    });
  }

  // Set today's date as default
  if (fechaInput) {
    fechaInput.value = new Date().toISOString().slice(0, 10);
  }

  // ── Block selection change ──
  bloqueSelect.addEventListener('change', () => {
    const blockId = bloqueSelect.value;
    const hasBlock = !!blockId;
    btnIA.disabled = !hasBlock;
    btnPDF.disabled = !hasBlock;
    diagnosticoArea.value = '';

    if (hasBlock) {
      renderContextSummary(blockId);
    } else {
      contextSummary.style.display = 'none';
    }
  });

  // ── Generate AI Diagnosis ──
  btnIA.addEventListener('click', () => {
    const blockId = bloqueSelect.value;
    if (!blockId) return;

    // Show spinner overlay
    spinnerOverlay.style.display = 'flex';
    btnIA.disabled = true;

    // Simulate AI processing time (1.5-3s)
    const delay = 1500 + Math.random() * 1500;
    setTimeout(() => {
      const diagnosis = buildAIPrompt(blockId);
      diagnosticoArea.value = diagnosis;
      spinnerOverlay.style.display = 'none';
      btnIA.disabled = false;
    }, delay);
  });

  // ── Export PDF ──
  btnPDF.addEventListener('click', () => {
    const blockId = bloqueSelect.value;
    if (!blockId) return;
    exportarInformeOficial();
  });

  console.log('🔧 Módulo de Mantenimiento inicializado.');
}
