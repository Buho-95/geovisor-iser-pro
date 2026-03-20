/**
 * Estructura Profesional de Planoteca ISER
 * Sistema jerárquico de carpetas y especialidades
 */
import { Logger } from './core/logger.js';

export const estructuraPlanimetriaISER = {
  "01_Arquitectonico": {
    "subcarpetas": ["01_Modelos_2D_AutoCAD", "02_Modelo_3D_SketchUP", "03_Entregables_PDF", "04_Modelo_BIM_Revit", "05_Varios"],
    "icono": "ph-buildings",
    "color": "#3B82F6",
    "descripcion": "Planos arquitectónicos y modelos 3D del proyecto"
  },
  "02_Estructural": {
    "subcarpetas": ["01_Modelos_2D_AutoCAD", "02_Modelo_3D_SketchUP", "03_Entregables_PDF", "04_Modelo_BIM_Revit", "05_Varios"],
    "icono": "ph-structure",
    "color": "#10B981",
    "descripcion": "Diseño estructural y cálculos de resistencia"
  },
  "03_Electricos_y_Red_de_Datos": {
    "especialidades": {
      "01_Electricos": ["01_Modelos_2D_AutoCAD", "02_Entregables_PDF", "03_Documentacion_Legal", "04_Varios"],
      "02_Redes_de_Datos": ["01_Modelos_2D_AutoCAD", "02_Entregables_PDF", "03_Documentacion_Legal", "04_Varios"]
    },
    "icono": "ph-plug",
    "color": "#6366F1",
    "descripcion": "Sistemas eléctricos y de datos"
  },
  "04_Hidrosanitarios_y_Gas": {
    "especialidades": {
      "01_Gas": ["01_Modelos_2D_AutoCAD", "02_Modelo_3D_SketchUP", "03_Entregables_PDF", "04_Modelo_BIM_Revit", "05_Varios"],
      "02_Hidrosanitarios": ["01_Modelos_2D_AutoCAD", "02_Modelo_3D_SketchUP", "03_Entregables_PDF", "04_Modelo_BIM_Revit", "05_Varios"]
    },
    "icono": "ph-pipe",
    "color": "#14B8A6",
    "descripcion": "Instalaciones hidrosanitarias y de gas"
  },
  "05_Renders_y_Presentaciones": {
    "especialidades": {
      "01_Renders": [],
      "02_Presentaciones": []
    },
    "icono": "ph-image",
    "color": "#EC4899",
    "descripcion": "Visualizaciones 3D y material de presentación"
  },
  "06_Documentos": {
    "subcarpetas": ["Certificados", "Licencias", "Actas", "Otros"],
    "icono": "ph-file-text",
    "color": "#64748B",
    "descripcion": "Documentación técnica y legal del proyecto"
  },
  "07_Matriz_Accesibilidad_NTC_6047": {
    "tipo": "directo",
    "icono": "ph-accessibility",
    "color": "#84CC16",
    "descripcion": "Matriz de accesibilidad conforme a NTC 6047"
  },
  "08_Registro_Fotografico": {
    "especialidades": {
      "01_2025": [],
      "02_2026_1": []
    },
    "icono": "ph-camera",
    "color": "#F97316",
    "descripcion": "Registro fotográfico del avance de obra"
  }
};

/**
 * Obtiene la estructura completa de carpetas para un bloque
 * @param {string} blockId - ID del bloque
 * @returns {Array} Array de carpetas con su estructura jerárquica
 */
export function getEstructuraCarpetas(blockId = null) {
  const carpetas = [];

  Object.entries(estructuraPlanimetriaISER).forEach(([clave, datos]) => {
    const carpeta = {
      id: clave,
      nombre: formatearNombreCarpeta(clave),
      icono: datos.icono,
      color: datos.color,
      descripcion: datos.descripcion,
      bloqueId: blockId
    };

    if (datos.tipo === 'directo') {
      // Carpetas directas (sin subcarpetas)
      carpeta.tipo = 'directo';
      carpeta.ruta = clave;
    } else if (datos.especialidades) {
      // Carpetas con especialidades
      carpeta.tipo = 'especialidades';
      carpeta.especialidades = [];

      Object.entries(datos.especialidades).forEach(([espClave, espDatos]) => {
        const especialidad = {
          id: espClave,
          nombre: formatearNombreCarpeta(espClave),
          icono: obtenerIconoEspecialidad(espClave),
          color: datos.color,
          descripcion: obtenerDescripcionEspecialidad(espClave),
          subcarpetas: espDatos.map(sub => ({
            id: `${clave}/${espClave}/${sub}`,
            nombre: formatearNombreCarpeta(sub),
            ruta: `${clave}/${espClave}/${sub}`,
            icono: obtenerIconoSubcarpeta(sub),
            color: datos.color
          }))
        };
        carpeta.especialidades.push(especialidad);
      });
    } else if (datos.subcarpetas) {
      // Carpetas con subcarpetas directas
      carpeta.tipo = 'subcarpetas';
      carpeta.subcarpetas = datos.subcarpetas.map(sub => ({
        id: `${clave}/${sub}`,
        nombre: formatearNombreCarpeta(sub),
        ruta: `${clave}/${sub}`,
        icono: obtenerIconoSubcarpeta(sub),
        color: datos.color
      }));
    }

    carpetas.push(carpeta);
  });

  return carpetas;
}

