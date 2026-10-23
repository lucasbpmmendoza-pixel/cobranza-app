// Crea (o reinicia) la cuenta de la demo de expo: berniluck@gmail.com como Administrador
// de su propia organización, con 12 clientes ficticios y sus facturas, conceptos y
// pagos, para que Inicio, Por cobrar, Clientes, Pagos y Reportes se vean vivos.
// Correrlo otra vez regenera las facturas de la demo (no toca otras organizaciones).
//
// Uso: node scripts/crear-demo-berniluck.mjs ["<contraseña>"]
//   La contraseña es obligatoria la primera vez; después solo si la quieres cambiar.
// Al final pon en .env el DEMO_ORGANIZACION_ID que imprime.
import sql from 'mssql';
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import {
  DEMO_SLOTS, SLOT_VENDEDOR, EMPRESAS, rfcSlot, celularFicticio, normalizarCelular, generarFacturas
} from '../src/lib/server/demo-datos.js';

const CORREO = 'berniluck@gmail.com';
const ORGANIZACION = 'DEMO EXPO COBRANZA';
const DIAS_CREDITO = 30;
const ESTADO = { vigente: 1, parcial: 2, pagada: 3, vencida: 4 };

const contrasena = process.argv[2];

const pool = await sql.connect({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: { encrypt: true, trustServerCertificate: false }
});

// Tabla de prospectos (ver scripts/create-demo-prospectos-table.sql)
await pool.request().query(`
  IF OBJECT_ID('DemoProspectos', 'U') IS NULL
  CREATE TABLE DemoProspectos (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Slot INT NOT NULL,
    Nombre NVARCHAR(150) NOT NULL,
    Celular VARCHAR(20) NOT NULL,
    Correo NVARCHAR(150) NULL,
    Empresa NVARCHAR(150) NULL,
    FechaRegistro DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_DemoProspectos_Slot UNIQUE (Slot)
  )
`);
console.log('✓ Tabla DemoProspectos');

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

// Usuario
let usuario = (await pool.request().input('correo', sql.NVarChar, CORREO)
  .query('SELECT Id FROM Usuarios WHERE Correo = @correo')).recordset[0];
if (!usuario && !contrasena) {
  console.error('La cuenta no existe todavía: pasa la contraseña. Ej: node scripts/crear-demo-berniluck.mjs "MiContraseña"');
  process.exit(1);
}
if (!usuario) {
  usuario = (await pool.request()
    .input('correo', sql.NVarChar, CORREO)
    .input('hash', sql.NVarChar, await bcrypt.hash(contrasena, 10))
    .query(`
      INSERT INTO Usuarios (Correo, Contrasena, Nombre, Apellido, Activo, email_verified)
      OUTPUT INSERTED.Id
      VALUES (@correo, @hash, 'Luck', 'Berni', 1, 1)
    `)).recordset[0];
} else if (contrasena) {
  await pool.request().input('id', sql.Int, usuario.Id).input('hash', sql.NVarChar, await bcrypt.hash(contrasena, 10))
    .query('UPDATE Usuarios SET Contrasena = @hash, Activo = 1 WHERE Id = @id');
}
console.log(`✓ Usuario ${CORREO} (Id ${usuario.Id})`);

// Usuario → organización como Administrador (para que pueda agregar usuarios)
const rol = (await pool.request().query(`SELECT Id FROM Roles WHERE Nombre = 'Administrador'`)).recordset[0];
await pool.request().input('u', sql.Int, usuario.Id).input('o', sql.Int, org.Id).input('r', sql.Int, rol.Id).query(`
  IF EXISTS (SELECT 1 FROM Usuario_Organizacion WHERE UsuarioId = @u AND OrganizacionId = @o)
    UPDATE Usuario_Organizacion SET RolId = @r WHERE UsuarioId = @u AND OrganizacionId = @o
  ELSE
    INSERT INTO Usuario_Organizacion (UsuarioId, OrganizacionId, RolId, FechaAsignacion)
    VALUES (@u, @o, @r, GETDATE())
`);
console.log(`✓ Rol Administrador (RolId ${rol.Id})`);

