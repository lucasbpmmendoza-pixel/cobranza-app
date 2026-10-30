// Crea (o reinicia) la cuenta de la demo de solo lectura: la que abre el botón
// "Ver Cobranza" de la demo pública de AICuenta. Es su propia organización, con los 12
// clientes ficticios de siempre (celulares 55500000xx, sin prospectos ni celular real)
// y sus facturas, conceptos y pagos. Nadie entra con contraseña (se le pone una al
// azar): solo por el pase de AICuenta, y la sesión es de solo lectura.
// Correrlo otra vez regenera las facturas (no toca otras organizaciones).
//
// Uso: node scripts/crear-demo-lectura.mjs
// Al final pon en .env (y en Netlify) el DEMO_LECTURA_ORGANIZACION_ID que imprime.
import sql from 'mssql';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import {
  DEMO_SLOTS, EMPRESAS, CORREO_DEMO_LECTURA, rfcSlot, celularFicticio
} from '../src/lib/server/demo-datos.js';
import { conectar, insertarFacturas } from './lib-demo.mjs';

const ORGANIZACION = 'DEMO AICUENTA COBRANZA';

const pool = await conectar();

// Organización demo
let org = (await pool.request().input('razon', sql.NVarChar, ORGANIZACION)
  .query('SELECT Id FROM Organizaciones WHERE RazonSocial = @razon')).recordset[0];
if (!org) {
  org = (await pool.request().input('razon', sql.NVarChar, ORGANIZACION).query(`
    INSERT INTO Organizaciones (RazonSocial, RFC)
    OUTPUT INSERTED.Id
    VALUES (@razon, 'XAXX010101000')
  `)).recordset[0];
}
console.log(`✓ Organización ${ORGANIZACION} (Id ${org.Id})`);

// Usuario: contraseña al azar que nadie conoce
const hash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
let usuario = (await pool.request().input('correo', sql.NVarChar, CORREO_DEMO_LECTURA)
  .query('SELECT Id FROM Usuarios WHERE Correo = @correo')).recordset[0];
if (!usuario) {
  usuario = (await pool.request()
    .input('correo', sql.NVarChar, CORREO_DEMO_LECTURA)
    .input('hash', sql.NVarChar, hash)
    .query(`
      INSERT INTO Usuarios (Correo, Contrasena, Nombre, Apellido, Activo, email_verified)
      OUTPUT INSERTED.Id
      VALUES (@correo, @hash, 'Demo', 'AICuenta', 1, 1)
    `)).recordset[0];
} else {
  await pool.request().input('id', sql.Int, usuario.Id).input('hash', sql.NVarChar, hash)
    .query('UPDATE Usuarios SET Contrasena = @hash, Activo = 1 WHERE Id = @id');
}
console.log(`✓ Usuario ${CORREO_DEMO_LECTURA} (Id ${usuario.Id})`);

// Solo pertenece a la organización demo
const rol = (await pool.request().query(`SELECT Id FROM Roles WHERE Nombre = 'Administrador'`)).recordset[0];
await pool.request().input('u', sql.Int, usuario.Id).input('o', sql.Int, org.Id).input('r', sql.Int, rol.Id).query(`
  DELETE FROM Usuario_Organizacion WHERE UsuarioId = @u AND OrganizacionId <> @o;
  IF EXISTS (SELECT 1 FROM Usuario_Organizacion WHERE UsuarioId = @u AND OrganizacionId = @o)
    UPDATE Usuario_Organizacion SET RolId = @r WHERE UsuarioId = @u AND OrganizacionId = @o
  ELSE
    INSERT INTO Usuario_Organizacion (UsuarioId, OrganizacionId, RolId, FechaAsignacion)
    VALUES (@u, @o, @r, GETDATE())
`);
console.log(`✓ Rol Administrador (RolId ${rol.Id})`);

// Clientes ficticios, uno por lugar
const clientes = [];
for (let slot = 1; slot <= DEMO_SLOTS; slot++) {
  const empresa = EMPRESAS[slot - 1];
  const celular = celularFicticio(slot);
  const r = await pool.request()
    .input('o', sql.Int, org.Id)
    .input('rfc', sql.NVarChar, rfcSlot(slot))
    .input('razon', sql.NVarChar, empresa.toUpperCase())
    .input('comercial', sql.NVarChar, empresa)
    .input('tel', sql.NVarChar, celular)
    .input('correo', sql.NVarChar, `cliente${slot}@demo.example`)
    .query(`
      IF EXISTS (SELECT 1 FROM Clientes WHERE OrganizacionId = @o AND RFC = @rfc)
        UPDATE Clientes SET RazonSocial = @razon, NombreComercial = @comercial, Telefono = @tel,
          TelefonoWhatsApp = @tel, CorreoPrincipal = @correo, CondicionesPago = '30-dias'
        OUTPUT INSERTED.Id
        WHERE OrganizacionId = @o AND RFC = @rfc
      ELSE
        INSERT INTO Clientes (OrganizacionId, RazonSocial, NombreComercial, RFC, Telefono, TelefonoWhatsApp, CorreoPrincipal, CondicionesPago)
        OUTPUT INSERTED.Id
        VALUES (@o, @razon, @comercial, @rfc, @tel, @tel, @correo, '30-dias')
    `);
  clientes.push({ slot, id: r.recordset[0].Id });
}
console.log(`✓ ${clientes.length} clientes demo`);

// Facturas: se borran las de la organización demo y se generan de nuevo (folios DEMOL-…,
// porque los DEMO-… ya son de la demo de expo)
await pool.request().input('o', sql.Int, org.Id).query(`
  DELETE p FROM Pagos p INNER JOIN Facturas f ON p.FacturaId = f.Id INNER JOIN Clientes c ON f.ClienteId = c.Id WHERE c.OrganizacionId = @o;
  DELETE cf FROM ConceptosFactura cf INNER JOIN Facturas f ON cf.FacturaId = f.Id INNER JOIN Clientes c ON f.ClienteId = c.Id WHERE c.OrganizacionId = @o;
  DELETE f FROM Facturas f INNER JOIN Clientes c ON f.ClienteId = c.Id WHERE c.OrganizacionId = @o;
`);

let total = 0;
for (const c of clientes) {
  total += await insertarFacturas(pool, c.id, c.slot, usuario.Id, undefined, new Date(), 'DEMOL-');
  process.stdout.write(`\r✓ Facturas generadas: ${total}`);
}

console.log(`\n\nListo. Agrega a tu .env y a Netlify:\nDEMO_LECTURA_ORGANIZACION_ID=${org.Id}`);
await pool.close();
