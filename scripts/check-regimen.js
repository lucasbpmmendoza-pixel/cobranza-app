import sql from 'mssql';

const config = {
  user: 'mmendoza-server-admin',
  password: 'P@to0102',
  server: 'mmendoza-server.database.windows.net',
  database: 'Cobranza',
  options: { encrypt: true, trustServerCertificate: false }
};

(async () => {
  await sql.connect(config);

  // 1. Todos los clientes con ese RFC en todas las organizaciones
  const result = await sql.query(`
    SELECT c.Id, c.RFC, c.OrganizacionId, c.RegimenFiscalId,
           r.ID_Regimen, r.Codigo, r.Descripcion
    FROM Clientes c
    LEFT JOIN Regimen r ON c.RegimenFiscalId = r.ID_Regimen
    WHERE c.RFC = 'TAM241022HS9'
  `);
  console.log('--- Clientes con ese RFC ---');
  console.table(result.recordset);

  // 2. Lo que devolvería clientes-disponibles para ese RFC
  const result2 = await sql.query(`
    SELECT TOP 5
      c.Id, c.RFC, r.Codigo as regimenFiscal
    FROM Clientes c
    LEFT JOIN Facturas f ON c.Id = f.ClienteId
    LEFT JOIN Regimen r ON c.RegimenFiscalId = r.ID_Regimen
    WHERE c.RFC = 'TAM241022HS9'
    GROUP BY c.Id, c.RFC, r.Codigo
  `);
  console.log('--- Resultado clientes-disponibles ---');
  console.table(result2.recordset);

  // 3. Lo que devolvería facturas list para ese cliente
  const result3 = await sql.query(`
    SELECT TOP 3
      c.RFC,
      r.Codigo as ClienteRegimenFiscalCodigo,
      r.Descripcion as ClienteRegimenFiscalDescripcion
    FROM Facturas f
    INNER JOIN Clientes c ON f.ClienteId = c.Id
    LEFT JOIN Regimen r ON c.RegimenFiscalId = r.ID_Regimen
    WHERE c.RFC = 'TAM241022HS9'
  `);
  console.log('--- Resultado facturas list ---');
  console.table(result3.recordset);

  console.table(result3.recordset);
  await sql.close();
})().catch(e => { console.error(e.message); process.exit(1); });
