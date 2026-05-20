import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConnection } from '$lib/server/db';
import sql from 'mssql';
import { getUserFromRequest, unauthorizedResponse } from '$lib/server/auth';
import axios from 'axios';

type ResultadoCancelacionFacturapi = 'cancelada' | 'ya_cancelada' | 'no_encontrada';

async function cancelarDocumentoFacturapi(documentoId: string, apiKey: string, motivo = '02'): Promise<ResultadoCancelacionFacturapi> {
  try {
    await axios.delete(
      `https://www.facturapi.io/v2/invoices/${documentoId}?motive=${motivo}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    return 'cancelada';
  } catch (facturapiError: any) {
    const status = facturapiError.response?.status;
    const message = facturapiError.response?.data?.message || facturapiError.message;
    const mensajeNormalizado = String(message).toLowerCase();

    if (status === 404) {
      return 'no_encontrada';
    }

    if (
      mensajeNormalizado.includes('estatus "canceled"') ||
      mensajeNormalizado.includes('status "canceled"') ||
      mensajeNormalizado.includes("status 'canceled'") ||
      mensajeNormalizado.includes('ya fue cancelada')
    ) {
      return 'ya_cancelada';
    }

    throw new Error(message);
  }
}

export const GET: RequestHandler = async (event) => {
  // Verificar autenticación
  const user = getUserFromRequest(event);
  if (!user) {
    return unauthorizedResponse('Token de autenticación requerido');
  }

  const { params, url } = event;
  try {
    const { id } = params;
    const organizacionId = url.searchParams.get('organizacionId');

    if (!organizacionId) {
      return json({
        success: false,
        error: 'organizacionId es requerido'
      }, { status: 400 });
    }

    const pool = await getConnection();

    // Query para obtener la factura individual con saldo y días vencido calculados dinámicamente
    const facturaQuery = `
      SELECT
        f.Id,
        f.ClienteId,
        f.numero_factura,
        f.MontoTotal,
        ISNULL(f.MontoTotal - ISNULL(pagos.TotalPagado, 0), f.MontoTotal) as SaldoPendiente,
        f.FechaEmision,
        f.FechaVencimiento,
        DATEDIFF(day, CAST(GETDATE() AS DATE), CAST(f.FechaVencimiento AS DATE)) as DiasVencido,
        f.estado_factura_id,
        f.prioridad_cobranza_id,
        f.MetodoPago,
        f.FormaPago,
        f.CondicionesPago,
        f.UUID,
        f.Timbrado,
        f.FechaTimbrado,
        f.FacturapiId,
        f.PDFUrl,
        f.XMLUrl,
        f.UsuarioCreadorId,
        f.UltimaGestion,
        f.CreatedAt,
        c.RazonSocial as ClienteRazonSocial,
        c.RFC as ClienteRFC,
        c.NombreComercial as ClienteNombreComercial,
        c.CorreoPrincipal as ClienteCorreo,
        c.Telefono as ClienteTelefono,
        c.CodigoPostal as ClienteCodigoPostal,
        r.Codigo as ClienteRegimenFiscalCodigo,
        r.Descripcion as ClienteRegimenFiscalDescripcion,
        ef.codigo as EstadoCodigo,
        pc.codigo as PrioridadCodigo,
        u.Correo as UsuarioCreadorCorreo,
        u.Nombre as UsuarioCreadorNombre,
        u.Apellido as UsuarioCreadorApellido
      FROM Facturas f
      INNER JOIN Clientes c ON f.ClienteId = c.Id
      LEFT JOIN Regimen r ON c.RegimenFiscalId = r.ID_Regimen
      LEFT JOIN estados_factura ef ON f.estado_factura_id = ef.id
      LEFT JOIN prioridades_cobranza pc ON f.prioridad_cobranza_id = pc.id
      LEFT JOIN Usuarios u ON f.UsuarioCreadorId = u.Id
      LEFT JOIN (
        SELECT FacturaId, SUM(Monto) as TotalPagado
        FROM Pagos
        GROUP BY FacturaId
      ) pagos ON f.Id = pagos.FacturaId
      WHERE f.Id = @FacturaId AND c.OrganizacionId = @OrganizacionId
    `;

    const result = await pool.request()
      .input('FacturaId', sql.Int, parseInt(id))
      .input('OrganizacionId', sql.Int, parseInt(organizacionId))
      .query(facturaQuery);

    if (!result || !result.recordset || result.recordset.length === 0) {
      return json({
        success: false,
        error: 'Factura no encontrada'
      }, { status: 404 });
    }

    const row = result.recordset[0];

    // Obtener conceptos de la factura
    const conceptosQuery = `
      SELECT
        Id,
        Nombre,
        Descripcion,
        ClaveProdServ,
        UnidadMedida,
        Cantidad,
        PrecioUnitario,
        Subtotal,
        MonedaProducto,
        ObjetoImpuesto,
        TotalImpuestos,
        Total
      FROM ConceptosFactura
      WHERE FacturaId = @FacturaId
      ORDER BY Id
    `;

    const conceptosResult = await pool.request()
      .input('FacturaId', sql.Int, parseInt(id))
      .query(conceptosQuery);

    // Para cada concepto, obtener sus impuestos
    const conceptos = await Promise.all(
      conceptosResult.recordset.map(async (concepto: any) => {
        const impuestosQuery = `
          SELECT Tipo, Tasa, Monto
          FROM ImpuestosConcepto
          WHERE ConceptoId = @ConceptoId
        `;
        const impuestosResult = await pool.request()
          .input('ConceptoId', sql.Int, concepto.Id)
          .query(impuestosQuery);
        const impuestos = impuestosResult.recordset;

        return {
          id: concepto.Id,
          nombre: concepto.Nombre,
          descripcion: concepto.Descripcion,
          claveProdServ: concepto.ClaveProdServ,
          unidadMedida: concepto.UnidadMedida,
          cantidad: parseFloat(concepto.Cantidad) || 0,
          precioUnitario: parseFloat(concepto.PrecioUnitario) || 0,
          subtotal: parseFloat(concepto.Subtotal) || 0,
          monedaProducto: concepto.MonedaProducto,
          objetoImpuesto: concepto.ObjetoImpuesto,
          totalImpuestos: parseFloat(concepto.TotalImpuestos) || 0,
          total: parseFloat(concepto.Total) || 0,
          impuestos: impuestos.map((imp: any) => ({
            tipo: imp.Tipo,
            tasa: parseFloat(imp.Tasa) || 0,
            monto: parseFloat(imp.Monto) || 0
          }))
        };
      })
    );

    const factura = {
      id: row.Id,
      clienteId: row.ClienteId,
      numero_factura: row.numero_factura,
      montoTotal: parseFloat(row.MontoTotal) || 0,
      saldoPendiente: parseFloat(row.SaldoPendiente) || 0,
      fechaEmision: row.FechaEmision,
      fechaVencimiento: row.FechaVencimiento,
      diasVencido: row.DiasVencido || 0,
      estado_factura_id: row.estado_factura_id,
      prioridad_cobranza_id: row.prioridad_cobranza_id,
      metodoPago: row.MetodoPago,
      formaPago: row.FormaPago,
      condicionesPago: row.CondicionesPago,
      uuid: row.UUID,
      timbrado: row.Timbrado,
      fechaTimbrado: row.FechaTimbrado,
      facturapiId: row.FacturapiId,
      pdfUrl: row.PDFUrl,
      xmlUrl: row.XMLUrl,
      usuarioCreadorId: row.UsuarioCreadorId,
      usuarioCreadorCorreo: row.UsuarioCreadorCorreo,
      usuarioCreadorNombre: row.UsuarioCreadorNombre,
      usuarioCreadorApellido: row.UsuarioCreadorApellido,
      ultimaGestion: row.UltimaGestion,
      createdAt: row.CreatedAt,
      cliente: {
        id: row.ClienteId,
        razonSocial: row.ClienteRazonSocial,
        rfc: row.ClienteRFC,
        nombreComercial: row.ClienteNombreComercial,
        correo: row.ClienteCorreo,
        telefono: row.ClienteTelefono,
        codigoPostal: row.ClienteCodigoPostal,
        regimenFiscal: row.ClienteRegimenFiscalCodigo ? `${row.ClienteRegimenFiscalCodigo} - ${row.ClienteRegimenFiscalDescripcion}` : null
      },
      estado: {
        id: row.estado_factura_id,
        codigo: row.EstadoCodigo
      },
      prioridad: {
        id: row.prioridad_cobranza_id,
        codigo: row.PrioridadCodigo
      },
      conceptos
    };

    // Obtener IDs de la factura anterior y siguiente (misma organización)
    const navQuery = `
      SELECT
        (SELECT TOP 1 f2.Id FROM Facturas f2 INNER JOIN Clientes c2 ON f2.ClienteId = c2.Id
          WHERE c2.OrganizacionId = @OrganizacionId AND f2.Id < @FacturaId ORDER BY f2.Id DESC) as PrevId,
        (SELECT TOP 1 f3.Id FROM Facturas f3 INNER JOIN Clientes c3 ON f3.ClienteId = c3.Id
          WHERE c3.OrganizacionId = @OrganizacionId AND f3.Id > @FacturaId ORDER BY f3.Id ASC) as NextId
    `;
    const navResult = await pool.request()
      .input('FacturaId', sql.Int, parseInt(id))
      .input('OrganizacionId', sql.Int, parseInt(organizacionId))
      .query(navQuery);
    const prevId: number | null = navResult.recordset[0]?.PrevId ?? null;
    const nextId: number | null = navResult.recordset[0]?.NextId ?? null;

    return json({
      success: true,
      factura,
      prevId,
      nextId
    });

  } catch (error) {
    return json({
      success: false,
      error: 'Error al obtener factura: ' + (error as Error).message
    }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async (event) => {
  const user = getUserFromRequest(event);
  if (!user) {
    return unauthorizedResponse('Token de autenticación requerido');
  }

  const { params, url } = event;
  const facturaId = Number(params.id);
  const organizacionId = Number(url.searchParams.get('organizacionId'));

  if (!Number.isInteger(facturaId) || facturaId <= 0) {
    return json({
      success: false,
      error: 'ID de factura inválido'
    }, { status: 400 });
  }

  if (!Number.isInteger(organizacionId) || organizacionId <= 0) {
    return json({
      success: false,
      error: 'organizacionId es requerido'
    }, { status: 400 });
  }

  let transaction: sql.Transaction | null = null;

  try {
    const pool = await getConnection();

    const facturaResult = await pool.request()
      .input('FacturaId', sql.Int, facturaId)
      .input('OrganizacionId', sql.Int, organizacionId)
      .query(`
        SELECT TOP 1
          f.Id,
          f.numero_factura,
          f.Timbrado,
          f.FacturapiId,
          f.UUID,
          f.estado_factura_id,
          co.facturapi_key as FacturapiKey
        FROM Facturas f
        INNER JOIN Clientes c ON f.ClienteId = c.Id
        LEFT JOIN configuracion_organizacion co ON c.OrganizacionId = co.organizacion_id
        WHERE f.Id = @FacturaId
          AND c.OrganizacionId = @OrganizacionId
      `);

    if (!facturaResult.recordset.length) {
      return json({
        success: false,
        error: 'Factura no encontrada o no tienes permiso para eliminarla'
      }, { status: 404 });
    }

    const factura = facturaResult.recordset[0];

    const pagosResult = await pool.request()
      .input('FacturaId', sql.Int, facturaId)
      .query(`
        SELECT
          COUNT(*) as TotalPagos,
          ISNULL(SUM(Monto), 0) as TotalMontoPagado
        FROM Pagos
        WHERE FacturaId = @FacturaId
      `);

    const totalPagos = Number(pagosResult.recordset[0]?.TotalPagos || 0);
    const totalMontoPagado = Number(pagosResult.recordset[0]?.TotalMontoPagado || 0);

    let accionFacturapi: 'no_aplica' | 'cancelada' | 'eliminada' | 'ya_cancelada' | 'no_encontrada' = 'no_aplica';
    let advertenciaFacturapi = '';
    let pagosFacturapiCancelados = 0;
    let pagosFacturapiYaCancelados = 0;
    let pagosFacturapiNoEncontrados = 0;

    if (factura.FacturapiId) {
      if (!factura.FacturapiKey) {
        return json({
          success: false,
          error: 'La organización no tiene configurada una API key de Facturapi'
        }, { status: 400 });
      }

      try {
        try {
          const facturaFacturapi = await axios.get(
            `https://www.facturapi.io/v2/invoices/${factura.FacturapiId}`,
            {
              headers: {
                Authorization: `Bearer ${factura.FacturapiKey}`
              }
            }
          );

          const receivedPaymentIds = Array.isArray(facturaFacturapi.data?.received_payment_ids)
            ? facturaFacturapi.data.received_payment_ids
            : [];

          for (const paymentInvoiceId of receivedPaymentIds) {
            const resultadoPago = await cancelarDocumentoFacturapi(paymentInvoiceId, factura.FacturapiKey, '02');

            if (resultadoPago === 'cancelada') pagosFacturapiCancelados += 1;
            if (resultadoPago === 'ya_cancelada') pagosFacturapiYaCancelados += 1;
            if (resultadoPago === 'no_encontrada') pagosFacturapiNoEncontrados += 1;
          }
        } catch (facturapiConsultaError: any) {
          const statusConsulta = facturapiConsultaError.response?.status;
          const messageConsulta = facturapiConsultaError.response?.data?.message || facturapiConsultaError.message;

          if (statusConsulta !== 404) {
            return json({
              success: false,
              error: `Error al consultar los pagos relacionados en Facturapi: ${messageConsulta}`
            }, { status: 400 });
          }
        }

        const resultadoFacturaFacturapi = await cancelarDocumentoFacturapi(factura.FacturapiId, factura.FacturapiKey, '02');

        if (resultadoFacturaFacturapi === 'cancelada') {
          accionFacturapi = factura.Timbrado ? 'cancelada' : 'eliminada';
        } else if (resultadoFacturaFacturapi === 'ya_cancelada') {
          accionFacturapi = 'ya_cancelada';
        } else {
          accionFacturapi = 'no_encontrada';
          advertenciaFacturapi = 'La factura no se encontró en Facturapi; se continuará con la eliminación local.';
        }
      } catch (facturapiError: any) {
        return json({
          success: false,
          error: `Error al sincronizar la eliminación en Facturapi: ${facturapiError.message || facturapiError}`
        }, { status: 400 });
      }
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const validacionFinal = await new sql.Request(transaction)
      .input('FacturaId', sql.Int, facturaId)
      .input('OrganizacionId', sql.Int, organizacionId)
      .query(`
        SELECT TOP 1 f.Id
        FROM Facturas f
        INNER JOIN Clientes c ON f.ClienteId = c.Id
        WHERE f.Id = @FacturaId
          AND c.OrganizacionId = @OrganizacionId
      `);

    if (!validacionFinal.recordset.length) {
      await transaction.rollback();
      return json({
        success: false,
        error: 'La factura ya no existe o ya fue eliminada'
      }, { status: 404 });
    }

    await new sql.Request(transaction)
      .input('FacturaId', sql.Int, facturaId)
      .query(`
        DELETE FROM Pagos WHERE FacturaId = @FacturaId;

        DELETE FROM ImpuestosConcepto
        WHERE ConceptoId IN (
          SELECT Id
          FROM ConceptosFactura
          WHERE FacturaId = @FacturaId
        );

        IF OBJECT_ID('Recordatorios', 'U') IS NOT NULL
          DELETE FROM Recordatorios WHERE FacturaId = @FacturaId;

        IF OBJECT_ID('RecordatoriosProgramados', 'U') IS NOT NULL
          DELETE FROM RecordatoriosProgramados WHERE FacturaId = @FacturaId;

        IF OBJECT_ID('GestionesCobranza', 'U') IS NOT NULL
          DELETE FROM GestionesCobranza WHERE FacturaId = @FacturaId;

        DELETE FROM ConceptosFactura WHERE FacturaId = @FacturaId;
        DELETE FROM Facturas WHERE Id = @FacturaId;
      `);

    await transaction.commit();

    return json({
      success: true,
      message: accionFacturapi === 'ya_cancelada'
        ? 'La factura ya estaba cancelada en Facturapi y fue eliminada del sistema correctamente'
        : factura.Timbrado
        ? 'Factura cancelada en Facturapi y eliminada del sistema correctamente'
        : 'Factura eliminada correctamente',
      facturaId,
      numeroFactura: factura.numero_factura,
      pagosEliminados: totalPagos,
      montoPagosEliminados: totalMontoPagado,
      pagosFacturapiCancelados,
      pagosFacturapiYaCancelados,
      pagosFacturapiNoEncontrados,
      accionFacturapi,
      advertenciaFacturapi
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch {
      }
    }

    return json({
      success: false,
      error: 'Error al eliminar factura: ' + (error as Error).message
    }, { status: 500 });
  }
};
