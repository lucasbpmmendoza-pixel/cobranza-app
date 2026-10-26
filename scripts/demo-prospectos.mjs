// Carga los prospectos de la expo en la demo: cada uno toma el lugar de un cliente demo
// (nombre y celular) para que el botón Cobranza le mande su mensaje por WhatsApp.
// Sin perfil, se le asigna uno al azar. Si ya no hay lugares libres (o ninguno del
// perfil pedido), se crea un cliente demo nuevo con sus facturas: no hay cupo máximo.
//
// Uso:
//   node scripts/demo-prospectos.mjs scripts/prospectos-expo.json    agrega los del archivo
//   node scripts/demo-prospectos.mjs scripts/prospectos-expo.json --reiniciar
//                                                                    borra los anteriores primero
//   node scripts/demo-prospectos.mjs --reiniciar                     solo borra (fin de la expo)
//   node scripts/demo-prospectos.mjs --lista                         muestra quién está en cada lugar
//
// El archivo es un arreglo: [{ "nombre": "Ana López", "celular": "6561234567", "correo": "", "empresa": "" }]
// Opcional por persona: "perfil": "malo" | "medio" | "bueno" para escoger qué tipo de cliente le toca.
import sql from 'mssql';
import fs from 'fs';
import {
  DEMO_SLOTS, SLOT_VENDEDOR, empresaDe, rfcSlot, slotDeRfc, celularFicticio, normalizarCelular, perfilDe
} from '../src/lib/server/demo-datos.js';
import { conectar, idUsuarioDemo, insertarFacturas, borrarClientesExtra } from './lib-demo.mjs';

const PERFILES = ['malo', 'medio', 'bueno'];
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
const reiniciar = args.includes('--reiniciar');
const organizacionId = Number(process.env.DEMO_ORGANIZACION_ID);
if (!organizacionId) {
  console.error('Falta DEMO_ORGANIZACION_ID en .env');
  process.exit(1);
}

const pool = await conectar();
const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];

async function actualizarCliente(slot, { nombre, celular, correo, empresa }) {
  await pool.request()
    .input('o', sql.Int, organizacionId)
    .input('rfc', sql.NVarChar, rfcSlot(slot))
    .input('razon', sql.NVarChar, nombre.toUpperCase())
    .input('comercial', sql.NVarChar, empresa || empresaDe(slot))
    .input('tel', sql.NVarChar, celular)
    .input('correo', sql.NVarChar, correo || `cliente${slot}@demo.example`)
    .query(`
      UPDATE Clientes SET RazonSocial = @razon, NombreComercial = @comercial, Telefono = @tel,
        TelefonoWhatsApp = @tel, CorreoPrincipal = @correo
      WHERE OrganizacionId = @o AND RFC = @rfc
    `);
}

/** Cliente demo nuevo (lugar extra) con facturas del perfil indicado */
async function crearClienteExtra(slot, perfil, usuarioId) {
  const r = await pool.request()
    .input('o', sql.Int, organizacionId)
    .input('rfc', sql.NVarChar, rfcSlot(slot))
    .input('nombre', sql.NVarChar, empresaDe(slot))
    .input('tel', sql.NVarChar, celularFicticio(slot))
    .query(`
      INSERT INTO Clientes (OrganizacionId, RazonSocial, NombreComercial, RFC, Telefono, TelefonoWhatsApp, CondicionesPago)
      OUTPUT INSERTED.Id
      VALUES (@o, UPPER(@nombre), @nombre, @rfc, @tel, @tel, '30-dias')
    `);
  await insertarFacturas(pool, r.recordset[0].Id, slot, usuarioId, perfil);
}

/** Perfil real de cada lugar según sus facturas (sirve también para los extra) */
async function perfilesActuales() {
  const r = await pool.request().input('o', sql.Int, organizacionId).query(`
    SELECT c.RFC, SUM(f.SaldoPendiente) AS Saldo, MAX(CASE WHEN f.SaldoPendiente > 0 THEN f.DiasVencido END) AS Dias
    FROM Clientes c LEFT JOIN Facturas f ON f.ClienteId = c.Id
    WHERE c.OrganizacionId = @o GROUP BY c.RFC
  `);
  const mapa = new Map();
  for (const c of r.recordset) {
    const slot = slotDeRfc(c.RFC);
    if (!slot) continue;
    // Mismo criterio que el mensaje de Cobranza: más de 60 días vencido = malo
    mapa.set(slot, !c.Saldo || c.Saldo <= 0.5 ? 'bueno' : (c.Dias || 0) > 60 ? 'malo' : 'medio');
  }
  return mapa;
}

