import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enmascararCelular, obtenerClientesDemo, requireDemo } from '$lib/server/demo';

/**
 * Clientes demo con celular enmascarado y si es real (vendedor o prospecto cargado con
 * scripts/demo-prospectos.mjs) o ficticio.
 *
 * GET /api/reportes/demo?organizacionId=48
 */
export const GET: RequestHandler = async (event) => {
  const acceso = await requireDemo(event);
  if (acceso instanceof Response) return acceso;

  try {
    const clientes = await obtenerClientesDemo(acceso.organizacionId);
    return json({ success: true, clientes: clientes.map((c) => ({ ...c, celular: enmascararCelular(c.celular) })) });
  } catch (error) {
    console.error('Error en demo:', error);
    return json({ success: false, message: error instanceof Error ? error.message : 'Error al cargar la demo' }, { status: 500 });
  }
};