// Clientes: uno por lugar. Si un prospecto ocupa el lugar, conserva su nombre y celular.
const prospectos = new Map((await pool.request().query('SELECT * FROM DemoProspectos')).recordset.map((p) => [p.Slot, p]));
const clientes = [];
for (let slot = 1; slot <= DEMO_SLOTS; slot++) {
  const p = prospectos.get(slot);
  const empresa = p?.Empresa || EMPRESAS[slot - 1];
  let nombre = p?.Nombre || empresa;
  let celular = p ? normalizarCelular(p.Celular) : celularFicticio(slot);
  if (slot === SLOT_VENDEDOR && process.env.DEMO_CELULAR_REAL) {
    nombre = process.env.DEMO_NOMBRE_REAL || empresa;
    celular = normalizarCelular(process.env.DEMO_CELULAR_REAL);
  }
  const r = await pool.request()
    .input('o', sql.Int, org.Id)
    .input('rfc', sql.NVarChar, rfcSlot(slot))
    .input('razon', sql.NVarChar, nombre.toUpperCase())
    .input('comercial', sql.NVarChar, empresa)
    .input('tel', sql.NVarChar, celular)
    .input('correo', sql.NVarChar, p?.Correo || `cliente${slot}@demo.example`)
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

// Facturas: se borran las de la organización demo y se generan de nuevo
await pool.request().input('o', sql.Int, org.Id).query(`
  DELETE p FROM Pagos p INNER JOIN Facturas f ON p.FacturaId = f.Id INNER JOIN Clientes c ON f.ClienteId = c.Id WHERE c.OrganizacionId = @o;
  DELETE cf FROM ConceptosFactura cf INNER JOIN Facturas f ON cf.FacturaId = f.Id INNER JOIN Clientes c ON f.ClienteId = c.Id WHERE c.OrganizacionId = @o;
  DELETE f FROM Facturas f INNER JOIN Clientes c ON f.ClienteId = c.Id WHERE c.OrganizacionId = @o;
`);

const hoy = new Date();
let total = 0;
for (const c of clientes) {
  for (const f of generarFacturas(c.slot, hoy)) {
    const vencimiento = new Date(f.emision.getTime() + DIAS_CREDITO * 86400000);
    const saldo = f.monto - f.pagado;
    const diasVencido = saldo > 0 ? Math.max(0, Math.floor((hoy - vencimiento) / 86400000)) : 0;
    const estado = saldo <= 0 ? ESTADO.pagada : f.pagado > 0 ? ESTADO.parcial : diasVencido > 0 ? ESTADO.vencida : ESTADO.vigente;
    const subtotal = Math.round((f.monto / 1.16) * 100) / 100;

    await pool.request()
      .input('cliente', sql.Int, c.id)
      .input('usuario', sql.Int, usuario.Id)
      .input('monto', sql.Decimal(18, 2), f.monto)
      .input('saldo', sql.Decimal(18, 2), saldo)
      .input('pagado', sql.Decimal(18, 2), f.pagado)
      .input('emision', sql.DateTime, f.emision)
      .input('vencimiento', sql.DateTime, vencimiento)
      .input('fechaPago', sql.DateTime, f.fechaPago)
      .input('dias', sql.Int, diasVencido)
      .input('estado', sql.Int, estado)
      .input('folio', sql.VarChar, f.folio)
      .input('uuid', sql.NVarChar, f.uuid)
      .input('concepto', sql.NVarChar, f.concepto)
      .input('subtotal', sql.Decimal(18, 2), subtotal)
      .input('impuestos', sql.Decimal(18, 2), Math.round((f.monto - subtotal) * 100) / 100)
      .query(`
        DECLARE @id INT;
        INSERT INTO Facturas (
          ClienteId, MontoTotal, SaldoPendiente, FechaEmision, FechaVencimiento, DiasVencido,
          estado_factura_id, prioridad_cobranza_id, numero_factura, Moneda, TipoCambio, CondicionesPago,
          MetodoPago, FormaPago, UsoCFDI, UUID, Timbrado, FechaTimbrado, FechaUltimoPago, UsuarioCreadorId, CreatedAt
        ) VALUES (
          @cliente, @monto, @saldo, @emision, @vencimiento, @dias,
          @estado, 2, @folio, 'MXN', 1, '30-dias',
          'PPD', '99', 'G03', @uuid, 1, @emision, CAST(@fechaPago AS DATE), @usuario, @emision
        );
        SET @id = SCOPE_IDENTITY();
        INSERT INTO ConceptosFactura (FacturaId, Nombre, ClaveProdServ, UnidadMedida, Cantidad, PrecioUnitario, Subtotal, ObjetoImpuesto, TotalImpuestos, Total)
        VALUES (@id, @concepto, '84111500', 'E48', 1, @subtotal, @subtotal, '02', @impuestos, @monto);
        IF @pagado > 0
          INSERT INTO Pagos (FacturaId, UsuarioId, Monto, FechaPago, Metodo)
          VALUES (@id, @usuario, @pagado, @fechaPago, '03');
      `);
    total++;
  }
  process.stdout.write(`\r✓ Facturas generadas: ${total}`);
}

console.log(`\n\nListo. Agrega a tu .env:\nDEMO_ORGANIZACION_ID=${org.Id}`);
await pool.close();
