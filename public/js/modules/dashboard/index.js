/**
 * Módulo Dashboard estadístico mejorado.
 * Métricas avanzadas del campus con visualizaciones interactivas.
 */
import { on, EVENTS } from '../../core/events.js';
import { state } from '../../core/state.js';
import { getCampusData } from '../../campus-data.js';

let container = null;

/**
 * Calcula estadísticas básicas desde archivosNube.
 */
function computeStats() {
  const blockId = state.currentBlockId;
  const allArchivos = state.archivosNube || [];
  const archivos = blockId && blockId !== 'admin' && blockId !== 'visitor' ? allArchivos.filter(a => String(a.bloque || '') === String(blockId)) : allArchivos;
  
  const byBlock = {};
  const byType = {};
  archivos.forEach(a => {
    byBlock[a.bloque] = (byBlock[a.bloque] || 0) + 1;
    byType[a.tipo] = (byType[a.tipo] || 0) + 1;
  });
  return {
    total: archivos.length,
    byBlock,
    byType,
    blocks: Object.keys(byBlock).length
  };
}

/**
 * Calcula métricas avanzadas del campus.
 */
function computeCampusMetrics() {
  const campusData = getCampusData();
  const stats = computeStats();
  
  // Métricas de área y ocupación
  let totalArea = 0;
  let totalRooms = 0;
  let constructionTypes = {};
  let roofTypes = {};
  
  Object.values(campusData).forEach(block => {
    if (block.info) {
      totalArea += block.info.area;
      totalRooms += block.info.rooms;
      constructionTypes[block.info.construction] = (constructionTypes[block.info.construction] || 0) + 1;
      roofTypes[block.info.roof] = (roofTypes[block.info.roof] || 0) + 1;
    }
  });
  
  // Bloque más activo (más archivos)
  const mostActiveBlock = Object.entries(stats.byBlock)
    .sort(([,a], [,b]) => b - a)[0];
  
  // Tasa de ocupación (simulada)
  const occupancyRate = Math.round((totalRooms / (totalRooms + 15)) * 100);
  
  return {
    totalArea: totalArea.toFixed(2),
    totalRooms,
    totalBlocks: Object.keys(campusData).length,
    occupancyRate,
    mostActiveBlock: mostActiveBlock ? mostActiveBlock[0] : 'N/A',
    mostActiveCount: mostActiveBlock ? mostActiveBlock[1] : 0,
    constructionTypes,
    roofTypes,
    avgAreaPerBlock: (totalArea / Object.keys(campusData).length).toFixed(2)
  };
}

/**
 * Genera HTML para tarjeta de métrica con animación.
 */
function createMetricCard(title, value, subtitle = '', icon = '', color = 'blue') {
  const colors = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700'
  };
  
  return `
    <div class="metric-card ${colors[color]} rounded-xl p-4 border transition-all duration-300 hover:shadow-md hover:scale-[1.02] cursor-pointer">
      <div class="flex items-start justify-between mb-2">
        <div class="flex-1">
          <p class="text-xs font-bold uppercase opacity-80">${title}</p>
          <p class="text-2xl font-bold mt-1">${value}</p>
          ${subtitle ? `<p class="text-xs opacity-70 mt-1">${subtitle}</p>` : ''}
        </div>
        ${icon ? `<div class="text-2xl opacity-60">${icon}</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * Genera gráfico de barras simple para tipos de construcción.
 */
