import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import jwt from 'jsonwebtoken';
import sql from 'mssql';
import { getConnection } from '$lib/server/db';
import { generateToken } from '$lib/server/auth';
import { CORREO_DEMO_LECTURA } from '$lib/server/demo-datos.js';

// Cuentas a las que entra el botón "Ver Cobranza" de AICuenta, según el modo del pase:
// "expo" (berniluck, la demo de expo completa) o "lectura" (la demo pública de AICuenta,
// solo consultar y descargar; scripts/crear-demo-lectura.mjs)
const CUENTAS = {
  expo: { correo: 'berniluck@gmail.com', organizacion: () => process.env.DEMO_ORGANIZACION_ID },
  lectura: { correo: CORREO_DEMO_LECTURA, organizacion: () => process.env.DEMO_LECTURA_ORGANIZACION_ID }
};

/**
 * Entrada directa desde la demo de AICuenta: recibe el pase que firmó AICuenta
 * (HS256 con DEMO_SSO_SECRET, válido 2 minutos) y regresa una sesión de la cuenta
 * demo, igual que /api/login. Solo sirve para las cuentas demo, nunca para otra.
 * Un pase sin modo cuenta como "lectura".
 *
 * POST /api/demo-acceso  { t: "<pase>" }
 */
export const POST: RequestHandler = async ({ request }) => {
  const secreto = process.env.DEMO_SSO_SECRET;
  if (!secreto || secreto.length < 32) {
    return json({ error: 'El acceso desde AICuenta no está configurado' }, { status: 503 });
  }

  const { t } = await request.json().catch(() => ({}));
  let pase: jwt.JwtPayload;
  try {
    pase = jwt.verify(String(t || ''), secreto, {
      algorithms: ['HS256'],
      issuer: 'aicuenta',
      audience: 'cobranza-demo',
      maxAge: '2m'
    }) as jwt.JwtPayload;
  } catch {
    return json({ error: 'El acceso expiró o no es válido. Vuelve a entrar desde AICuenta.' }, { status: 401 });
  }

  const soloLectura = pase.modo !== 'expo';
  const cuenta = soloLectura ? CUENTAS.lectura : CUENTAS.expo;

  try {
    const pool = await getConnection();
    const res = await pool.request()
      .input('correo', sql.NVarChar(150), cuenta.correo)
      .input('org', sql.Int, Number(cuenta.organizacion()) || 0)
      .query(`
        SELECT u.Id, u.Correo, u.Nombre, u.Apellido, uo.OrganizacionId
        FROM Usuarios u
        INNER JOIN Usuario_Organizacion uo ON uo.UsuarioId = u.Id AND uo.OrganizacionId = @org
        WHERE u.Correo = @correo AND u.Activo = 1
      `);
    const user = res.recordset[0];
    if (!user) return json({ error: 'La cuenta demo no está disponible' }, { status: 404 });

    const token = generateToken(
      { id: user.Id, correo: user.Correo, organizacion: user.OrganizacionId, ...(soloLectura ? { soloLectura: true } : {}) },
      soloLectura ? '2h' : '12h'
    );
    return json({
      token,
      usuario: { id: user.Id, correo: user.Correo, nombre: user.Nombre, apellido: user.Apellido, soloLectura }
    });
  } catch (error) {
    console.error('Error en acceso demo:', error);
    return json({ error: 'Error en el servidor' }, { status: 500 });
  }
};
