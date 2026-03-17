/**
 * Módulo de Mantenimiento — Diagnóstico técnico asistido por IA.
 * Recopila contexto de archivos, genera diagnósticos simulados,
 * y exporta informes oficiales en PDF con jsPDF.
 */
import { state } from './core/state.js';
import { getCampusData } from './campus-data.js';
import { getFilesInPath } from './services/fileMapper.js';
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── DOM References ───
let formEl, bloqueSelect, estadoSelect, fechaInput;
let diagnosticoArea, recomendacionesArea;
let btnIA, btnPDF, spinnerOverlay;
let contextSummary, contextList;
let chartDist = null;
let chartEstado = null;

// ─── Relevant folders for AI context ───
const AI_CONTEXT_PATHS = [
  { path: '01_Arquitectonico', label: 'Arquitectónico' },
  { path: '02_Estructural', label: 'Estructural' },
  { path: '03_Electricos_y_Red_de_Datos', label: 'Eléctricos y Redes' },
  { path: '04_Hidrosanitarios', label: 'Hidrosanitarios' },
  { path: '06_Documentos', label: 'Documentos' },
  { path: '07_Matriz_Accesibilidad_NTC_6047', label: 'Accesibilidad' },
  { path: '08_Registro_Fotografico', label: 'Fotografías' }
];

// ─── GEMINI API KEY ───
// TODO: Pegar la API Key de Google AI Studio aquí.
const GEMINI_API_KEY = "AIzaSyBtW6xf9FLNN7j8wwy9jpg0PUuOaz6Vz-8";

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
        url: f.url,
        tamaño: f.tamaño,
        tipoMime: f.tipoMime,
        fecha: f.fechaSubida || f.fechaCreacion || f.fecha || '--'
      });
    });
  });

  const summary = allContextFiles.length > 0
    ? `Se encontraron ${allContextFiles.length} archivo(s) relevantes en ${blockName}.`
    : `No se encontraron archivos de contexto para ${blockName}.`;

  return { files: allContextFiles, summary, blockName };
}

/**
 * Generate a diagnosis using Google Gemini SDK.
 */
