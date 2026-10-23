// Demo de expo (cuenta berniluck@gmail.com). Sus clientes, facturas y pagos son
// ficticios pero viven en la BD (scripts/crear-demo-berniluck.mjs), así que todas las
// páginas se ven vivas. Los prospectos de la expo se cargan con
// scripts/demo-prospectos.mjs: toman nombre y celular de un cliente demo para que el
// botón Cobranza de Reportes les mande su cobro por WhatsApp.
import { json, type RequestEvent } from '@sveltejs/kit';
import sql from 'mssql';
import { getConnection } from '$lib/server/db';
import { requireOrganizationAccess } from '$lib/server/auth';
import { esCelularFicticio } from '$lib/server/demo-datos.js';

export type ClienteDemo = {
  clienteId: number;
  nombre: string;
  celular: string;
  /** true si el celular es de una persona real (vendedor o prospecto) */
  real: boolean;
};

export function esOrganizacionDemo(organizacionId: number): boolean {
  return !!process.env.DEMO_ORGANIZACION_ID && organizacionId === Number(process.env.DEMO_ORGANIZACION_ID);
}

/**
 * Las rutas de la demo solo las usa la cuenta demo: el usuario debe pertenecer a la
 * organización DEMO_ORGANIZACION_ID (?organizacionId=… en la URL).
 */
export async function requireDemo(event: RequestEvent): Promise<{ organizacionId: number } | Response> {
  const acceso = await requireOrganizationAccess(event, event.url.searchParams.get('organizacionId'));
  if (acceso instanceof Response) return acceso;
  if (!esOrganizacionDemo(acceso.organizacionId)) {
    return json({ success: false, message: 'Solo disponible para la cuenta demo' }, { status: 403 });
  }
  return { organizacionId: acceso.organizacionId };
}

export function enmascararCelular(celular: string): string {
  const d = (celular || '').replace(/\D/g, '');
  return d.length <= 4 ? d : `•••• ${d.slice(-4)}`;
}

export async function obtenerClientesDemo(organizacionId: number): Promise<ClienteDemo[]> {
  const pool = await getConnection();
  const res = await pool.request().input('o', sql.Int, organizacionId).query(`
    SELECT Id, RazonSocial, ISNULL(TelefonoWhatsApp, Telefono) AS Celular
    FROM Clientes WHERE OrganizacionId = @o ORDER BY RFC
  `);
  return res.recordset.map((c: any) => ({
    clienteId: c.Id,
    nombre: c.RazonSocial,
    celular: c.Celular || '',
    real: !!c.Celular && !esCelularFicticio(c.Celular)
  }));
}