/**
 * Formatea el nombre de la carpeta para mostrar
 * @param {string} clave - Clave de la carpeta
 * @returns {string} Nombre formateado
 */
export function formatearNombreCarpeta(clave) {
  const reemplazos = {
    "01_Arquitectonico": "01 Arquitectónico",
    "02_Estructural": "02 Estructural",
    "03_Electricos_y_Red_de_Datos": "03 Eléctricos y Red de Datos",
    "04_Hidrosanitarios_y_Gas": "04 Hidrosanitarios y Gas",
    "05_Renders_y_Presentaciones": "05 Renders y Presentaciones",
    "06_Documentos": "06 Documentos",
    "07_Matriz_Accesibilidad_NTC_6047": "07 Matriz de Accesibilidad NTC 6047",
    "08_Registro_Fotografico": "08 Registro Fotográfico",
    "01_Modelos_2D_AutoCAD": "Modelos 2D AutoCAD",
    "02_Modelo_3D_SketchUP": "Modelo 3D SketchUP",
    "03_Entregables_PDF": "Entregables PDF",
    "04_Modelo_BIM_Revit": "Modelo BIM Revit",
    "05_Varios": "Varios",
    "01_Renders": "Renders",
    "02_Presentaciones": "Presentaciones",
    "01_2025": "2025",
    "02_2026_1": "2026 - Periodo 1",
    "01_Electricos": "Eléctricos",
    "02_Redes_de_Datos": "Redes de Datos",
    "01_Gas": "Gas",
    "02_Hidrosanitarios": "Hidrosanitarios",
    "Certificados": "Certificados",
    "Licencias": "Licencias",
    "Actas": "Actas",
    "Otros": "Otros"
  };

  return reemplazos[clave] || clave.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Obtiene el icono adecuado para una especialidad
 * @param {string} especialidad - Nombre de la especialidad
 * @returns {string} Clase del icono
 */
function obtenerIconoEspecialidad(especialidad) {
  const iconos = {
    "01_Electricos": "ph-lightning",
    "02_Redes_de_Datos": "ph-network",
    "01_Gas": "ph-fire",
    "02_Hidrosanitarios": "ph-drop",
    "01_Renders": "ph-image",
    "02_Presentaciones": "ph-presentation",
    "01_2025": "ph-calendar",
    "02_2026_1": "ph-calendar"
  };

  return iconos[especialidad] || "ph-folder";
}

/**
 * Obtiene la descripción para una especialidad
 * @param {string} especialidad - Nombre de la especialidad
 * @returns {string} Descripción de la especialidad
 */
function obtenerDescripcionEspecialidad(especialidad) {
  const descripciones = {
    "01_Electricos": "Sistemas eléctricos y alumbrado",
    "02_Redes_de_Datos": "Infraestructura de redes y telecomunicaciones",
    "01_Gas": "Instalaciones de gas natural y GLP",
    "02_Hidrosanitarios": "Sistemas hidráulicos y sanitarios",
    "01_Renders": "Visualizaciones 3D fotorealísticas",
    "02_Presentaciones": "Material de presentación y documentación",
    "01_2025": "Registro fotográfico año 2025",
    "02_2026_1": "Registro fotográfico 2026 - Periodo 1"
  };

  return descripciones[especialidad] || "Especialidad";
}

/**
 * Obtiene el icono adecuado para una subcarpeta
 * @param {string} subcarpeta - Nombre de la subcarpeta
 * @returns {string} Clase del icono
 */
function obtenerIconoSubcarpeta(subcarpeta) {
  const iconos = {
    "01_Modelos_2D_AutoCAD": "ph-pencil-ruler",
    "02_Modelo_3D_SketchUP": "ph-cube",
    "03_Entregables_PDF": "ph-file-pdf",
    "04_Modelo_BIM_Revit": "ph-buildings",
    "05_Varios": "ph-dots-three",
    "01_Renders": "ph-image",
    "02_Presentaciones": "ph-presentation",
    "01_2025": "ph-calendar",
    "02_2026_1": "ph-calendar",
    "Certificados": "ph-certificate",
    "Licencias": "ph-stamp",
    "Actas": "ph-clipboard-text",
    "Otros": "ph-dots-three"
  };

  return iconos[subcarpeta] || "ph-folder";
}

/**
 * Genera el HTML para el menú de carpetas de la planoteca
 * @param {string} blockId - ID del bloque seleccionado
 * @returns {string} HTML del menú de carpetas
 */
export function generarMenuPlanoteca(blockId) {
  const carpetas = getEstructuraCarpetas(blockId);

  let html = `
    <div class="planoteca-menu">
      <div class="mb-4">
        <h3 class="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
          <i class="ph ph-folder-open text-blue-600"></i>
          Planoteca Estructurada
        </h3>
        <p class="text-sm text-slate-600">Navegación profesional por categorías y especialidades</p>
      </div>
      
      <div class="space-y-3">
  `;

  carpetas.forEach(carpeta => {
    html += generarCarpetaHTML(carpeta);
  });

  html += `
      </div>
    </div>
  `;

  return html;
}

/**
 * Genera el HTML para una carpeta individual
 * @param {Object} carpeta - Datos de la carpeta
 * @returns {string} HTML de la carpeta
 */
function generarCarpetaHTML(carpeta) {
  let html = `
    <div class="carpeta-principal border border-slate-200 rounded-lg overflow-hidden transition-all duration-200 hover:shadow-md hover:border-slate-300">
      <div class="carpeta-header p-3 bg-slate-50 border-b border-slate-200 cursor-pointer flex items-center justify-between"
           onclick="toggleCarpeta('${carpeta.id}')">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center" 
               style="background-color: ${carpeta.color}20; color: ${carpeta.color}">
            <i class="${carpeta.icono} text-lg"></i>
          </div>
          <div>
            <h4 class="font-semibold text-slate-800">${carpeta.nombre}</h4>
            <p class="text-xs text-slate-500">${carpeta.descripcion}</p>
          </div>
        </div>
        <i class="ph ph-caret-down text-slate-400 transition-transform duration-200" id="icon-${carpeta.id}"></i>
      </div>
  `;

  // Contenido de la carpeta
  html += `<div class="carpeta-contenido hidden" id="contenido-${carpeta.id}">`;

  if (carpeta.tipo === 'directo') {
    html += `
      <div class="p-4 text-center text-slate-500 hover:bg-slate-50 cursor-pointer rounded-b-lg transition-colors" onclick="seleccionarSubcarpeta('${carpeta.ruta}', '${carpeta.nombre}')">
        <i class="ph ph-folder-simple text-3xl mb-2 text-blue-500"></i>
        <p class="text-sm font-medium text-slate-700">Ver Contenido</p>
        <p class="text-xs mt-1">Los archivos se organizan directamente aquí</p>
      </div>
      <div id="subcarpeta-container-${carpeta.id}" class="w-full"></div>
    `;
  } else if (carpeta.tipo === 'subcarpetas') {
    html += `
      <div class="p-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    `;
    carpeta.subcarpetas.forEach(subcarpeta => {
      html += generarSubcarpetaHTML(subcarpeta);
    });
    html += `
        </div>
      </div>
    `;
  } else if (carpeta.tipo === 'especialidades') {
    html += `
      <div class="p-4">
    `;
    carpeta.especialidades.forEach(especialidad => {
      html += `
        <div class="mb-4">
          <h5 class="font-medium text-slate-700 mb-3 flex items-center gap-2">
            <div class="w-6 h-6 rounded flex items-center justify-center" 
                 style="background-color: ${especialidad.color}20; color: ${especialidad.color}">
              <i class="${especialidad.icono} text-sm"></i>
            </div>
            ${especialidad.nombre}
          </h5>
      `;
      if (especialidad.subcarpetas && especialidad.subcarpetas.length > 0) {
        // Especialidades con subcarpetas técnicas
        html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 ml-8">`;
        especialidad.subcarpetas.forEach(subcarpeta => {
          html += generarSubcarpetaHTML(subcarpeta);
        });
        html += `</div>`;
      } else {
        // Especialidades directas (sin subcarpetas) - como Renders y Presentaciones
        const rutaDirecta = `${carpeta.id}/${especialidad.id}`;
        const safeId = rutaDirecta.replace(/\\/g, '/').replace(/[^a-zA-Z0-9]/g, '_');
        html += `
          <div class="flex flex-col mb-2 ml-8">
            <div class="subcarpeta-item p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition-all duration-200"
                 onclick="seleccionarSubcarpeta('${rutaDirecta}', '${especialidad.nombre}')">
              <div class="flex items-center gap-2">
                <i class="${especialidad.icono} text-slate-600"></i>
                <span class="text-sm font-medium text-slate-700">Ver Contenido</span>
              </div>
            </div>
            <div id="subcarpeta-container-${safeId}" class="w-full pl-6 pr-2"></div>
          </div>
        `;
      }
      html += `
        </div>
      `;
    });
    html += `
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

/**
 * Genera el HTML para una subcarpeta
 * @param {Object} subcarpeta - Datos de la subcarpeta
 * @returns {string} HTML de la subcarpeta
 */
function generarSubcarpetaHTML(subcarpeta) {
  const safeId = subcarpeta.ruta.replace(/\\/g, '/').replace(/[^a-zA-Z0-9]/g, '_');
  return `
    <div class="flex flex-col mb-2">
      <div class="subcarpeta-item p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition-all duration-200"
           onclick="seleccionarSubcarpeta('${subcarpeta.ruta}', '${subcarpeta.nombre}')">
        <div class="flex items-center gap-2">
          <i class="${subcarpeta.icono} text-slate-600"></i>
          <span class="text-sm font-medium text-slate-700">${subcarpeta.nombre}</span>
        </div>
      </div>
      <div id="subcarpeta-container-${safeId}" class="w-full pl-6 pr-2"></div>
    </div>
  `;
}

/**
 * Genera las opciones para el selector de carpetas de subida
 * @returns {string} HTML con las opciones del selector
 */
export function generarOpcionesCarpetasUpload() {
  let opciones = '<option value="">Selecciona una ubicación...</option>';

  Object.entries(estructuraPlanimetriaISER).forEach(([clave, datos]) => {
    if (datos.tipo === 'directo') {
      // Carpetas directas
      opciones += `<option value="${clave}">${formatearNombreCarpeta(clave)}</option>`;
    } else if (datos.subcarpetas) {
      // Carpetas con subcarpetas directas
      datos.subcarpetas.forEach(subcarpeta => {
        const ruta = `${clave}/${subcarpeta}`;
        const nombreMostrar = `${formatearNombreCarpeta(clave)} - ${formatearNombreCarpeta(subcarpeta)}`;
        opciones += `<option value="${ruta}">${nombreMostrar}</option>`;
      });
    } else if (datos.especialidades) {
      // Carpetas con especialidades
      Object.entries(datos.especialidades).forEach(([espClave, espDatos]) => {
        const nombreEsp = formatearNombreCarpeta(espClave);
        if (Array.isArray(espDatos) && espDatos.length > 0) {
          // Especialidades con subcarpetas
          espDatos.forEach(subcarpeta => {
            const ruta = `${clave}/${espClave}/${subcarpeta}`;
            const nombreMostrar = `${formatearNombreCarpeta(clave)} - ${nombreEsp} - ${formatearNombreCarpeta(subcarpeta)}`;
            opciones += `<option value="${ruta}">${nombreMostrar}</option>`;
          });
        } else {
          // Especialidades directas (sin subcarpetas)
          const ruta = `${clave}/${espClave}`;
          const nombreMostrar = `${formatearNombreCarpeta(clave)} - ${nombreEsp}`;
          opciones += `<option value="${ruta}">${nombreMostrar}</option>`;
        }
      });
    }
  });

  return opciones;
}

/**
 * Funciones globales para interacción del menú
 * Accordion exclusivo: solo una carpeta principal abierta a la vez
 */
window.toggleCarpeta = function (carpetaId) {
  const contenido = document.getElementById(`contenido-${carpetaId}`);
  const icono = document.getElementById(`icon-${carpetaId}`);
  if (!contenido || !icono) return;

  const isCurrentlyOpen = !contenido.classList.contains('hidden');

  // Close ALL open folders first
  document.querySelectorAll('.carpeta-contenido').forEach(c => {
    c.classList.add('hidden');
  });
  document.querySelectorAll('[id^="icon-"]').forEach(i => {
    i.classList.remove('rotate-180');
  });

  // If it was closed, open it (toggle behavior)
  if (!isCurrentlyOpen) {
    contenido.classList.remove('hidden');
    icono.classList.add('rotate-180');
    // Auto-cargar archivos para carpetas tipo 'directo' (ej: 07_Matriz_Accesibilidad)
    const directContainer = document.getElementById(`subcarpeta-container-${carpetaId}`);
    if (directContainer && directContainer.innerHTML.trim() === '') {
      seleccionarSubcarpeta(carpetaId, carpetaId);
    }
  }
};

window.seleccionarSubcarpeta = function (ruta, nombre) {
  Logger.debug('seleccionarSubcarpeta llamado:', { ruta, nombre });

  // Emitir evento para que otros componentes sepan qué subcarpeta se seleccionó
  const evento = new CustomEvent('subcarpetaSeleccionada', {
    detail: { ruta, nombre }
  });
  document.dispatchEvent(evento);

  Logger.debug('Evento subcarpetaSeleccionada despachado');
};
