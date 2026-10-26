// Exportación a Excel del reporte de cobranza con los mismos colores de la página.
// La versión gratuita de SheetJS ("xlsx") no escribe estilos; xlsx-js-style es la misma
// API pero sí guarda colores, bordes y formatos.
import XLSX from 'xlsx-js-style';
import type { CellObject, Range, WorkBook, WorkSheet } from 'xlsx-js-style';

export type CeldaExcel = { facturado: number; pagado: number };
export type FilaExcel = {
  cliente: string;
  rfc: string;
  celdas: Record<string, CeldaExcel>;
  facturado: number;
  pagado: number;
  debe: number;
};
export type LineaExcel = {
  mes: string;
  fecha: string;
  folio: string;
  cliente: string;
  rfc: string;
  categoria: string;
  conceptos: string;
  facturado: number;
  pagado: number;
  ultimoPago: string | null;
};

export type DatosExcel = {
  titulo: string; // "Reporte de cobranza" (+ " DEMO")
  periodo: string; // "Ene 26 – Dic 26"
  meses: string[]; // ["2026-01", ...]
  etiquetas: string[]; // ["Ene", ...]
  resumen: { categoria: string; porMes: { facturado: number; pagado: number }[] }[];
  sabanas: { nombre: string; filas: FilaExcel[] }[];
  detalle: LineaExcel[];
};

// Colores de Tailwind que usa la página
const C = {
  verdeFondo: 'DCFCE7', verdeTexto: '166534', verdeFuerte: '15803D',
  amarilloFondo: 'FEF9C3', amarilloTexto: '854D0E', amarilloFuerte: 'A16207',
  rojoFondo: 'FEE2E2', rojoTexto: '991B1B', rojoFuerte: 'DC2626',
  grisFondo: 'F3F4F6', grisBorde: 'D1D5DB', grisTexto: '374151', grisClaro: '9CA3AF',
  indigo: '3730A3', blanco: 'FFFFFF'
};
const MONEDA = '"$"#,##0';
const PORCENTAJE = '0%';
const borde = { style: 'thin', color: { rgb: C.grisBorde } };
const bordes = { top: borde, bottom: borde, left: borde, right: borde };

type Estado = 'pagado' | 'parcial' | 'pendiente' | 'vacio';

function estado(c: CeldaExcel | undefined): Estado {
  if (!c || c.facturado <= 0) return 'vacio';
  if (c.pagado >= c.facturado - 0.5) return 'pagado';
  if (c.pagado > 0.5) return 'parcial';
  return 'pendiente';
}

const ESTILO_ESTADO: Record<Estado, { fondo?: string; texto: string }> = {
  pagado: { fondo: C.verdeFondo, texto: C.verdeTexto },
  parcial: { fondo: C.amarilloFondo, texto: C.amarilloTexto },
  pendiente: { fondo: C.rojoFondo, texto: C.rojoTexto },
  vacio: { texto: C.grisBorde }
};

function moneda(n: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);
}

/** Color del % cobrado como en el pie de la página: ≥90% verde, ≥70% amarillo, si no rojo */
function colorPorcentaje(p: number): string {
  return p >= 0.9 ? C.verdeFuerte : p >= 0.7 ? C.amarilloFuerte : C.rojoFuerte;
}

// --- Celdas ---
type Celda = CellObject & { s?: any };

const texto = (v: string, s: any = {}): Celda => ({ v, t: 's', s: { border: bordes, ...s } });
const numero = (v: number, z: string, s: any = {}): Celda => ({ v: Math.round(v * 100) / 100, t: 'n', z, s: { border: bordes, ...s } });
const encabezado = (v: string, centrado = false): Celda =>
  texto(v, {
    font: { bold: true, color: { rgb: C.grisTexto } },
    fill: { fgColor: { rgb: C.grisFondo } },
    alignment: { horizontal: centrado ? 'center' : 'left', vertical: 'center', wrapText: true }
  });

/** Título y periodo arriba de cada hoja */
function cabecera(titulo: string, subtitulo: string, columnas: number): { filas: Celda[][]; merges: Range[] } {
  const vacias = (n: number) => Array.from({ length: n }, () => ({ v: '', t: 's' }) as Celda);
  return {
    filas: [
      [{ v: titulo, t: 's', s: { font: { bold: true, sz: 14, color: { rgb: C.indigo } } } }, ...vacias(columnas - 1)],
      [{ v: subtitulo, t: 's', s: { font: { color: { rgb: C.grisTexto } } } }, ...vacias(columnas - 1)]
    ],
    merges: [
      { s: { r: 0, c: 0 }, e: { r: 0, c: columnas - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: columnas - 1 } }
    ]
  };
}

