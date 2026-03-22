/**
 * Datos estáticos del campus: bloques y coordenadas.
 * Usado por el mapa y por la UI del directorio.
 */
export const campusData = {
  admin: { 
    name: 'Bloque Administrativo', 
    color: '#3B82F6', 
    coords: [[7.371917, -72.646608], [7.371909, -72.646443], [7.371957, -72.646439], [7.371956, -72.646380], [7.372075, -72.646375], [7.372082, -72.646529], [7.371991, -72.646532], [7.371996, -72.646604]],
    info: {
      area: 450.00,
      rooms: 12,
      construction: 'Hormigón Armado',
      roof: 'Loseta de Concreto'
    }
  },
  labs: { 
    name: 'Laboratorios Alvaro Diez', 
    color: '#F59E0B', 
    coords: [[7.372135, -72.646864], [7.372125, -72.646685], [7.372344, -72.646681], [7.372342, -72.646655], [7.372433, -72.646653], [7.372442, -72.646821], [7.372222, -72.646833], [7.372220, -72.646857]],
    info: {
      area: 680.50,
      rooms: 8,
      construction: 'Hormigón Armado',
      roof: 'Loseta de Concreto'
    }
  },
  coliseo: { 
    name: 'Coliseo', 
    color: '#10B981', 
    coords: [[7.372481, -72.645867], [7.372149, -72.645726], [7.372287, -72.645410], [7.372612, -72.645548]],
    info: {
      area: 1200.00,
      rooms: 1,
      construction: 'Estructura Metálica',
      roof: 'Cubierta Metálica'
    }
  },
  bs: { 
    name: 'Bloque Sistemas BS', 
    color: '#8B5CF6', 
    coords: [[7.371359, -72.645538], [7.371351, -72.645264], [7.371583, -72.645257], [7.371593, -72.645528]],
    info: {
      area: 320.75,
      rooms: 6,
      construction: 'Hormigón Armado',
      roof: 'Loseta de Concreto'
    }
  },
  archivo: { 
    name: 'Bloque Archivo', 
    color: '#64748B', 
    coords: [[7.371693, -72.645525], [7.371615, -72.645525], [7.371610, -72.645306], [7.371751, -72.645301], [7.371758, -72.645395], [7.371681, -72.645404]],
    info: {
      area: 180.25,
      rooms: 4,
      construction: 'Mampostería Estructural',
      roof: 'Teja de Barro'
    }
  },
  ia: { 
    name: 'Bloque IA', 
    color: '#EC4899', 
    coords: [[7.371149, -72.646150], [7.371133, -72.645972], [7.371119, -72.645970], [7.371108, -72.645785], [7.371614, -72.645748], [7.371618, -72.645846], [7.371636, -72.646115]],
    info: {
      area: 520.00,
      rooms: 10,
      construction: 'Hormigón Armado',
      roof: 'Loseta de Concreto'
    }
  },
  ib: { 
    name: 'Bloque IB', 
    color: '#EC4899', 
    coords: [[7.371805, -72.645499], [7.371916, -72.645229], [7.371997, -72.645259], [7.372006, -72.645219], [7.372118, -72.644924], [7.372167, -72.644936], [7.372184, -72.644901], [7.372332, -72.644959], [7.372321, -72.645001], [7.372366, -72.645025], [7.372255, -72.645312], [7.372179, -72.645287], [7.372124, -72.645430], [7.372146, -72.645441], [7.372089, -72.645574], [7.372113, -72.645588], [7.372060, -72.645721], [7.371909, -72.645663], [7.371971, -72.645528], [7.371923, -72.645507], [7.371909, -72.645546]],
    info: {
      area: 750.30,
      rooms: 15,
      construction: 'Hormigón Armado',
      roof: 'Loseta de Concreto'
    }
  },
  ic: { 
    name: 'Bloque IC', 
    color: '#EC4899', 
    coords: [[7.372307, -72.644872], [7.372394, -72.644722], [7.372590, -72.644827], [7.372509, -72.644982]],
    info: {
      area: 280.90,
      rooms: 6,
      construction: 'Mampostería Estructural',
      roof: 'Teja de Barro'
    }
  },
  id: { 
    name: 'Bloque ID', 
    color: '#EC4899', 
    coords: [[7.372418, -72.645403], [7.372262, -72.645336], [7.372382, -72.645059], [7.372538, -72.645126]],
    info: {
      area: 310.60,
      rooms: 7,
      construction: 'Hormigón Armado',
      roof: 'Loseta de Concreto'
    }
  },
  campesina: { 
    name: 'Casa Campesina', 
    color: '#EF4444', 
    coords: [[7.372204, -72.644760], [7.372117, -72.644721], [7.372156, -72.644644], [7.372241, -72.644691]],
    info: {
      area: 95.40,
      rooms: 3,
      construction: 'Madera',
      roof: 'Teja de Barro'
    }
  },
  carpinteria: { 
    name: 'Carpinteria', 
    color: '#84CC16', 
    coords: [[7.372358, -72.644500], [7.372256, -72.644441], [7.372319, -72.644325], [7.372418, -72.644384]],
    info: {
      area: 120.80,
      rooms: 2,
      construction: 'Mampostería Estructural',
      roof: 'Zinc Galvanizado'
    }
  },
  porteria: { 
    name: 'Entrada Principal', 
    color: '#06B6D4', 
    coords: [[7.371226, -72.646623], [7.371061, -72.646553], [7.371095, -72.646489], [7.371258, -72.646559]],
    info: {
      area: 65.20,
      rooms: 2,
      construction: 'Hormigón Armado',
      roof: 'Terraza'
    }
  },
  torre: { 
    name: 'Torre de Alturas', 
    color: '#14B8A6', 
    coords: [[7.372438, -72.645397], [7.372547, -72.645133], [7.372731, -72.645216], [7.372625, -72.645485]],
    info: {
      area: 890.15,
      rooms: 20,
      construction: 'Hormigón Armado',
      roof: 'Loseta de Concreto'
    }
  },
  procesos_agro: { 
    name: 'Planta Procesos Agroindustriales', 
    color: '#EAB308', 
    coords: [[7.372440, -72.644674], [7.372329, -72.644614], [7.372453, -72.644379], [7.372535, -72.644422], [7.372489, -72.644512], [7.372514, -72.644529]],
    info: {
      area: 420.75,
      rooms: 5,
      construction: 'Estructura Metálica',
      roof: 'Cubierta Metálica'
    }
  },
  plastico: { 
    name: 'Planta de Plastico', 
    color: '#D946EF', 
    coords: [[7.372608, -72.644408], [7.372520, -72.644366], [7.372587, -72.644223], [7.372674, -72.644268]],
    info: {
      area: 185.60,
      rooms: 3,
      construction: 'Estructura Metálica',
      roof: 'Cubierta Liviana'
    }
  }
};

