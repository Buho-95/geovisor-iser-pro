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

export function getCampusData() {
  return campusData;
}