function hoja(filas: Celda[][], anchos: number[], merges: Range[] = [], filaEncabezado = 3): WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = anchos.map((wch) => ({ wch }));
  ws['!merges'] = merges;
  ws['!rows'] = filas.map((_, i) => (i === filaEncabezado ? { hpt: 30 } : i === 0 ? { hpt: 22 } : { hpt: 18 }));
  return ws;
}

// --- Hojas ---

/** Sábana clientes × meses con ✓ ◐ ✕ coloreados, como la tabla de la página */
function hojaSabana(d: DatosExcel, nombre: string, filas: FilaExcel[]): WorkSheet {
  const columnas = 2 + d.meses.length + 3;
  const { filas: arriba, merges } = cabecera(`${d.titulo} · ${nombre}`, `Periodo ${d.periodo}`, columnas);

  // Leyenda en la fila 3
  const leyenda: Celda[] = [
    { v: 'Leyenda:', t: 's', s: { font: { bold: true, color: { rgb: C.grisTexto } } } },
    texto('✓ Pagado', { fill: { fgColor: { rgb: C.verdeFondo } }, font: { bold: true, color: { rgb: C.verdeTexto } }, alignment: { horizontal: 'center' } }),
    texto('◐ Parcial', { fill: { fgColor: { rgb: C.amarilloFondo } }, font: { bold: true, color: { rgb: C.amarilloTexto } }, alignment: { horizontal: 'center' } }),
    texto('✕ Sin pagar', { fill: { fgColor: { rgb: C.rojoFondo } }, font: { bold: true, color: { rgb: C.rojoTexto } }, alignment: { horizontal: 'center' } })
  ];

  const cuerpo: Celda[][] = [
    ...arriba,
    leyenda,
    [encabezado('Cliente'), encabezado('RFC'), ...d.etiquetas.map((e) => encabezado(e, true)), encabezado('Facturado', true), encabezado('Pagado', true), encabezado('Debe', true)]
  ];

  for (const f of filas) {
    cuerpo.push([
      texto(f.cliente, { font: { bold: true } }),
      texto(f.rfc, { font: { color: { rgb: C.grisTexto } } }),
      ...d.meses.map((m) => {
        const c = f.celdas[m];
        const e = estado(c);
        const { fondo, texto: color } = ESTILO_ESTADO[e];
        const valor =
          e === 'vacio' ? '—' : e === 'pagado' ? `✓ ${moneda(c!.facturado)}` : `${e === 'parcial' ? '◐' : '✕'} debe ${moneda(c!.facturado - c!.pagado)}`;
        return texto(valor, {
          font: { bold: e !== 'vacio', color: { rgb: color } },
          ...(fondo ? { fill: { fgColor: { rgb: fondo } } } : {}),
          alignment: { horizontal: 'center' }
        });
      }),
      numero(f.facturado, MONEDA),
      numero(f.pagado, MONEDA, { font: { color: { rgb: C.verdeFuerte } } }),
      numero(f.debe, MONEDA, { font: { bold: f.debe > 0.5, color: { rgb: f.debe > 0.5 ? C.rojoFuerte : C.grisClaro } } })
    ]);
  }

  // Pie: % cobrado de cada mes y totales
  const pie = { font: { bold: true }, fill: { fgColor: { rgb: C.grisFondo } } };
  const totFac = filas.reduce((s, f) => s + f.facturado, 0);
  const totPag = filas.reduce((s, f) => s + f.pagado, 0);
  cuerpo.push([
    texto('% cobrado del mes', pie),
    texto('', pie),
    ...d.meses.map((m) => {
      const fac = filas.reduce((s, f) => s + (f.celdas[m]?.facturado || 0), 0);
      const pag = filas.reduce((s, f) => s + (f.celdas[m]?.pagado || 0), 0);
      if (fac <= 0) return texto('—', { ...pie, font: { color: { rgb: C.grisBorde } }, alignment: { horizontal: 'center' } });
      return numero(pag / fac, PORCENTAJE, { ...pie, font: { bold: true, color: { rgb: colorPorcentaje(pag / fac) } }, alignment: { horizontal: 'center' } });
    }),
    numero(totFac, MONEDA, pie),
    numero(totPag, MONEDA, { ...pie, font: { bold: true, color: { rgb: C.verdeFuerte } } }),
    numero(Math.max(0, totFac - totPag), MONEDA, { ...pie, font: { bold: true, color: { rgb: C.rojoFuerte } } })
  ]);

  const ws = hoja(cuerpo, [36, 16, ...d.meses.map(() => 17), 14, 14, 14], merges);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + filas.length, c: columnas - 1 } }) };
  return ws;
}