async function generateAIDiagnosis(blockId, context) {
  if (!GEMINI_API_KEY) {
    throw new Error('La API Key de Gemini no está configurada.');
  }

  const campusData = getCampusData();
  const blockInfo = campusData?.[blockId]?.info || {};
  const blockName = campusData?.[blockId]?.name || blockId;
  const estado = estadoSelect?.value || 'regular';
  const fecha = fechaInput?.value || 'No registrada';

  // Actualizar UI del spinner si existe
  const spinnerText = document.querySelector('.mant-spinner-text');
  if (spinnerText) spinnerText.textContent = "Extrayendo y analizando contenido de documentos técnicos...";

  const parts = [];
  let textoEstructurado = `
Actúa como un Auditor Técnico de Infraestructura del ISER evaluando el bloque: ${blockName}.
Estado general reportado: ${estado.toUpperCase()}. Fecha de inspección: ${fecha}.
Datos de construcción: Área ${blockInfo.area || '--'} m², Recintos ${blockInfo.rooms || '--'}, Sistema ${blockInfo.construction || '--'}.

INSTRUCCIÓN ESPECIAL DE CONTENIDO:
Analiza el contenido de estos documentos técnicos (PDF/Excel) adjuntos y las metadata de los modelos 3D. 
No te limites a los nombres de los archivos; busca datos específicos de áreas, materiales, observaciones y cumplimiento de normas dentro de ellos. 
Para los archivos 3D (.rvt, .dwg), evalúa la actualización de los modelos basándote en su fecha y tamaño.

Documentos disponibles en el sistema:
`;

  // Helpers de Extracción
  const fetchAsBase64 = async (url) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  };

  const extractExcel = async (url) => {
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      return window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]).substring(0, 3000);
    } catch { return null; }
  };

  let extractPDFsCount = 0;
  
  for (const f of context.files) {
    const sizeMB = f.tamaño ? (f.tamaño / (1024 * 1024)).toFixed(2) + ' MB' : 'Desconocido';
    const dateObj = typeof f.fecha?.toDate === 'function' ? f.fecha.toDate() : new Date(f.fecha);
    const dateStr = !isNaN(dateObj) ? dateObj.toLocaleDateString() : f.fecha;
    
    textoEstructurado += `- [${f.carpeta}] ${f.nombre} (${f.tipo.toUpperCase()} | ${sizeMB} | Modif: ${dateStr})\n`;
    
    if (f.tipo.toUpperCase() === 'PDF' && f.url && extractPDFsCount < 3) {
      extractPDFsCount++;
      const b64 = await fetchAsBase64(f.url);
      if (b64) {
        parts.push({
          inlineData: {
            data: b64,
            mimeType: "application/pdf"
          }
        });
      } else {
        textoEstructurado += `  *(Note: Fallo al extraer PDF)*\n`;
      }
    } else if (f.tipo.toUpperCase() === 'EXCEL' && f.url && window.XLSX) {
      const csv = await extractExcel(f.url);
      if (csv) {
        textoEstructurado += `--- Contenido extraído de ${f.nombre} ---\n${csv}\n----------------------------------------\n`;
      }
    } else if (['RVT','DWG','SKP','IFC'].includes(f.tipo.toUpperCase())) {
      textoEstructurado += `  *(Modelo BIM. Evaluar vigencia según fecha ${dateStr} y peso ${sizeMB})*\n`;
    }
  }

  textoEstructurado += `
Tu tarea es proveer un análisis estructurado. Devuelve EXCLUSIVAMENTE un bloque JSON de formato válido.
Estructura exacta:
{
  "diagnostico_texto": "RESUMEN EJECUTIVO (3 o 4 párrafos). 1. Diagnóstico general basado en los reportes, estado y planos extraídos. 2. Análisis del CONTENIDO de los documentos extraídos. 3. Reseña técnica de los archivos 3D detectados. 4. Recomendaciones.",
  "distribucion_archivos": { "Planos 3D": X, "Documentos PDF/Excel": Y, "Fotos": Z },
  "estado_mantenimiento": { "preventivo": "70", "correctivo": "30" }
}
IMPORTANTE: Asigna valores numéricos reales sin "%". La suma de preventivo y correctivo debe ser 100.
`;

  parts.unshift(textoEstructurado); // Agregar el texto como primer parte

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    
    // Parse response
    const parseJSON = (text) => {
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : text;
      return JSON.parse(jsonStr.trim());
    };

    // Intento 1: Modelo más reciente (Gemini 2.5 Flash)
    try {
      const model = genAI.getGenerativeModel(
        { model: "gemini-2.5-flash" },
        { apiVersion: "v1" }
      );
      const result = await model.generateContent(parts);
      return parseJSON(result.response.text());
    } catch (e1) {
      console.warn("Gemini 2.5 Flash falló, intentando fallback a 1.5-flash-latest...", e1);
      
      // Intento 2: Fallback al modelo 1.5 Flash Latest
      const fallbackModel = genAI.getGenerativeModel(
        { model: "gemini-1.5-flash-latest" },
        { apiVersion: "v1" }
      );
      const result = await fallbackModel.generateContent(parts);
      return parseJSON(result.response.text());
    }
  } catch (error) {
    console.error("Gemini SDK Error Final:", error);
    throw new Error("Error procesando analítica predictiva. Revisa consola.");
  }
}

/**
 * Render Chart.js graphs based on Gemini JSON analytics
 */
