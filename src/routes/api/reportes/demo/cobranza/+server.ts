import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from 'mssql';
import { getConnection } from '$lib/server/db';
import { enmascararCelular, obtenerClientesDemo, requireDemo } from '$lib/server/demo';

// Estado 6 = Cancelada (ver por-cobrar)
const ESTADO_CANCELADA = 6;

type Resultado = { clienteId: number; cliente: string; celular: string; estado: 'enviado' | 'simulado' | 'error'; detalle?: string };

function formatearMoneda(n: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0);
}

function nombreMes(fecha: Date): string {
  return fecha.toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatearFecha(fecha: Date): string {
  return fecha.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

type FacturaPendiente = { uuid: string; concepto: string; monto: number; saldo: number; diasVencido: number };

// Más de 60 días vencido = mal pagador; con saldo pero menos = está abonando
const DIAS_MAL_PAGADOR = 60;

/**
 * Mensaje según cómo paga el cliente:
 *   al corriente → agradecimiento
 *   a medias     → reconoce sus abonos y le dice cuánto le resta de cada factura
 *   mal pagador  → facturas vencidas con días de atraso y petición de regularizar
 */
function armarMensaje(razonSocial: string, facturas: FacturaPendiente[], ultimoPago?: { fecha: Date; monto: number }): string {
  // Los clientes se guardan en mayúsculas: "ANA LÓPEZ" → "Ana López"
  const nombre = razonSocial.toLowerCase().replace(/(^|\s)\S/g, (l) => l.toUpperCase());
  const demo = '\n\n_(Mensaje de demostración)_';

  if (facturas.length === 0) {
    return (
      `Hola ${nombre} 👋\n\n` +
      `¡Gracias por tu puntualidad! Tu cuenta está *al corriente*, no tienes facturas pendientes.` +
      (ultimoPago ? `\n\nTu último pago fue el ${formatearFecha(ultimoPago.fecha)} por ${formatearMoneda(ultimoPago.monto)}.` : '') +
      demo
    );
  }

  const total = facturas.reduce((s, f) => s + f.saldo, 0);
  const masVieja = Math.max(...facturas.map((f) => f.diasVencido));

  if (masVieja <= DIAS_MAL_PAGADOR) {
    const abonado = facturas.reduce((s, f) => s + (f.monto - f.saldo), 0);
    return (
      `Hola ${nombre} 👋\n\n` +
      `Gracias por tus abonos, ya tenemos registrados ${formatearMoneda(abonado)}. ` +
      `Te queda un saldo de *${formatearMoneda(total)}*:\n\n` +
      facturas.map((f) =>
        `• ${f.concepto}: abonaste ${formatearMoneda(f.monto - f.saldo)} de ${formatearMoneda(f.monto)}, restan *${formatearMoneda(f.saldo)}*\n  UUID: ${f.uuid}`
      ).join('\n') +
      `\n\nTe agradecemos liquidarlo en cuanto puedas 🙌` +
      demo
    );
  }

  return (
    `Hola ${nombre}.\n\n` +
    `Tu cuenta tiene *${facturas.length} facturas pendientes* por *${formatearMoneda(total)}*. ` +
    `La más antigua lleva ${masVieja} días sin pagarse:\n\n` +
    facturas.map((f) =>
      `• ${f.concepto}: ${formatearMoneda(f.saldo)}${f.diasVencido > 0 ? ` (${f.diasVencido} días vencida)` : ''}\n  UUID: ${f.uuid}`
    ).join('\n') +
    `\n\nTe pedimos regularizar tu pago a la brevedad. Si ya pagaste, haz caso omiso de este mensaje.` +
    demo
  );
}

/**
 * Botón "Cobranza" de la demo: arma el mensaje de cada cliente seleccionado según cómo
 * paga y se lo manda al bot de WhatsApp (bot-cobranza-demo), que solo envía. Solo se
 * manda a celulares reales (vendedor y prospectos); los ficticios se marcan como simulados.
 *
 * POST /api/reportes/demo/cobranza?organizacionId=48   (a todos los clientes demo)
 */
export const POST: RequestHandler = async (event) => {
  const acceso = await requireDemo(event);
  if (acceso instanceof Response) return acceso;

  const botUrl = (process.env.BOT_COBRANZA_URL || '').replace(/\/$/, '');
  const botToken = process.env.BOT_COBRANZA_TOKEN || '';

  try {
    const pool = await getConnection();
    const req = () => pool.request().input('o', sql.Int, acceso.organizacionId);
    const pendientes = (await req().query(`
      SELECT f.ClienteId, f.UUID, f.FechaEmision, f.MontoTotal, f.SaldoPendiente, f.DiasVencido,
        (SELECT TOP 1 cf.Nombre FROM ConceptosFactura cf WHERE cf.FacturaId = f.Id) AS Concepto
      FROM Facturas f
      INNER JOIN Clientes c ON f.ClienteId = c.Id
      WHERE c.OrganizacionId = @o AND f.SaldoPendiente > 0.5
        AND ISNULL(f.estado_factura_id, 0) <> ${ESTADO_CANCELADA}
      ORDER BY f.FechaEmision
    `)).recordset;
    // Último pago de cada cliente, para agradecerle a los que están al corriente
    const ultimosPagos = new Map<number, { fecha: Date; monto: number }>(
      (await req().query(`
        SELECT ClienteId, FechaPago, Monto FROM (
          SELECT f.ClienteId, p.FechaPago, p.Monto,
            ROW_NUMBER() OVER (PARTITION BY f.ClienteId ORDER BY p.FechaPago DESC) AS n
          FROM Pagos p
          INNER JOIN Facturas f ON p.FacturaId = f.Id
          INNER JOIN Clientes c ON f.ClienteId = c.Id
          WHERE c.OrganizacionId = @o AND p.Cancelado = 0
        ) t WHERE n = 1
      `)).recordset.map((p: any) => [p.ClienteId, { fecha: new Date(p.FechaPago), monto: Number(p.Monto) }])
    );

    const clientes = await obtenerClientesDemo(acceso.organizacionId);
    const resultados: Resultado[] = [];
    const cobros: any[] = [];

    for (const c of clientes) {
      const facturas: FacturaPendiente[] = pendientes
        .filter((f: any) => f.ClienteId === c.clienteId)
        .map((f: any) => ({
          uuid: f.UUID,
          concepto: `${(f.Concepto || 'Factura').trim()} ${nombreMes(new Date(f.FechaEmision))}`,
          monto: Number(f.MontoTotal),
          saldo: Number(f.SaldoPendiente),
          diasVencido: Number(f.DiasVencido) || 0
        }));
      const mensaje = armarMensaje(c.nombre, facturas, ultimosPagos.get(c.clienteId));

      const base = { clienteId: c.clienteId, cliente: c.nombre, celular: enmascararCelular(c.celular) };
      if (!c.real) {
        resultados.push({ ...base, estado: 'simulado', detalle: 'Celular ficticio, no se envía' });
        continue;
      }
      cobros.push({ clienteId: c.clienteId, celular: c.celular, nombre: c.nombre, mensaje });
      resultados.push({ ...base, estado: 'enviado' });
    }

    if (cobros.length > 0) {
      if (!botUrl) {
        marcarError(resultados, cobros, 'Falta BOT_COBRANZA_URL en .env');
      } else {
        try {
          const resp = await fetch(`${botUrl}/cobrar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botToken}` },
            body: JSON.stringify({ comando: 'cobrar', cobros }),
            signal: AbortSignal.timeout(30000)
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            marcarError(resultados, cobros, data.message || `El bot respondió ${resp.status}`);
          } else {
            // El bot regresa el estado de cada envío
            for (const r of data.resultados || []) {
              const res = resultados.find((x) => x.clienteId === r.clienteId);
              if (res && !r.ok) { res.estado = 'error'; res.detalle = r.error || 'No se pudo enviar'; }
            }
          }
        } catch (err) {
          const causa = (err as any)?.cause?.code || (err instanceof Error ? err.message : err);
          marcarError(resultados, cobros, `No se pudo contactar al bot en ${botUrl} (${causa})`);
        }
      }
    }

    return json({ success: true, resultados });
  } catch (error) {
    console.error('Error en cobranza demo:', error);
    return json({ success: false, message: error instanceof Error ? error.message : 'Error al enviar la cobranza' }, { status: 500 });
  }
};

function marcarError(resultados: Resultado[], cobros: any[], detalle: string) {
  const ids = new Set(cobros.map((c) => c.clienteId));
  for (const r of resultados) {
    if (ids.has(r.clienteId)) { r.estado = 'error'; r.detalle = detalle; }
  }
}