/** Facturado y cobrado por categoría y mes */
function hojaResumen(d: DatosExcel): WorkSheet {
  const columnas = 1 + d.meses.length * 2 + 4;
  const { filas: arriba, merges } = cabecera(`${d.titulo} · Resumen por categoría`, `Periodo ${d.periodo}`, columnas);
  const cuerpo: Celda[][] = [
    ...arriba,
    [],
    [
      encabezado('Categoría'),
      ...d.etiquetas.flatMap((e) => [encabezado(`${e} facturado`, true), encabezado(`${e} cobrado`, true)]),
      encabezado('Total facturado', true),
      encabezado('Total cobrado', true),
      encabezado('Pendiente', true),
      encabezado('% cobrado', true)
    ]
  ];
  for (const r of d.resumen) {
    const fac = r.porMes.reduce((s, m) => s + m.facturado, 0);
    const pag = r.porMes.reduce((s, m) => s + m.pagado, 0);
    const pct = fac > 0 ? pag / fac : 0;
    cuerpo.push([
      texto(r.categoria, { font: { bold: true } }),
      ...r.porMes.flatMap((m) => [numero(m.facturado, MONEDA), numero(m.pagado, MONEDA, { font: { color: { rgb: C.verdeFuerte } } })]),
      numero(fac, MONEDA, { font: { bold: true } }),
      numero(pag, MONEDA, { font: { bold: true, color: { rgb: C.verdeFuerte } } }),
      numero(fac - pag, MONEDA, { font: { bold: true, color: { rgb: fac - pag > 0.5 ? C.rojoFuerte : C.grisClaro } } }),
      numero(pct, PORCENTAJE, { font: { bold: true, color: { rgb: colorPorcentaje(pct) } }, alignment: { horizontal: 'center' } })
    ]);
  }
  return hoja(cuerpo, [28, ...d.meses.flatMap(() => [13, 13]), 15, 15, 14, 11], merges);
}

/** Una fila por factura, con su estado coloreado */
function hojaDetalle(d: DatosExcel, nombreCategoria: (id: string) => string, formatearFecha: (f: string | null) => string): WorkSheet {
  const columnas = 12;
  const { filas: arriba, merges } = cabecera(`${d.titulo} · Detalle de facturas`, `Periodo ${d.periodo}`, columnas);
  const titulos = ['Mes', 'Fecha', 'Folio', 'Cliente', 'RFC', 'Categoría', 'Conceptos', 'Estado', 'Facturado', 'Pagado', 'Pendiente', 'Último pago'];
  const cuerpo: Celda[][] = [...arriba, [], titulos.map((t, i) => encabezado(t, i >= 7))];
  const nombresEstado: Record<Estado, string> = { pagado: '✓ Pagado', parcial: '◐ Parcial', pendiente: '✕ Sin pagar', vacio: '—' };
  for (const l of d.detalle) {
    const e = estado(l);
    const { fondo, texto: color } = ESTILO_ESTADO[e];
    const pendiente = l.facturado - l.pagado;
    cuerpo.push([
      texto(l.mes),
      texto(formatearFecha(l.fecha)),
      texto(l.folio || ''),
      texto(l.cliente),
      texto(l.rfc, { font: { color: { rgb: C.grisTexto } } }),
      texto(nombreCategoria(l.categoria)),
      texto(l.conceptos || ''),
      texto(nombresEstado[e], { font: { bold: true, color: { rgb: color } }, ...(fondo ? { fill: { fgColor: { rgb: fondo } } } : {}), alignment: { horizontal: 'center' } }),
      numero(l.facturado, MONEDA),
      numero(l.pagado, MONEDA, { font: { color: { rgb: C.verdeFuerte } } }),
      numero(pendiente, MONEDA, { font: { bold: pendiente > 0.5, color: { rgb: pendiente > 0.5 ? C.rojoFuerte : C.grisClaro } } }),
      texto(formatearFecha(l.ultimoPago))
    ]);
  }
  const ws = hoja(cuerpo, [9, 11, 14, 34, 16, 22, 30, 13, 13, 13, 13, 12], merges);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + d.detalle.length, c: columnas - 1 } }) };
  return ws;
}

/** Arma el libro: Resumen, una sábana por categoría (más "Todas") y el detalle */
export function crearLibro(d: DatosExcel, nombreCategoria: (id: string) => string, formatearFecha: (f: string | null) => string): WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaResumen(d), 'Resumen');
  for (const s of d.sabanas) {
    XLSX.utils.book_append_sheet(wb, hojaSabana(d, s.nombre, s.filas), s.nombre.replace(/[\\/?*[\]:]/g, '-').slice(0, 31));
  }
  XLSX.utils.book_append_sheet(wb, hojaDetalle(d, nombreCategoria, formatearFecha), 'Detalle facturas');
  return wb;
}

export function descargarLibro(wb: WorkBook, archivo: string) {
  XLSX.writeFile(wb, archivo);
}