function createBarChart(data, title) {
  const maxValue = Math.max(...Object.values(data));
  return `
    <div class="bg-white rounded-xl p-4 border border-slate-200">
      <h3 class="text-sm font-bold text-slate-700 mb-3">${title}</h3>
      <div class="space-y-2">
        ${Object.entries(data).map(([label, value]) => `
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-600 w-24 truncate">${label}</span>
            <div class="flex-1 bg-slate-100 rounded-full h-4 relative overflow-hidden">
              <div class="bg-blue-500 h-full rounded-full transition-all duration-500 ease-out" 
                   style="width: ${(value / maxValue) * 100}%"></div>
            </div>
            <span class="text-xs font-bold text-slate-700 w-8 text-right">${value}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * Generar lista de bloques más activos.
 */
function createActiveBlocksList() {
  const stats = computeStats();
  const campusData = getCampusData();
  
  return Object.entries(stats.byBlock)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([blockId, count]) => {
      const block = campusData[blockId];
      return `
        <div class="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg transition-colors">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full" style="background-color: ${block?.color || '#64748B'}"></div>
            <span class="text-sm font-medium text-slate-700">${block?.name || blockId}</span>
          </div>
          <span class="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-full font-bold">${count}</span>
        </div>
      `;
    }).join('');
}

/**
 * Inicializa el dashboard (lazy).
 */
export async function init() {
  container = document.getElementById('dashboard-container');
  if (!container) return;

  on(EVENTS.FIRESTORE_SYNC, render);
  on(EVENTS.BLOCK_SELECTED, render);
  render();
}

function render() {
  const stats = computeStats();
  const metrics = computeCampusMetrics();
  
  container.innerHTML = `
    <!-- Métricas Principales -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${createMetricCard('Total Documentos', stats.total, 'en todos los bloques', '📄', 'blue')}
      ${createMetricCard('Área Total', `${metrics.totalArea} m²`, `${metrics.totalBlocks} bloques`, '🏗️', 'green')}
      ${createMetricCard('Salones', metrics.totalRooms, `${metrics.occupancyRate}% ocupación`, '🚪', 'purple')}
      ${createMetricCard('Bloque Activo', metrics.mostActiveBlock, `${metrics.mostActiveCount} archivos`, '⭐', 'amber')}
    </div>
    
    <!-- Gráficos y Listas -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      ${createBarChart(metrics.constructionTypes, 'Tipos de Construcción')}
      ${createBarChart(metrics.roofTypes, 'Tipos de Cubierta')}
    </div>
    
    <!-- Top Bloques Activos -->
    <div class="mt-6 bg-white rounded-xl p-4 border border-slate-200">
      <h3 class="text-sm font-bold text-slate-700 mb-3">🔥 Bloques Más Activos</h3>
      <div class="space-y-1">
        ${createActiveBlocksList()}
      </div>
    </div>
    
    <!-- Estadísticas Adicionales -->
    <div class="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg p-3 border border-slate-200">
        <p class="text-xs text-slate-500">Área Promedio</p>
        <p class="text-lg font-bold text-slate-800">${metrics.avgAreaPerBlock} m²</p>
      </div>
      <div class="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200">
        <p class="text-xs text-blue-500">Bloques con Datos</p>
        <p class="text-lg font-bold text-blue-800">${stats.blocks}/${metrics.totalBlocks}</p>
      </div>
      <div class="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 border border-green-200">
        <p class="text-xs text-green-500">Tipos de Archivo</p>
        <p class="text-lg font-bold text-green-800">${Object.keys(stats.byType).length}</p>
      </div>
      <div class="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3 border border-purple-200">
        <p class="text-xs text-purple-500">Eficiencia</p>
        <p class="text-lg font-bold text-purple-800">${Math.round((stats.total / metrics.totalBlocks) * 10) / 10}</p>
      </div>
    </div>
  `;
  
  // Agregar interacciones después de renderizar
  addInteractions();
}

/**
 * Agrega interacciones a las tarjetas de métricas.
 */
function addInteractions() {
  const cards = container.querySelectorAll('.metric-card');
  cards.forEach(card => {
    card.addEventListener('click', function() {
      // Efecto de ripple sutil
      this.style.transform = 'scale(0.98)';
      setTimeout(() => {
        this.style.transform = '';
      }, 150);
    });
  });
  
  // Animar las barras cuando aparecen
  setTimeout(() => {
    const bars = container.querySelectorAll('.bg-blue-500');
    bars.forEach((bar, index) => {
      setTimeout(() => {
        bar.style.width = bar.style.width;
      }, index * 100);
    });
  }, 100);
}
