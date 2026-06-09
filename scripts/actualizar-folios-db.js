import 'dotenv/config';
import sql from 'mssql';
import fs from 'fs';

// Lee facturas-facturapi.json y actualiza NumeroFacturaFacturapi en la DB por UUID.
//
// Uso:
//   node scripts/actualizar-folios-db.js
//   node scripts/actualizar-folios-db.js --apply
//   node scripts/actualizar-folios-db.js --archivo=mis-facturas.json --apply

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const limpio = arg.replace(/^--/, '');
    const [key, ...rest] = limpio.split('=');
    return [key, rest.length > 0 ? rest.join('=') : true];
  })
);

const aplicar = args.apply === true || args.apply === 'true';
const archivo = args.archivo || 'facturas-facturapi.json';

if (!fs.existsSync(archivo)) {
  console.error(`No se encontro el archivo: ${archivo}`);
  console.error('Corre primero: node scripts/sincronizar-folios-facturapi.js');
  process.exit(1);
}

const facturasFacturapi = JSON.parse(fs.readFileSync(archivo, 'utf-8'));
console.log(`Facturas en el archivo: ${facturasFacturapi.length}`);

// Construir mapa uuid -> folio (solo los que tienen folio)
const mapaFolios = new Map();
for (const f of facturasFacturapi) {
  if (f.uuid && f.folio) {
    mapaFolios.set(f.uuid.toLowerCase(), f.folio);
  }
}
console.log(`Con folio valido: ${mapaFolios.size}`);

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
  }
};

const pool = await sql.connect(dbConfig);

// Traer todas las facturas de la DB que tengan UUID pero no tengan NumeroFacturaFacturapi
const result = await pool.request().query(`
  SELECT Id, UUID, numero_factura, NumeroFacturaFacturapi
  FROM Facturas
  WHERE UUID IS NOT NULL
    AND LTRIM(RTRIM(UUID)) <> ''
    AND (NumeroFacturaFacturapi IS NULL OR LTRIM(RTRIM(NumeroFacturaFacturapi)) = '')
`);

const facturasDB = result.recordset;
console.log(`Facturas en DB sin NumeroFacturaFacturapi: ${facturasDB.length}`);
console.log(aplicar ? 'Modo: APLICAR CAMBIOS' : 'Modo: DRY-RUN\n');

let actualizadas = 0;
let sinMatch = 0;

for (const fac of facturasDB) {
  const uuid = (fac.UUID || '').toLowerCase().trim();
  const folio = mapaFolios.get(uuid);

  if (!folio) {
    sinMatch++;
    continue;
  }

  if (aplicar) {
    await pool.request()
      .input('Folio', sql.NVarChar(100), folio)
      .input('Id', sql.Int, fac.Id)
      .query(`UPDATE Facturas SET NumeroFacturaFacturapi = @Folio WHERE Id = @Id`);
    console.log(`+ Id ${fac.Id}: ${fac.numero_factura} -> ${folio}`);
  } else {
    console.log(`* Id ${fac.Id}: ${fac.numero_factura} -> ${folio}`);
  }

  actualizadas++;
}

await pool.close();

console.log(`\nResumen`);
console.log(`Con match: ${actualizadas}`);
console.log(`Sin match: ${sinMatch}`);

if (!aplicar && actualizadas > 0) {
  console.log('\nPara escribir los cambios agrega --apply');
}
