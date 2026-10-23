// Lee Serie/Folio directamente del XML del CFDI guardado en la BD.
// Uso: node scripts/diag-xml.mjs DMM-1730
import sql from 'mssql';
import 'dotenv/config';

const arg = process.argv[2];
const pool = await sql.connect({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: { encrypt: true, trustServerCertificate: false }
});

const { recordset } = await pool
  .request()
  .input('arg', sql.NVarChar, arg)
  .query(`SELECT Id, numero_factura, NumeroFacturaFacturapi, UUID,
                 CAST(XMLBase64 AS NVARCHAR(MAX)) AS XMLBase64
          FROM Facturas WHERE UUID = @arg OR numero_factura = @arg`);

for (const f of recordset) {
  console.log('numero_factura      :', f.numero_factura);
  console.log('col NumeroFacturaFacturapi:', f.NumeroFacturaFacturapi ?? '(vacio)');
  if (!f.XMLBase64) {
    console.log('No hay XMLBase64 guardado.');
    continue;
  }
  const xml = Buffer.from(f.XMLBase64, 'base64').toString('utf8');
  const serie = xml.match(/Serie="([^"]*)"/i)?.[1];
  const folio = xml.match(/Folio="([^"]*)"/i)?.[1];
  console.log('XML Serie           :', serie);
  console.log('XML Folio           :', folio);
  console.log('folio real CFDI     :', `${serie || ''}${folio || ''}`);
}

await pool.close();
