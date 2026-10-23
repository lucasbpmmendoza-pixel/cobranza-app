// Categorías de cobro para el reporte de cobranza.
// Los conceptos se capturan a mano y con nombres muy variados ("HONORARIOS AGOSTO",
// "HONORAROPS ERIKA SOLIS", "EMCA"...), así que se clasifican por palabras clave.
// Las reglas se evalúan en orden: la primera que coincide gana.

export type CategoriaId =
  | 'honorarios'
  | 'anual'
  | 'auditoria'
  | 'regularizacion'
  | 'efirma'
  | 'ptu'
  | 'otros';

export const CATEGORIAS: { id: CategoriaId; nombre: string }[] = [
  { id: 'honorarios', nombre: 'Honorarios' },
  { id: 'anual', nombre: 'Cierre / Declaración anual' },
  { id: 'auditoria', nombre: 'Auditoría' },
  { id: 'regularizacion', nombre: 'Regularización SAT' },
  { id: 'efirma', nombre: 'e.firma' },
  { id: 'ptu', nombre: 'PTU' },
  { id: 'otros', nombre: 'Otros' }
];

const REGLAS: { id: CategoriaId; patron: RegExp }[] = [
  { id: 'auditoria', patron: /AUDITORIA/ },
  { id: 'anual', patron: /CIERRE ANUAL|DECLARACION ANUAL|(^|\s)ANUAL\s+\d{4}/ },
  { id: 'regularizacion', patron: /REGULARIZACION|REQUERIMI?E?NTO|DECLARACION/ },
  { id: 'efirma', patron: /FIRMA ELECTRONICA|E\.?\s?FIRMA|\bFIEL\b/ },
  { id: 'ptu', patron: /\bPTU\b/ },
  { id: 'honorarios', patron: /HONORA/ }
];

/** Mayúsculas, sin acentos y sin espacios dobles */
export function normalizarConcepto(nombre: string | null | undefined): string {
  return (nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Conceptos de prueba que no deben contar en el reporte */
export function esConceptoPrueba(nombre: string | null | undefined): boolean {
  return /\bPRUEBA\b/.test(normalizarConcepto(nombre));
}

/**
 * Clasifica un concepto. Si no coincide con ninguna regla y la factura es
 * recurrente (iguala mensual), se toma como honorarios; si no, va a "otros".
 */
export function clasificarConcepto(nombre: string | null | undefined, esRecurrente: boolean): CategoriaId {
  const texto = normalizarConcepto(nombre);
  for (const regla of REGLAS) {
    if (regla.patron.test(texto)) return regla.id;
  }
  return esRecurrente ? 'honorarios' : 'otros';
}
