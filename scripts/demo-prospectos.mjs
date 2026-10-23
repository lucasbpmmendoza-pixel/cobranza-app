// Carga los prospectos de la expo en la demo: cada uno toma el lugar de un cliente demo
// (nombre y celular), en orden, empezando por los que deben dinero, para que el botón
// Cobranza les mande su cobro por WhatsApp.
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
import 'dotenv/config';
import {
  DEMO_SLOTS, SLOT_VENDEDOR, EMPRESAS, rfcSlot, celularFicticio, normalizarCelular, perfilDe
} from '../src/lib/server/demo-datos.js';

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
const reiniciar = args.includes('--reiniciar');
const organizacionId = Number(process.env.DEMO_ORGANIZACION_ID);
if (!organizacionId) {
  console.error('Falta DEMO_ORGANIZACION_ID en .env');
  process.exit(1);
}

const pool = await sql.connect({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: { encrypt: true, trustServerCertificate: false }
});

async function actualizarCliente(slot, { nombre, celular, correo, empresa }) {
  await pool.request()
    .input('o', sql.Int, organizacionId)
    .input('rfc', sql.NVarChar, rfcSlot(slot))
    .input('razon', sql.NVarChar, nombre.toUpperCase())
    .input('comercial', sql.NVarChar, empresa || EMPRESAS[slot - 1])
    .input('tel', sql.NVarChar, celular)
    .input('correo', sql.NVarChar, correo || `cliente${slot}@demo.example`)
    .query(`
      UPDATE Clientes SET RazonSocial = @razon, NombreComercial = @comercial, Telefono = @tel,
        TelefonoWhatsApp = @tel, CorreoPrincipal = @correo
      WHERE OrganizacionId = @o AND RFC = @rfc
    `);
}

if (reiniciar) {
  const slots = (await pool.request().query('SELECT Slot FROM DemoProspectos')).recordset.map((r) => r.Slot);
  for (const slot of slots) {
    const empresa = EMPRESAS[slot - 1];
    await actualizarCliente(slot, { nombre: empresa, celular: celularFicticio(slot), correo: null, empresa });
  }
  await pool.request().query('DELETE FROM DemoProspectos');
  console.log(`✓ Se quitaron ${slots.length} prospectos; sus clientes volvieron a los datos ficticios`);
}

if (archivo) {
  const lista = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const ocupados = new Set((await pool.request().query('SELECT Slot FROM DemoProspectos')).recordset.map((r) => r.Slot));
  const libres = [];
  for (let s = 1; s <= DEMO_SLOTS; s++) if (s !== SLOT_VENDEDOR && !ocupados.has(s)) libres.push(s);

  for (const p of lista) {
    const celular = normalizarCelular(p.celular);
    if (celular.length < 10 || celular.length > 15) {
      console.warn(`✗ Se omite ${JSON.stringify(p)}: el celular no es válido`);
      continue;
    }
    // "perfil" opcional (malo | medio | bueno): toma el primer lugar libre de ese perfil
    const idx = p.perfil ? libres.findIndex((s) => perfilDe(s) === p.perfil) : 0;
    const slot = idx >= 0 ? libres.splice(idx, 1)[0] : undefined;
    if (!slot) {
      console.warn(`✗ Ya no hay lugares libres${p.perfil ? ` de perfil ${p.perfil}` : ''} para ${p.nombre || celular}`);
      continue;
    }
    // Sin nombre, conserva el de la empresa demo de ese lugar
    const nombre = (String(p.nombre || '').trim() || EMPRESAS[slot - 1]).slice(0, 150);
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
    console.log(`✓ ${nombre} → lugar ${slot} (${perfilDe(slot)} pagador)`);
  }
}

if (args.includes('--lista') || archivo) {
  const prospectos = new Map((await pool.request().query('SELECT Slot, Nombre, Celular FROM DemoProspectos')).recordset.map((r) => [r.Slot, r]));
  console.log('\nLugar  Perfil  Prospecto');
  for (let s = 1; s <= DEMO_SLOTS; s++) {
    const p = prospectos.get(s);
    const quien = s === SLOT_VENDEDOR ? '(tu celular, DEMO_CELULAR_REAL)' : p ? `${p.Nombre} ••••${p.Celular.slice(-4)}` : '—';
    console.log(`${String(s).padStart(5)}  ${perfilDe(s).padEnd(6)}  ${quien}`);
  }
}

await pool.close();
