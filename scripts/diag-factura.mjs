// Diagnostico de una factura: compara numero interno vs folio real del CFDI.
// Uso: node scripts/diag-factura.mjs DD97C1C1-A5D3-4783-A146-228BB11FE60B
import sql from 'mssql';
import axios from 'axios';
import 'dotenv/config';

const arg = process.argv[2];
if (!arg) {
  console.error('Falta el UUID o el numero de factura. Ej: node scripts/diag-factura.mjs DMM-1730');
  process.exit(1);
}

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
  .query(`
    SELECT f.Id, f.numero_factura, f.NumeroFacturaFacturapi, f.FacturapiId,
           f.UUID, f.Timbrado, f.FechaEmision,
           co.facturapi_key AS FacturapiKey
    FROM Facturas f
    INNER JOIN Clientes c ON f.ClienteId = c.Id
    INNER JOIN Organizaciones o ON c.OrganizacionId = o.Id
    LEFT JOIN configuracion_organizacion co ON o.Id = co.organizacion_id
    WHERE f.UUID = @arg OR f.numero_factura = @arg
  `);

if (!recordset.length) {
  console.log('No se encontro ninguna factura con ese UUID/numero.');
  await pool.close();
  process.exit(0);
}

for (const f of recordset) {
  console.log('==============================');
  console.log('Id BD                :', f.Id);
  console.log('numero_factura (app) :', f.numero_factura);
  console.log('NumeroFacturaFacturapi (col):', f.NumeroFacturaFacturapi ?? '(vacio)');
  console.log('FacturapiId          :', f.FacturapiId);
  console.log('Timbrado             :', f.Timbrado);
  console.log('FechaEmision         :', f.FechaEmision);

  if (f.FacturapiId && f.FacturapiKey) {
    try {
      const { data: inv } = await axios.get(
        `https://www.facturapi.io/v2/invoices/${f.FacturapiId}`,
        { auth: { username: f.FacturapiKey, password: '' } }
      );
      console.log('--- Facturapi (folio real del CFDI) ---');
      console.log('series               :', inv.series);
      console.log('folio_number         :', inv.folio_number);
      console.log('folio real           :', `${inv.series || ''}${inv.folio_number}`);
    } catch (e) {
      console.log('Error consultando Facturapi:', e.response?.data || e.message);
    }
  } else {
    console.log('(sin FacturapiId o sin API key, no se consulta Facturapi)');
  }
}

await pool.close();