if (reiniciar) {
  const slots = (await pool.request().query('SELECT Slot FROM DemoProspectos')).recordset.map((r) => r.Slot);
  for (const slot of slots.filter((s) => s <= DEMO_SLOTS)) {
    const empresa = empresaDe(slot);
    await actualizarCliente(slot, { nombre: empresa, celular: celularFicticio(slot), correo: null, empresa });
  }
  await pool.request().query('DELETE FROM DemoProspectos');
  const extras = await borrarClientesExtra(pool, organizacionId);
  console.log(`✓ Se quitaron ${slots.length} prospectos y ${extras} clientes extra; la demo volvió a los datos ficticios`);
}

if (archivo) {
  const lista = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const usuarioId = await idUsuarioDemo(pool);
  const perfiles = await perfilesActuales();
  const ocupados = new Set((await pool.request().query('SELECT Slot FROM DemoProspectos')).recordset.map((r) => r.Slot));
  // El lugar 1 es del vendedor solo si su celular está en DEMO_CELULAR_REAL
  const reservado = process.env.DEMO_CELULAR_REAL ? SLOT_VENDEDOR : null;
  const libres = [...perfiles.keys()].filter((s) => s !== reservado && !ocupados.has(s));
  let siguienteExtra = Math.max(DEMO_SLOTS, ...perfiles.keys()) + 1;

  for (const p of lista) {
    const celular = normalizarCelular(p.celular);
    if (celular.length < 10 || celular.length > 15) {
      console.warn(`✗ Se omite ${JSON.stringify(p)}: el celular no es válido`);
      continue;
    }
    if (p.perfil && !PERFILES.includes(p.perfil)) {
      console.warn(`✗ Se omite ${p.nombre || celular}: perfil "${p.perfil}" no existe (usa malo, medio o bueno)`);
      continue;
    }

    // Lugar libre del perfil pedido, o cualquiera al azar; si no hay, un cliente nuevo
    const candidatos = libres.filter((s) => !p.perfil || perfiles.get(s) === p.perfil);
    let slot = candidatos.length ? azar(candidatos) : null;
    if (slot) {
      libres.splice(libres.indexOf(slot), 1);
    } else {
      slot = siguienteExtra++;
      const perfil = p.perfil || azar(PERFILES);
      await crearClienteExtra(slot, perfil, usuarioId);
      perfiles.set(slot, perfil);
      console.log(`  + cliente demo nuevo en el lugar ${slot}`);
    }

    // Sin nombre, conserva el de la empresa demo de ese lugar
    const nombre = (String(p.nombre || '').trim() || empresaDe(slot)).slice(0, 150);
    const correo = String(p.correo || '').trim().slice(0, 150) || null;
    const empresa = String(p.empresa || '').trim().slice(0, 150) || null;
    await pool.request()
      .input('slot', sql.Int, slot)
      .input('nombre', sql.NVarChar(150), nombre)
      .input('celular', sql.VarChar(20), celular)
      .input('correo', sql.NVarChar(150), correo)
      .input('empresa', sql.NVarChar(150), empresa)
      .query(`
        INSERT INTO DemoProspectos (Slot, Nombre, Celular, Correo, Empresa)
        VALUES (@slot, @nombre, @celular, @correo, @empresa)
      `);
    await actualizarCliente(slot, { nombre, celular, correo, empresa });
    console.log(`✓ ${nombre} → lugar ${slot} (${perfiles.get(slot)} pagador)`);
  }
}

if (args.includes('--lista') || archivo) {
  const perfiles = await perfilesActuales();
  const prospectos = new Map((await pool.request().query('SELECT Slot, Nombre, Celular FROM DemoProspectos')).recordset.map((r) => [r.Slot, r]));
  console.log('\nLugar  Perfil  Prospecto');
  for (const s of [...perfiles.keys()].sort((a, b) => a - b)) {
    const p = prospectos.get(s);
    const quien = p ? `${p.Nombre} ••••${p.Celular.slice(-4)}` : s === SLOT_VENDEDOR && process.env.DEMO_CELULAR_REAL ? '(tu celular, DEMO_CELULAR_REAL)' : '—';
    console.log(`${String(s).padStart(5)}  ${(perfiles.get(s) || perfilDe(s)).padEnd(6)}  ${quien}`);
  }
}

await pool.close();
