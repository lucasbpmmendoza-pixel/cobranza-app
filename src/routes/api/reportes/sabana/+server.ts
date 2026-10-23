import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from 'mssql';
import { getConnection } from '$lib/server/db';
import { requireOrganizationAccess } from '$lib/server/auth';
import { esOrganizacionDemo } from '$lib/server/demo';
import { clasificarConcepto, esConceptoPrueba, normalizarConcepto, type CategoriaId } from '$lib/reportes/categorias';

// Estado 6 = Cancelada (ver por-cobrar)
const ESTADO_CANCELADA = 6;

/**
 * Sábana de cobranza: devuelve, por factura y categoría de cobro, lo facturado y
 * lo pagado de cada mes del periodo. La página pivotea clientes × meses.
 *
 * GET /api/reportes/sabana?organizacionId=5&desde=2026-01&hasta=2026-06
 */
export const GET: RequestHandler = async (event) => {
  const { url } = event;
  const acceso = await requireOrganizationAccess(event, url.searchParams.get('organizacionId'));
  if (acceso instanceof Response) return acceso;

  const desde = url.searchParams.get('desde') || '';
  const hasta = url.searchParams.get('hasta') || '';
  if (!/^\d{4}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}$/.test(hasta) || desde > hasta) {
    return json({ success: false, message: 'Periodo inválido (desde/hasta en formato YYYY-MM)' }, { status: 400 });
  }

  // Rango [primer día de "desde", primer día del mes siguiente a "hasta")
  const [ha, hm] = hasta.split('-').map(Number);
  const fechaInicio = `${desde}-01`;
  const fechaFin = hm === 12 ? `${ha + 1}-01-01` : `${ha}-${String(hm + 1).padStart(2, '0')}-01`;

  try {
    const pool = await getConnection();
    const filtro = `
      cl.OrganizacionId = @organizacionId
      AND f.FechaEmision >= @fechaInicio AND f.FechaEmision < @fechaFin
      AND ISNULL(f.estado_factura_id, 0) <> ${ESTADO_CANCELADA}
    `;

    const req = () =>
      pool.request()
        .input('organizacionId', sql.Int, acceso.organizacionId)
        .input('fechaInicio', sql.Date, fechaInicio)
        .input('fechaFin', sql.Date, fechaFin);

    const facturasRes = await req().query(`
      SELECT
        f.Id, f.ClienteId, cl.RazonSocial, cl.RFC, f.numero_factura, f.FechaEmision,
        f.MontoTotal, ISNULL(f.SaldoPendiente, f.MontoTotal) AS SaldoPendiente,
        f.Moneda, f.TipoCambio, f.FacturaOrigenId, f.RecurrenciaActiva,
        (SELECT MAX(p.FechaPago) FROM Pagos p WHERE p.FacturaId = f.Id) AS UltimoPago
      FROM Facturas f
      INNER JOIN Clientes cl ON f.ClienteId = cl.Id
      WHERE ${filtro}
    `);

    const conceptosRes = await req().query(`
      SELECT cf.FacturaId, cf.Nombre, cf.Total
      FROM ConceptosFactura cf
      INNER JOIN Facturas f ON cf.FacturaId = f.Id
      INNER JOIN Clientes cl ON f.ClienteId = cl.Id
      WHERE ${filtro}
    `);

    // Conceptos que la organización usa en facturas recurrentes (igualas). Si una factura
    // manual repite uno de esos conceptos ("EMCA", "BELKODAV"...), también es honorarios.
    const recurrentesRes = await pool.request()
      .input('organizacionId', sql.Int, acceso.organizacionId)
      .query(`
        SELECT DISTINCT cf.Nombre
        FROM ConceptosFactura cf
        INNER JOIN Facturas f ON cf.FacturaId = f.Id
        INNER JOIN Clientes cl ON f.ClienteId = cl.Id
        WHERE cl.OrganizacionId = @organizacionId
          AND (f.FacturaOrigenId IS NOT NULL OR f.RecurrenciaActiva = 1)
      `);
    const conceptosRecurrentes = new Set(
      recurrentesRes.recordset.map((r: any) => normalizarConcepto(r.Nombre).replace(/^LA /, ''))
    );

    const conceptosPorFactura = new Map<number, { nombre: string; total: number }[]>();
    for (const c of conceptosRes.recordset) {
      const lista = conceptosPorFactura.get(c.FacturaId) || [];
      lista.push({ nombre: c.Nombre || '', total: Number(c.Total) || 0 });
      conceptosPorFactura.set(c.FacturaId, lista);
    }

    const lineas: any[] = [];

    for (const f of facturasRes.recordset) {
      const esRecurrente = f.FacturaOrigenId != null || !!f.RecurrenciaActiva;
      const todos = conceptosPorFactura.get(f.Id) || [];
      const conceptos = todos.filter((c) => !esConceptoPrueba(c.nombre));
      // Factura solo de prueba: no cuenta
      if (todos.length > 0 && conceptos.length === 0) continue;

      // Montos en MXN
      const tc = f.Moneda && f.Moneda !== 'MXN' ? Number(f.TipoCambio) || 1 : 1;
      const total = (Number(f.MontoTotal) || 0) * tc;
      const saldo = Math.max(0, Math.min(Number(f.SaldoPendiente) || 0, Number(f.MontoTotal) || 0)) * tc;
      const pagado = total - saldo;

      // Agrupar conceptos por categoría; el monto de la factura se reparte
      // proporcionalmente al total de cada concepto (el pago es por factura, no por concepto)
      const porCategoria = new Map<CategoriaId, { peso: number; nombres: Set<string> }>();
      if (conceptos.length === 0) {
        porCategoria.set(esRecurrente ? 'honorarios' : 'otros', { peso: 1, nombres: new Set() });
      } else {
        const sumaConceptos = conceptos.reduce((s, c) => s + c.total, 0);
        for (const c of conceptos) {
          const usadoEnIguala = conceptosRecurrentes.has(normalizarConcepto(c.nombre).replace(/^LA /, ''));
          const cat = clasificarConcepto(c.nombre, esRecurrente || usadoEnIguala);
          const actual = porCategoria.get(cat) || { peso: 0, nombres: new Set<string>() };
          actual.peso += sumaConceptos > 0 ? c.total / sumaConceptos : 1 / conceptos.length;
          actual.nombres.add(c.nombre.trim());
          porCategoria.set(cat, actual);
        }
      }

      const fecha = new Date(f.FechaEmision);
      const mes = `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;

      for (const [categoria, { peso, nombres }] of porCategoria) {
        lineas.push({
          facturaId: f.Id,
          folio: f.numero_factura,
          clienteId: f.ClienteId,
          cliente: f.RazonSocial,
          rfc: f.RFC,
          mes,
          fecha: f.FechaEmision,
          categoria,
          conceptos: [...nombres].join(', '),
          facturado: Math.round(total * peso * 100) / 100,
          pagado: Math.round(pagado * peso * 100) / 100,
          ultimoPago: f.UltimoPago
        });
      }
    }

    // demo: la cuenta de expo (berniluck) además ve prospectos y el botón Cobranza
    return json({ success: true, desde, hasta, lineas, demo: esOrganizacionDemo(acceso.organizacionId) });
  } catch (error) {
    console.error('Error en reporte sábana:', error);
    return json(
      { success: false, message: error instanceof Error ? error.message : 'Error al generar el reporte' },
      { status: 500 }
    );
  }
};
