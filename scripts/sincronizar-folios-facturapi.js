import 'dotenv/config';
import FacturapiPkg from 'facturapi';
const Facturapi = FacturapiPkg?.default?.default ?? FacturapiPkg?.default ?? FacturapiPkg;
import fs from 'fs';

// Jala todas las facturas de FacturAPI entre abril y hoy y las guarda en facturas-facturapi.json
//
// Uso:
//   node scripts/sincronizar-folios-facturapi.js
//   node scripts/sincronizar-folios-facturapi.js --desde=2026-01-01
//   node scripts/sincronizar-folios-facturapi.js --salida=mis-facturas.json

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const limpio = arg.replace(/^--/, '');
    const [key, ...rest] = limpio.split('=');
    return [key, rest.length > 0 ? rest.join('=') : true];
  })
);

const desde = args.desde || `${new Date().getFullYear()}-04-01`;
const archivoSalida = args.salida || 'facturas-facturapi.json';
const apiKey = process.env.FACTURAPI_KEY;

if (!apiKey) {
  console.error('Falta FACTURAPI_KEY en el .env');
  process.exit(1);
}

const facturapi = new Facturapi(apiKey);
const fechaDesde = new Date(`${desde}T00:00:00.000Z`);
const fechaHasta = new Date();

console.log(`Desde: ${fechaDesde.toISOString()}`);
console.log(`Hasta: ${fechaHasta.toISOString()}`);

const todas = [];
let pagina = 1;
let totalPaginas = 1;

do {
  const resultado = await facturapi.invoices.list({
    date: { gte: fechaDesde, lt: fechaHasta },
    page: pagina,
    limit: 100
  });

  totalPaginas = resultado.total_pages || 1;

  for (const inv of resultado.data || []) {
    const serie = inv.series ? String(inv.series).trim() : '';
    const folio = inv.folio_number !== null && inv.folio_number !== undefined
      ? String(inv.folio_number).trim()
      : '';
    const folioCompleto = serie && folio ? `${serie}-${folio}` : folio || serie || '';

    todas.push({
      id: inv.id,
      uuid: inv.uuid,
      folio: folioCompleto,
      serie: serie,
      folio_number: inv.folio_number,
      status: inv.status,
      fecha: inv.date
    });
  }

  console.log(`Pagina ${pagina}/${totalPaginas} — total acumulado: ${todas.length}`);
  pagina++;
} while (pagina <= totalPaginas);

fs.writeFileSync(archivoSalida, JSON.stringify(todas, null, 2), 'utf-8');
console.log(`\nGuardadas ${todas.length} facturas en ${archivoSalida}`);