function renderMantCharts(data) {
  const container = document.getElementById('mant-charts-container');
  if (!data || !data.distribucion_archivos || !data.estado_mantenimiento) {
    if (container) container.style.display = 'none';
    return;
  }
  if (container) container.style.display = 'block';

  const ctxDist = document.getElementById('mant-chart-dist');
  if (chartDist) chartDist.destroy();
  if (ctxDist) {
    chartDist = new Chart(ctxDist, {
      type: 'doughnut',
      data: {
        labels: Object.keys(data.distribucion_archivos),
        datasets: [{
          data: Object.values(data.distribucion_archivos),
          backgroundColor: ['#2E7D32', '#1976D2', '#D32F2F', '#F9A825', '#00ACC1']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Distribución Analítica Doc.' } } }
    });
  }

  const ctxEst = document.getElementById('mant-chart-estado');
  if (chartEstado) chartEstado.destroy();
  if (ctxEst) {
    chartEstado = new Chart(ctxEst, {
      type: 'bar',
      data: {
        labels: Object.keys(data.estado_mantenimiento),
        datasets: [{
          label: '%',
          data: Object.values(data.estado_mantenimiento),
          backgroundColor: ['#1976D2', '#D32F2F']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Probabilidad Mantenimiento' }, legend: {display: false} } }
    });
  }
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

  let currentY = infoY + 42 + (splitDiag.length * 4);

  // ── Charts (Analítica) ──
  const chartContainer = document.getElementById('mant-charts-container');
  if (chartContainer && chartContainer.style.display !== 'none') {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Analítica Predictiva', 14, currentY);

    const canvasDist = document.getElementById('mant-chart-dist');
    const canvasEst = document.getElementById('mant-chart-estado');
    let hasCharts = false;

    if (canvasDist) {
      const imgDist = canvasDist.toDataURL('image/png', 1.0);
      doc.addImage(imgDist, 'PNG', 14, currentY + 6, 80, 50);
      hasCharts = true;
    }
    if (canvasEst) {
      const imgEst = canvasEst.toDataURL('image/png', 1.0);
      doc.addImage(imgEst, 'PNG', 104, currentY + 6, 80, 50);
      hasCharts = true;
    }

    if (hasCharts) {
      currentY += 66; // 6 + 50 + 10 padding
    }
  }

  // ── Recomendaciones ──
  const recoY = currentY;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Recomendaciones Técnicas', 14, recoY);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const recoText = recomendacionesArea?.value || 'Sin recomendaciones adicionales.';
  const splitReco = doc.splitTextToSize(recoText, 180);
  doc.text(splitReco, 14, recoY + 8);

  // ── File Table (Summary Format) ──
  if (context.files.length > 0) {
    const tableY = recoY + 12 + (splitReco.length * 4);

    // Group files by folder
    const folderGroups = {};
    context.files.forEach(f => {
      if (!folderGroups[f.carpeta]) folderGroups[f.carpeta] = [];
      folderGroups[f.carpeta].push(f);
    });

    const tableData = [];
    Object.entries(folderGroups).forEach(([folder, files]) => {
      const count = files.length;
      if (count < 5) {
        // Less than 5 files: list them individually
        tableData.push([{ content: folder, rowSpan: count }, files[0].nombre, 'Disponible']);
        for (let i = 1; i < count; i++) {
          tableData.push([files[i].nombre, 'Disponible']);
        }
      } else {
        // 5 or more files: summarize
        tableData.push([folder, `${count} archivo(s) en total`, 'Completo']);
      }
    });

    doc.autoTable({
      startY: tableY,
      head: [['Categoría / Carpeta', 'Documentación', 'Estado Info']],
      body: tableData,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [46, 125, 50], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 248, 240] },
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
    renderMantCharts(null); // Clear charts on change
  });

  // ── Generate AI Diagnosis ──
  btnIA.addEventListener('click', async () => {
    const blockId = bloqueSelect.value;
    if (!blockId) return;

    if (!GEMINI_API_KEY) {
      alert("Atención: Debes configurar la API_KEY de Gemini en mantenimiento.js para generar sugerencias reales.");
      return;
    }

    spinnerOverlay.style.display = 'flex';
    btnIA.disabled = true;

    try {
      const context = getContextForAI(blockId);
      const diagnosisData = await generateAIDiagnosis(blockId, context);
      
      diagnosticoArea.value = diagnosisData.diagnostico_texto || "No se generó texto de diagnóstico.";
      renderMantCharts(diagnosisData);
    } catch (e) {
      alert(e.message || "Ocurrió un error generando el diagnóstico.");
      diagnosticoArea.value = "Error en analítica. Validación manual requerida.";
    } finally {
      spinnerOverlay.style.display = 'none';
      const spinnerText = document.querySelector('.mant-spinner-text');
      if (spinnerText) spinnerText.textContent = "Analizando planos y fotografías del bloque...";
      btnIA.disabled = false;
    }
  });

  // ── Export PDF ──
  btnPDF.addEventListener('click', () => {
    const blockId = bloqueSelect.value;
    if (!blockId) return;
    exportarInformeOficial();
  });

  console.log('🔧 Módulo de Mantenimiento inicializado.');
}