// ═══════════════════════════════════════════════════════
// 🗺️ DATOS DE SEDES — Multi-Campus
// ═══════════════════════════════════════════════════════
export const sedesData = {
  pamplona: {
    name: 'Sede Principal - Pamplona',
    center: [7.3765, -72.6480],
    zoom: 18,
    perimetro: [
      [7.371003, -72.646601], [7.371118, -72.646402], [7.370813, -72.646159],
      [7.370791, -72.646131], [7.370874, -72.645977], [7.371062, -72.645297],
      [7.371254, -72.644596], [7.371564, -72.643950], [7.372066, -72.643161],
      [7.372669, -72.642252], [7.373628, -72.643181], [7.373147, -72.643978],
      [7.373362, -72.644271], [7.373871, -72.644822], [7.373482, -72.645198],
      [7.373208, -72.646014], [7.373087, -72.646295], [7.373085, -72.646324],
      [7.372502, -72.647164], [7.371686, -72.646522], [7.371246, -72.646612],
      [7.371164, -72.646733], [7.371003, -72.646601]
    ],
    perimetroStyle: { color: '#FDE047', weight: 3, dashArray: '10, 8', fillColor: '#FDE047', fillOpacity: 0.05 },
    blocks: campusData // usa los bloques existentes
  },

  rinconada: {
    name: 'Granja La Rinconada - Pamplona',
    center: [7.3715, -72.6430],
    zoom: 17,
    type: 'perimeter', // Solo perímetro, sin bloques interactivos
    perimetro: [
      [7.372658656378505, -72.64046343963831],
      [7.373345413259145, -72.64103001623423],
      [7.373152440317455, -72.64131044310699],
      [7.372828926719706, -72.64171105285233],
      [7.371765420993455, -72.64328872642552],
      [7.371080677255847, -72.64450921905684],
      [7.370783262888608, -72.64559720117782],
      [7.370679513674673, -72.64608539822980],
      [7.370319849547883, -72.64530428294597],
      [7.370188433736260, -72.64471147223973],
      [7.370119267789505, -72.64386758860651],
      [7.370406159477440, -72.64311873413997],
      [7.370745073754762, -72.64274909921315],
      [7.370855739548205, -72.64235854156917],
      [7.370938738887290, -72.64200982938864],
      [7.371457484408822, -72.64136819897915],
      [7.371808766285540, -72.64116599724274],
      [7.371960931402000, -72.64105440934479],
      [7.372382843496723, -72.64089400174186],
      [7.372707923033559, -72.64075451686985],
      [7.372658656378505, -72.64046343963831]
    ],
    perimetroStyle: { color: '#ff9800', weight: 3, dashArray: '8, 6', fillColor: '#ff9800', fillOpacity: 0.1 },
    tooltipText: 'Perímetro Granja La Rinconada',
    blocks: {} // Sin bloques — solo perímetro
  },

  caldera: {
    name: 'Finca La Caldera - Mutiscua',
    center: [7.3329, -72.7318],
    zoom: 18,
    type: 'block', // Bloque interactivo con mini-visor
    perimetro: null, // Sin perímetro separado; el bloque ES el predio
    blocks: {
      finca_caldera: {
        name: 'Finca La Caldera',
        color: '#4CAF50',
        type: 'block',
        coords: [
          [7.333048492559072, -72.73175387839177],
          [7.332969687577133, -72.73172306937329],
          [7.332943955336091, -72.73178793046438],
          [7.333049296690987, -72.73183252246436],
          [7.333021956189668, -72.73189495126502],
          [7.333013914865134, -72.73189981584687],
          [7.333000244612606, -72.73197197381077],
          [7.332944759468148, -72.73196143388338],
          [7.332961646252599, -72.73187306064659],
          [7.332830572627429, -72.73181630719193],
          [7.332882037123113, -72.73168739577292],
          [7.332793582517482, -72.73164685759117],
          [7.332834593290883, -72.73154794442699],
          [7.333091111573623, -72.73165496522760],
          [7.333048492559072, -72.73175387839177]
        ],
        info: {
          area: 0,
          rooms: 0,
          construction: 'Otro',
          roof: 'Otro'
        }
      }
    }
  }
};

export function getSedesData() {
  return sedesData;
}

export function getSedeConfig(sedeId) {
  return sedesData[sedeId] || sedesData.pamplona;
}

export function getCampusData() {
  return campusData;
}
