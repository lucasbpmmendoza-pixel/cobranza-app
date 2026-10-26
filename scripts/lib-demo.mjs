// Funciones compartidas por los scripts de la demo de expo
// (crear-demo-berniluck.mjs y demo-prospectos.mjs).
import sql from 'mssql';
import 'dotenv/config';
import { generarFacturas, slotDeRfc, DEMO_SLOTS } from '../src/lib/server/demo-datos.js';

export const CORREO_DEMO = 'berniluck@gmail.com';
const DIAS_CREDITO = 30;
const ESTADO = { vigente: 1, parcial: 2, pagada: 3, vencida: 4 };

export async function conectar() {
  return sql.connect({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: { encrypt: true, trustServerCertificate: false }
  });
}

export async function idUsuarioDemo(pool) {
  const r = await pool.request().input('correo', sql.NVarChar, CORREO_DEMO).query('SELECT Id FROM Usuarios WHERE Correo = @correo');
  if (!r.recordset[0]) throw new Error(`No existe la cuenta ${CORREO_DEMO}; corre primero scripts/crear-demo-berniluck.mjs`);
  return r.recordset[0].Id;
}

/** Crea las facturas, conceptos y pagos ficticios de un cliente demo según su perfil */
export async function insertarFacturas(pool, clienteId, slot, usuarioId, perfil, hoy = new Date()) {
  let total = 0;
  for (const f of generarFacturas(slot, hoy, perfil)) {
    const vencimiento = new Date(f.emision.getTime() + DIAS_CREDITO * 86400000);
    const saldo = f.monto - f.pagado;
    const diasVencido = saldo > 0 ? Math.max(0, Math.floor((hoy - vencimiento) / 86400000)) : 0;
    const estado = saldo <= 0 ? ESTADO.pagada : f.pagado > 0 ? ESTADO.parcial : diasVencido > 0 ? ESTADO.vencida : ESTADO.vigente;
    const subtotal = Math.round((f.monto / 1.16) * 100) / 100;

    await pool.request()
      .input('cliente', sql.Int, clienteId)
      .input('usuario', sql.Int, usuarioId)
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
  return total;
}

/**
 * Borra los clientes demo extra (los que se crearon porque no alcanzaban los
 * DEMO_SLOTS base) con sus facturas, conceptos y pagos, y sus prospectos.
 */
export async function borrarClientesExtra(pool, organizacionId) {
  const clientes = (await pool.request().input('o', sql.Int, organizacionId)
    .query('SELECT Id, RFC FROM Clientes WHERE OrganizacionId = @o')).recordset;
  const extras = clientes.filter((c) => (slotDeRfc(c.RFC) || 0) > DEMO_SLOTS);
  for (const c of extras) {
    await pool.request().input('c', sql.Int, c.Id).query(`
      DELETE p FROM Pagos p INNER JOIN Facturas f ON p.FacturaId = f.Id WHERE f.ClienteId = @c;
      DELETE cf FROM ConceptosFactura cf INNER JOIN Facturas f ON cf.FacturaId = f.Id WHERE f.ClienteId = @c;
      DELETE FROM Facturas WHERE ClienteId = @c;
      DELETE FROM Clientes WHERE Id = @c;
    `);
  }
  await pool.request().input('max', sql.Int, DEMO_SLOTS).query('DELETE FROM DemoProspectos WHERE Slot > @max');
  return extras.length;
}
