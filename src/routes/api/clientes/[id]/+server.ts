import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConnection } from '$lib/server/db';
import sql from 'mssql';

// GET - Obtener un cliente individual
export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const { id } = params;
		const organizacionId = url.searchParams.get('organizacionId');

		if (!organizacionId) {
			return json({ error: 'organizacionId es requerido' }, { status: 400 });
		}

		const pool = await getConnection();

		// Consulta para obtener el cliente individual con toda su información
		const result = await pool
			.request()
			.input('ClienteId', sql.Int, parseInt(id))
			.input('OrganizacionId', sql.Int, parseInt(organizacionId))
			.query(`
				SELECT
					c.Id,
					c.NombreComercial,
					c.RazonSocial,
					c.RFC,
					c.RegimenFiscalId,
				r.Codigo as RegimenFiscal,
					c.CondicionesPago,
					c.CorreoPrincipal,
					c.PaisId,
					p.NombrePais as Pais,
					c.CodigoPais,
					c.Telefono,
					c.EstadoId,
					e.NombreEstado as Estado,
					c.Calle,
					c.NumeroExterior,
					c.NumeroInterior,
					c.CodigoPostal,
					c.Colonia,
					c.Ciudad,
					c.OrganizacionId
				FROM Clientes c
				LEFT JOIN Regimen r ON c.RegimenFiscalId = r.ID_Regimen
				LEFT JOIN Estados e ON c.EstadoId = e.ID
				LEFT JOIN Paises p ON c.PaisId = p.ID
				WHERE c.Id = @ClienteId
					AND c.OrganizacionId = @OrganizacionId
			`);

		if (result.recordset.length === 0) {
			return json({ error: 'Cliente no encontrado' }, { status: 404 });
		}

		const cliente = result.recordset[0];

		return json(cliente);
	} catch (err) {
		return json({ error: 'Error en el servidor' }, { status: 500 });
	}
};

// PUT - Actualizar cliente
export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const { id } = params;
		const clienteData = await request.json();

		const pool = await getConnection();

		await pool
			.request()
			.input('Id', sql.Int, parseInt(id))
			.input('NombreComercial', sql.NVarChar(200), clienteData.NombreComercial || null)
			.input('RazonSocial', sql.NVarChar(200), clienteData.RazonSocial || null)
			.input('RFC', sql.NVarChar(13), clienteData.RFC || null)
			.input('RegimenFiscalId', sql.Int, clienteData.RegimenFiscalId || null)
			.input('CondicionesPago', sql.NVarChar(50), clienteData.CondicionesPago || null)
			.input('CorreoPrincipal', sql.NVarChar(100), clienteData.CorreoPrincipal || null)
			.input('PaisId', sql.Int, clienteData.PaisId || null)
			.input('CodigoPais', sql.NVarChar(10), clienteData.CodigoPais || null)
			.input('Telefono', sql.NVarChar(20), clienteData.Telefono || null)
			.input('EstadoId', sql.Int, clienteData.EstadoId || null)
			.input('Calle', sql.NVarChar(200), clienteData.Calle || null)
			.input('NumeroExterior', sql.NVarChar(20), clienteData.NumeroExterior || null)
			.input('NumeroInterior', sql.NVarChar(20), clienteData.NumeroInterior || null)
			.input('CodigoPostal', sql.NVarChar(10), clienteData.CodigoPostal || null)
			.input('Colonia', sql.NVarChar(100), clienteData.Colonia || null)
			.input('Ciudad', sql.NVarChar(100), clienteData.Ciudad || null)
			.query(`
				UPDATE Clientes SET
					NombreComercial = @NombreComercial,
					RazonSocial = @RazonSocial,
					RFC = @RFC,
					RegimenFiscalId = @RegimenFiscalId,
					CondicionesPago = @CondicionesPago,
					CorreoPrincipal = @CorreoPrincipal,
					PaisId = @PaisId,
					CodigoPais = @CodigoPais,
					Telefono = @Telefono,
					EstadoId = @EstadoId,
					Calle = @Calle,
					NumeroExterior = @NumeroExterior,
					NumeroInterior = @NumeroInterior,
					CodigoPostal = @CodigoPostal,
					Colonia = @Colonia,
					Ciudad = @Ciudad
				WHERE Id = @Id
			`);

		return json({ message: 'Cliente actualizado correctamente' });
	} catch (err) {
		return json({ error: 'Error en el servidor' }, { status: 500 });
	}
};

// DELETE - Eliminar cliente
export const DELETE: RequestHandler = async ({ params, url }) => {
	try {
		const { id } = params;
		const organizacionId = url.searchParams.get('organizacionId');
		const pool = await getConnection();

		// Verificar que el cliente pertenece a la organización
		if (organizacionId) {
			const check = await pool
				.request()
				.input('Id', sql.Int, parseInt(id))
				.input('OrganizacionId', sql.Int, parseInt(organizacionId))
				.query(`SELECT Id FROM Clientes WHERE Id = @Id AND OrganizacionId = @OrganizacionId`);

			if (check.recordset.length === 0) {
				return json({ error: 'Cliente no encontrado o no pertenece a su organización' }, { status: 404 });
			}
		}

		const transaction = new sql.Transaction(pool);
		await transaction.begin();

		try {
			const req = () => new sql.Request(transaction).input('ClienteId', sql.Int, parseInt(id));

			// Obtener IDs de facturas del cliente
			const facturas = await req().query(`SELECT Id FROM Facturas WHERE ClienteId = @ClienteId`);
			const facturaIds = facturas.recordset.map((f: any) => f.Id);

			if (facturaIds.length > 0) {
				const placeholders = facturaIds.map((_: any, i: number) => `@fid${i}`).join(',');

				const delReq = (q: string) => {
					const r = new sql.Request(transaction);
					facturaIds.forEach((fid: number, i: number) => r.input(`fid${i}`, sql.Int, fid));
					return r.query(q);
				};

				await delReq(`DELETE FROM Recordatorios WHERE FacturaId IN (${placeholders})`);
				await delReq(`DELETE FROM Pagos WHERE FacturaId IN (${placeholders})`);
				await delReq(`DELETE FROM ConceptosFactura WHERE FacturaId IN (${placeholders})`);
				await delReq(`DELETE FROM Facturas WHERE Id IN (${placeholders})`);
			}

			// Eliminar agentes asignados al cliente si existe la tabla
			await req().query(`DELETE FROM ClienteAgentes WHERE ClienteId = @ClienteId`).catch(() => {});

			// Eliminar el cliente
			await req().query(`DELETE FROM Clientes WHERE Id = @ClienteId`);

			await transaction.commit();
			return json({ message: 'Cliente eliminado correctamente' });
		} catch (err) {
			await transaction.rollback();
			throw err;
		}
	} catch (err) {
		console.error('Error al eliminar cliente:', err);
		return json({ error: err instanceof Error ? err.message : 'Error en el servidor' }, { status: 500 });
	}
};
