// Rellena NumeroFacturaFacturapi (Serie + Folio real del CFDI) en las facturas
// ya timbradas, leyendo el folio directamente del XML guardado en la BD.
//
// Sirve tanto para las timbradas por la app como para las de refacturacion
// (esas no tienen FacturapiId, pero si tienen el XML del CFDI guardado).
//
// Solo toca las facturas del mes indicado (por FechaEmision). Por defecto el
// mes actual, para no revolver los folios de meses anteriores.
//
// Uso:  node scripts/backfill-folios-facturapi.mjs [--dry] [--mes=YYYY-MM] [--todo]
//   --dry   solo muestra, no escribe en la BD
//   --mes   mes objetivo (por defecto el mes actual)
//   --todo  lista tambien las facturas cuyo folio ya coincide (por defecto solo las disparejas)
import sql from 'mssql';
import 'dotenv/config';

const dryRun = process.argv.includes('--dry');

// Mes objetivo: --mes=YYYY-MM, o el mes actual si no se indica.
const argMes = process.argv.find((a) => a.startsWith('--mes='))?.split('=')[1];
const hoy = new Date();
const [anio, mes] = argMes
  ? argMes.split('-').map(Number)
  : [hoy.getFullYear(), hoy.getMonth() + 1];

if (!anio || !mes || mes < 1 || mes > 12) {
  console.error(`Mes invalido: "${argMes}". Usa el formato --mes=YYYY-MM (ej. --mes=2026-08).`);
  process.exit(1);
}

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  requestTimeout: 60000,
  options: { encrypt: true, trustServerCertificate: false }
};

const pool = await sql.connect(config);

// Primero la lista ligera (sin el XML, que es pesado). El XML se lee luego
// factura por factura para no reventar la consulta con muchos blobs.
const { recordset: facturas } = await pool
  .request()
  .input('anio', sql.Int, anio)
  .input('mes', sql.Int, mes)
  .query(`
    SELECT f.Id, f.numero_factura
    FROM Facturas f
    WHERE f.Timbrado = 1
      AND f.XMLBase64 IS NOT NULL
      AND (f.NumeroFacturaFacturapi IS NULL OR f.NumeroFacturaFacturapi = '')
      AND YEAR(f.FechaEmision) = @anio
      AND MONTH(f.FechaEmision) = @mes
    ORDER BY f.Id
  `);

const etiquetaMes = `${anio}-${String(mes).padStart(2, '0')}`;
console.log(`Facturas por actualizar (${etiquetaMes}): ${facturas.length}${dryRun ? ' (dry run)' : ''}`);

// Solo se muestra con --todo; por defecto solo interesan las disparejas.
const soloDisparejas = !process.argv.includes('--todo');

let actualizadas = 0;
let disparejas = 0;
let errores = 0;

for (const factura of facturas) {
  try {
    const { recordset } = await pool
      .request()
      .input('id', sql.Int, factura.Id)
      .query('SELECT CAST(XMLBase64 AS NVARCHAR(MAX)) AS XMLBase64 FROM Facturas WHERE Id = @id');
    const xmlBase64 = recordset[0]?.XMLBase64;
    if (!xmlBase64) {
      console.warn(`- ${factura.numero_factura}: sin XML, se omite`);
      errores++;
      continue;
    }

    const xml = Buffer.from(xmlBase64, 'base64').toString('utf8');
    const serie = xml.match(/Serie="([^"]*)"/i)?.[1] ?? '';
    const folio = xml.match(/Folio="([^"]*)"/i)?.[1];

    if (!folio) {
      console.warn(`- ${factura.numero_factura}: el XML no trae Folio, se omite`);
      errores++;
      continue;
    }

    const folioFiscal = `${serie}${folio}`;

    // "Dispareja" = el folio real del CFDI no coincide con el numero interno.
    // Se compara ignorando el guion (DMM-1730 vs DMM688).
    const esDispareja = factura.numero_factura.replace('-', '') !== folioFiscal;
    if (esDispareja) disparejas++;

    if (!soloDisparejas || esDispareja) {
      console.log(`- ${factura.numero_factura} -> ${folioFiscal}${esDispareja ? '   <-- DISPAREJA' : ''}`);
    }

    if (!dryRun) {
      await pool
        .request()
        .input('folio', sql.NVarChar, folioFiscal)
        .input('id', factura.Id)
        .query('UPDATE Facturas SET NumeroFacturaFacturapi = @folio WHERE Id = @id');
    }
    actualizadas++;
  } catch (error) {
    console.error(`- ${factura.numero_factura}: error`, error.message);
    errores++;
  }
}

console.log(
  `Listo. Actualizadas: ${actualizadas} (disparejas: ${disparejas}, iguales: ${actualizadas - disparejas}), con problema: ${errores}`
);
await pool.close();
