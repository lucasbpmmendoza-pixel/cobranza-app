// Datos ficticios de la cuenta demo (berniluck@gmail.com). JS plano para que lo use
// tanto la app como scripts/crear-demo-berniluck.mjs.

export const DEMO_SLOTS = 12;
/** El lugar 1 es el celular del vendedor (DEMO_CELULAR_REAL), no se asigna a prospectos */
export const SLOT_VENDEDOR = 1;
export const PRIMER_MES = '2025-01';

export const EMPRESAS = [
  'Comercializadora Demo del Norte',
  'Transportes Demo Express',
  'Constructora Demo Valle',
  'Abarrotes Demo La Esperanza',
  'Taller Mecánico Demo',
  'Consultoría Demo Integral',
  'Restaurante Demo El Fogón',
  'Farmacia Demo San Rafael',
  'Distribuidora Demo Industrial',
  'Inmobiliaria Demo Horizonte',
  'Papelería Demo Escolar',
  'Clínica Dental Demo'
];

/** RFC ficticio que identifica el lugar de cada cliente demo */
/** @param {number} slot */
export function rfcSlot(slot) {
  return `DEM${String(slot).padStart(2, '0')}0101XX${slot % 10}`;
}

/** @param {string | null | undefined} rfc */
export function slotDeRfc(rfc) {
  const m = /^DEM(\d{2})0101XX\d$/.exec(rfc || '');
  return m ? Number(m[1]) : null;
}

/** @param {number} slot */
export function celularFicticio(slot) {
  return `55500000${String(slot).padStart(2, '0')}`;
}

/** @param {string | null | undefined} celular */
export function esCelularFicticio(celular) {
  return /^(52)?55500000\d{2}$/.test(String(celular || '').replace(/\D/g, ''));
}

/** Solo dígitos; a 10 dígitos le antepone la lada de México */
/** @param {string | null | undefined} celular */
export function normalizarCelular(celular) {
  const digitos = String(celular || '').replace(/\D/g, '');
  return digitos.length === 10 ? `52${digitos}` : digitos;
}

// PRNG con semilla para que la demo salga igual cada vez que se regenera
/** @param {number} semilla */
function mulberry32(semilla) {
  return () => {
    semilla |= 0;
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUID con formato de folio fiscal del SAT, ficticio y estable por factura */
/** @param {number} semilla */
function uuidFalso(semilla) {
  const r = mulberry32(semilla * 7919);
  const hex = (/** @type {number} */ n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89AB'[Math.floor(r() * 4)]}${hex(3)}-${hex(12)}`.toUpperCase();
}

/**
 * Facturas ficticias de un cliente desde PRIMER_MES hasta `hoy`: una iguala mensual,
 * la declaración anual en abril y a algunos la e.firma. Cómo paga depende del perfil.
 */

/**
 * Perfil de pago por lugar. Los primeros lugares deben dinero porque son los que se
 * asignan al vendedor (lugar 1) y a los primeros prospectos, que deben recibir cobro.
 *   1–3  malo:  6–9 meses sin pagar, más de 90 días vencidos
 *   4–7  medio: los últimos 2–3 meses pagados a medias
 *   8–12 bueno: todo pagado
 * @param {number} slot
 * @returns {'malo' | 'medio' | 'bueno'}
 */
export function perfilDe(slot) {
  return slot <= 3 ? 'malo' : slot <= 7 ? 'medio' : 'bueno';
}

/**
 * @param {number} slot
 * @param {Date} [hoy]
 */
export function generarFacturas(slot, hoy = new Date()) {
  const r = mulberry32(slot * 104729);
  const iguala = (6 + Math.floor(r() * 20)) * 500; // $3,000 – $12,500
  const perfil = perfilDe(slot);
  // Meses recientes sin pagar (malos) o pagados a medias (medios)
  const atraso = perfil === 'malo' ? 6 + Math.floor(r() * 4) : perfil === 'medio' ? 2 + (slot % 2) : 0;
  const actual = hoy.getFullYear() * 12 + hoy.getMonth();
  /** @type {{ folio: string; uuid: string; concepto: string; monto: number; pagado: number; emision: Date; fechaPago: Date | null }[]} */
  const facturas = [];

  let [a, m] = PRIMER_MES.split('-').map(Number);
  while (a * 12 + (m - 1) <= actual) {
    const atras = actual - (a * 12 + (m - 1));
    const conceptos = [{ nombre: 'HONORARIOS', monto: iguala }];
    if (m === 4) conceptos.push({ nombre: `DECLARACION ANUAL ${a - 1}`, monto: iguala * 1.5 });
    if (m === (slot % 12) + 1 && slot % 3 === 0) conceptos.push({ nombre: 'RENOVACION E.FIRMA', monto: 1200 });

    conceptos.forEach((c, idx) => {
      const pendiente = atras < atraso;
      // Los medios abonan entre 30% y 70% de cada factura pendiente; los malos nada
      const abono = perfil === 'medio' ? 0.3 + ((slot + m + idx) % 5) * 0.1 : 0;
      const pagado = !pendiente ? c.monto : Math.round((c.monto * abono) / 50) * 50;
      const dia = 1 + ((slot + m) % 5);
      const semilla = slot * 100000 + (a % 100) * 100 + m * 4 + idx;
      const fechaPago = new Date(Date.UTC(a, m - 1, Math.min(28, 10 + (slot % 15)), 12));
      facturas.push({
        folio: `DEMO-${String(slot).padStart(2, '0')}${a % 100}${String(m).padStart(2, '0')}${idx || ''}`,
        uuid: uuidFalso(semilla),
        concepto: c.nombre,
        monto: c.monto,
        pagado,
        emision: new Date(Date.UTC(a, m - 1, dia, 12)),
        fechaPago: pagado > 0 ? (fechaPago > hoy ? hoy : fechaPago) : null
      });
    });

    m++;
    if (m > 12) { m = 1; a++; }
  }
  return facturas;
}
