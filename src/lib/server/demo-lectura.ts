// Demo de solo lectura (botón "Ver Cobranza" de la demo pública de AICuenta). Cualquiera
// que entre a la demo de AICuenta recibe una sesión de esta cuenta, así que aquí no se
// confía en lo que mande el navegador: solo se permite consultar y descargar (GET) en
// las rutas de abajo, y siempre de la organización demo del token.
import { json, type RequestEvent } from '@sveltejs/kit';
import type { JWTPayload } from './auth';

type Alcance =
  | 'organizacion' // ?organizacionId= obligatorio y debe ser la del token
  | 'catalogo' // datos generales, no son de ninguna organización
  | 'ruta-organizacion' // el número de la ruta es la organización
  | 'ruta-usuario'; // el número de la ruta es el usuario del token

const RUTAS: Array<[RegExp, Alcance]> = [
  [/^\/api\/dashboard\/(metricas|stats)$/, 'organizacion'],
  [/^\/api\/clientes(\/excel|\/buscar-por-rfc|\/\d+)?$/, 'organizacion'],
  [/^\/api\/facturas(\/\d+(\/(pdf|xml|recordatorios))?)?$/, 'organizacion'],
  [/^\/api\/pagos(\/\d+|\/clientes-disponibles|\/facturas-disponibles)?$/, 'organizacion'],
  [/^\/api\/(agentes|usuarios|conceptos)$/, 'organizacion'],
  [/^\/api\/reportes\/sabana$/, 'organizacion'],
  [/^\/api\/(regimen|estados|paises|roles|tipo-cambio|pagos\/metodos|catalogs\/productos-sat)$/, 'catalogo'],
  [/^\/api\/configuracion\/organizacion\/\d+$/, 'ruta-organizacion'],
  [/^\/api\/usuario\/\d+\/organizacion(es)?$/, 'ruta-usuario']
];

function rechazar(message: string) {
  return json({ success: false, soloLectura: true, error: message, message }, { status: 403 });
}

/** null si la petición de una sesión de solo lectura está permitida; si no, el 403 */
export function revisarSoloLectura(event: RequestEvent, user: JWTPayload): Response | null {
  const { pathname, searchParams } = event.url;
  const org = Number(user.organizacion);

  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
    return rechazar('Demo de solo lectura: puedes consultar y descargar, pero no hacer cambios.');
  }

  const ruta = RUTAS.find(([re]) => re.test(pathname));
  if (!ruta || !org) return rechazar('Esta sección no está disponible en la demo.');

  // Ninguna petición puede apuntar a otra organización, ni por parámetro ni por header
  const porParametro = searchParams.get('organizacionId');
  const porHeader = event.request.headers.get('x-organization-id');
  if ((porParametro !== null && Number(porParametro) !== org) || (porHeader !== null && Number(porHeader) !== org)) {
    return rechazar('Esta sección no está disponible en la demo.');
  }

  const numero = Number(pathname.match(/\/(\d+)(\/[a-z]+)?$/)?.[1]);
  switch (ruta[1]) {
    case 'organizacion':
      return porParametro === null ? rechazar('Esta sección no está disponible en la demo.') : null;
    case 'ruta-organizacion':
      return numero === org ? null : rechazar('Esta sección no está disponible en la demo.');
    case 'ruta-usuario':
      return numero === user.id ? null : rechazar('Esta sección no está disponible en la demo.');
    default:
      return null;
  }
}
