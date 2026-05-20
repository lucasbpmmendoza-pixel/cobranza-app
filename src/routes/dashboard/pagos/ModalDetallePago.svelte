<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { authFetch } from '$lib/api';
  import { Button } from '$lib/components/ui';
  import {
    X,
    CreditCard,
    Calendar,
    User,
    FileText,
    Building2,
    Download,
    AlertTriangle
  } from 'lucide-svelte';
  import { formatearMoneda, formatearFecha, getMetodoNombre } from './utils';
  import type { Pago } from './types';

  const dispatch = createEventDispatcher();

  export let abierto = false;
  export let pago: Pago | null = null;

  let detalle: any = null;
  let cargando = false;
  let error = '';

  $: if (abierto && pago) {
    cargarDetalle();
  }

  $: if (!abierto) {
    detalle = null;
    error = '';
  }

  async function cargarDetalle() {
    if (!pago) return;
    cargando = true;
    error = '';
    try {
      const organizacionId = sessionStorage.getItem('organizacionActualId');
      if (!organizacionId) {
        error = 'No se encontró la organización';
        return;
      }
      const response = await authFetch(`/api/pagos/${pago.id}?organizacionId=${organizacionId}`);
      const data = await response.json();
      if (data.success) {
        detalle = data.pago;
      } else {
        error = data.message || 'Error al cargar el detalle del pago';
      }
    } catch {
      error = 'Error al conectar con el servidor';
    } finally {
      cargando = false;
    }
  }

  function cerrar() {
    dispatch('cerrar');
  }

  function descargarComprobante() {
    if (!detalle) return;

    const d = detalle;

    const fmtDate = (val: any) => val
      ? new Intl.DateTimeFormat('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(val))
      : 'N/D';
    const fmtDateTime = (val: any) => val
      ? new Intl.DateTimeFormat('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(val))
      : 'N/D';

    const fechaPagoFmt = fmtDate(d.fechaPago);
    const fechaRegistroFmt = fmtDateTime(d.createdAt);
    const fechaEmisionFmt = fmtDate(d.factura?.fechaEmision);
    const fechaVencFmt = fmtDate(d.factura?.fechaVencimiento);
    const generadoEn = fmtDateTime(new Date());
    const registradoPor = d.usuario?.nombre
      ? `${d.usuario.nombre} ${d.usuario.apellido || ''}`.trim()
      : 'N/D';
    const saldoAnterior = (d.factura?.saldoPendiente || 0) + d.monto;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Comprobante de Pago ${d.id}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      color: #1a1a1a;
      background: #fff;
      padding: 24px 30px;
      line-height: 1.45;
      max-width: 820px;
      margin: 0 auto;
    }

    /* ── TOP: company + folio box ── */
    .top-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
    .company-block { font-size: 12px; font-weight: bold; white-space: pre-line; line-height: 1.3; }
    .folio-box { border: 1px solid #999; min-width: 110px; }
    .folio-box .fl { font-size: 9px; background: #f0f0f0; border-bottom: 1px solid #999; padding: 2px 8px; text-align: center; font-weight: bold; letter-spacing: 0.06em; text-transform: uppercase; color: #555; }
    .folio-box .fv { font-size: 22px; font-weight: bold; padding: 4px 12px; text-align: center; }

    /* ── TITLE ── */
    h1 { font-size: 20px; font-weight: normal; border-bottom: 1px solid #ccc; padding-bottom: 6px; margin: 12px 0 10px; }

    /* ── EMISOR / CFDI META ROW ── */
    .emisor-wrap { display: flex; border: 1px solid #aaa; margin-bottom: 10px; }
    .emisor-col { width: 55%; border-right: 1px solid #aaa; }
    .meta-col { width: 45%; }
    .col-hdr { font-size: 10px; font-weight: bold; background: #f0f0f0; border-bottom: 1px solid #aaa; padding: 3px 8px; text-transform: uppercase; letter-spacing: 0.04em; }
    .emisor-body { padding: 8px; }
    .emisor-name { font-size: 13px; font-weight: bold; margin-bottom: 4px; }
    .emisor-line { color: #333; margin-bottom: 2px; }
    .emisor-line span { font-weight: bold; }
    .meta-tbl { width: 100%; border-collapse: collapse; }
    .meta-tbl td { padding: 3px 8px; border-bottom: 1px solid #ebebeb; vertical-align: top; }
    .meta-tbl td:first-child { color: #555; white-space: nowrap; width: 130px; }
    .meta-tbl td:last-child { font-weight: 500; }

    /* ── RECEPTOR ── */
    .receptor-wrap { border: 1px solid #aaa; margin-bottom: 10px; }
    .rcpt-tbl { width: 100%; border-collapse: collapse; }
    .rcpt-tbl td { padding: 4px 10px; border-bottom: 1px solid #ebebeb; }
    .rcpt-tbl td:first-child { font-weight: bold; width: 140px; }
    .rcpt-tbl tr:last-child td { border-bottom: none; }

    /* ── DATA TABLES ── */
    .section-lbl { font-size: 11px; font-weight: bold; margin: 10px 0 4px; }
    table.dt { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
    table.dt thead tr { background: #1e2a45; color: #fff; }
    table.dt thead th { padding: 5px 8px; text-align: left; font-size: 10px; border: 1px solid #1e2a45; letter-spacing: 0.03em; }
    table.dt thead th.r { text-align: right; }
    table.dt tbody tr:nth-child(even) { background: #f7f7f7; }
    table.dt tbody td { padding: 5px 8px; border: 1px solid #d5d5d5; vertical-align: top; }
    table.dt tbody td.r { text-align: right; font-weight: 600; }
    table.dt .mid-row td { background: #e8e8e8; font-weight: bold; text-align: center; font-size: 10px; padding: 3px 8px; border-color: #ccc; }

    /* ── TOTALS ── */
    .totals-area { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .importe-letra { font-size: 10px; line-height: 1.6; }
    .importe-letra strong { font-weight: bold; }
    .totals-right table { border-collapse: collapse; }
    .totals-right td { padding: 3px 12px; border-bottom: 1px solid #e0e0e0; font-size: 11px; }
    .totals-right td:last-child { text-align: right; font-weight: 600; min-width: 100px; }
    .totals-right tr.grand td { background: #1e2a45; color: #fff; font-size: 13px; font-weight: bold; border-bottom: none; }

    /* ── FOOTER ── */
    .footer-note { text-align: center; color: #507fc0; font-size: 10px; margin-top: 14px; padding-top: 8px; border-top: 1px solid #ccc; font-style: italic; }
    .footer-gen { text-align: center; color: #999; font-size: 9px; margin-top: 4px; }
    .nd { color: #bbb; font-style: italic; }
  </style>
</head>
<body>

  <!-- TOP HEADER -->
  <div class="top-header">
    <div class="company-block">Sistema de Cobranza</div>
    <div class="folio-box">
      <div class="fl">Folio</div>
      <div class="fv">${d.id}</div>
    </div>
  </div>

  <h1>Comprobante de Pago</h1>

  <!-- EMISOR + CFDI META -->
  <div class="emisor-wrap">
    <div class="emisor-col">
      <div class="col-hdr">Emisor</div>
      <div class="emisor-body">
        <div class="emisor-name">Sistema de Cobranza</div>
        <div class="emisor-line"><span>Registrado por</span> ${registradoPor}</div>
        <div class="emisor-line"><span>Correo</span> ${d.usuario?.correo || 'N/D'}</div>
      </div>
    </div>
    <div class="meta-col">
      <div class="col-hdr">Datos del Comprobante</div>
      <table class="meta-tbl">
        <tr><td>Folio de Pago</td><td>${d.id}</td></tr>
        <tr><td>Tipo</td><td>Pago</td></tr>
        <tr><td>Fecha de registro</td><td>${fechaRegistroFmt}</td></tr>
        <tr><td>Fecha de pago</td><td>${fechaPagoFmt}</td></tr>
        <tr><td>Forma de pago</td><td>${getMetodoNombre(d.metodo)}</td></tr>
        <tr><td>Moneda</td><td>MXN</td></tr>
        <tr><td>Tipo de Cambio</td><td>1</td></tr>
      </table>
    </div>
  </div>

  <!-- RECEPTOR -->
  <div class="receptor-wrap">
    <div class="col-hdr">Receptor</div>
    <table class="rcpt-tbl">
      <tr><td>Razón Social</td><td>${d.factura?.cliente?.razonSocial || 'N/D'}</td></tr>
      <tr><td>RFC</td><td>${d.factura?.cliente?.rfc || 'N/D'}</td></tr>
      <tr><td>Correo</td><td>${d.factura?.cliente?.correo || 'N/D'}</td></tr>
      <tr><td>Teléfono</td><td>${d.factura?.cliente?.telefono || 'N/D'}</td></tr>
    </table>
  </div>

  <!-- RECEPCIÓN DE PAGOS -->
  <div class="section-lbl">Recepción de Pagos</div>
  <table class="dt">
    <thead>
      <tr>
        <th>Fecha de Pago</th>
        <th>Forma de Pago</th>
        <th>Moneda</th>
        <th>Tipo de Cambio</th>
        <th class="r">Monto</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${fechaPagoFmt}</td>
        <td>${getMetodoNombre(d.metodo)}</td>
        <td>MXN</td>
        <td>1</td>
        <td class="r">${formatearMoneda(d.monto)}</td>
      </tr>
      <tr class="mid-row"><td colspan="5">Documentos Relacionados</td></tr>
      <tr>
        <th style="background:#f0f0f0;font-size:10px;padding:4px 8px;border:1px solid #d5d5d5;">No. Factura</th>
        <th style="background:#f0f0f0;font-size:10px;padding:4px 8px;border:1px solid #d5d5d5;">Fecha Emisión</th>
        <th style="background:#f0f0f0;font-size:10px;padding:4px 8px;border:1px solid #d5d5d5;text-align:right;">Saldo Anterior</th>
        <th style="background:#f0f0f0;font-size:10px;padding:4px 8px;border:1px solid #d5d5d5;text-align:right;">Importe Pagado</th>
        <th style="background:#f0f0f0;font-size:10px;padding:4px 8px;border:1px solid #d5d5d5;text-align:right;">Saldo Insoluto</th>
      </tr>
      <tr>
        <td>${d.factura?.numero_factura || 'N/D'}</td>
        <td>${fechaEmisionFmt}</td>
        <td class="r">${formatearMoneda(saldoAnterior)}</td>
        <td class="r">${formatearMoneda(d.monto)}</td>
        <td class="r">${formatearMoneda(d.factura?.saldoPendiente || 0)}</td>
      </tr>
    </tbody>
  </table>

  <!-- TOTALS -->
  <div class="totals-area">
    <div class="importe-letra">
      <strong>Moneda</strong> MXN<br>
      <strong>Factura relacionada</strong> ${d.factura?.numero_factura || 'N/D'}<br>
      <strong>Vencimiento factura</strong> ${fechaVencFmt}<br>
      <strong>Monto total factura</strong> ${formatearMoneda(d.factura?.montoTotal)}
    </div>
    <div class="totals-right">
      <table>
        <tr><td>Subtotal</td><td>${formatearMoneda(d.monto)}</td></tr>
        <tr class="grand"><td>TOTAL PAGADO</td><td>${formatearMoneda(d.monto)}</td></tr>
      </table>
    </div>
  </div>

  <div class="footer-note">Este documento es un comprobante de pago interno. No es un CFDI timbrado.</div>
  <div class="footer-gen">Generado el ${generadoEn} &bull; Sistema de Cobranza &bull; Folio #${d.id}</div>

</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comprobante-pago-${d.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

{#if abierto}
  <!-- Overlay -->
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
    on:click|self={cerrar}
  >
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-blue-100 rounded-lg">
            <CreditCard class="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900">
              Detalle de Pago {pago ? `#${pago.id}` : ''}
            </h2>
            <p class="text-sm text-gray-500">Comprobante de pago registrado</p>
          </div>
        </div>
        <button
          on:click={cerrar}
          class="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X class="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-6 py-5">
        {#if cargando}
          <div class="flex flex-col items-center justify-center py-16">
            <div class="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p class="mt-3 text-gray-500 text-sm">Cargando detalle...</p>
          </div>
        {:else if error}
          <div class="flex flex-col items-center justify-center py-16">
            <AlertTriangle class="w-10 h-10 text-red-400 mb-3" />
            <p class="text-red-600 font-medium">{error}</p>
            <button on:click={cargarDetalle} class="mt-4 text-sm text-blue-600 hover:underline">
              Reintentar
            </button>
          </div>
        {:else if detalle}
          <!-- Monto destacado -->
          <div class="bg-green-50 border border-green-200 rounded-xl p-5 text-center mb-6">
            <p class="text-xs font-semibold text-green-600 uppercase tracking-wide">Monto Pagado</p>
            <p class="text-4xl font-bold text-green-700 mt-1">{formatearMoneda(detalle.monto)}</p>
          </div>

          <!-- Información del cliente -->
          <div class="mb-5">
            <div class="flex items-center gap-2 mb-3">
              <Building2 class="w-4 h-4 text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">Cliente</h3>
            </div>
            <div class="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4">
              <div>
                <p class="text-xs text-gray-500">Razon Social</p>
                <p class="text-sm font-medium text-gray-900">{detalle.factura?.cliente?.razonSocial || 'N/A'}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">RFC</p>
                <p class="text-sm font-medium text-gray-900">{detalle.factura?.cliente?.rfc || 'N/A'}</p>
              </div>
              {#if detalle.factura?.cliente?.correo}
                <div>
                  <p class="text-xs text-gray-500">Correo</p>
                  <p class="text-sm font-medium text-gray-900">{detalle.factura.cliente.correo}</p>
                </div>
              {/if}
              {#if detalle.factura?.cliente?.telefono}
                <div>
                  <p class="text-xs text-gray-500">Telefono</p>
                  <p class="text-sm font-medium text-gray-900">{detalle.factura.cliente.telefono}</p>
                </div>
              {/if}
            </div>
          </div>

          <!-- Información de la factura -->
          <div class="mb-5">
            <div class="flex items-center gap-2 mb-3">
              <FileText class="w-4 h-4 text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">Factura</h3>
            </div>
            <div class="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4">
              <div>
                <p class="text-xs text-gray-500">Numero de Factura</p>
                <p class="text-sm font-medium text-blue-600">{detalle.factura?.numero_factura || 'N/A'}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Monto Total</p>
                <p class="text-sm font-medium text-gray-900">{formatearMoneda(detalle.factura?.montoTotal)}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Fecha de Emision</p>
                <p class="text-sm font-medium text-gray-900">{formatearFecha(detalle.factura?.fechaEmision)}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Vencimiento</p>
                <p class="text-sm font-medium text-gray-900">{formatearFecha(detalle.factura?.fechaVencimiento)}</p>
              </div>
            </div>
          </div>

          <!-- Detalle del pago -->
          <div class="mb-5">
            <div class="flex items-center gap-2 mb-3">
              <CreditCard class="w-4 h-4 text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">Detalle del Pago</h3>
            </div>
            <div class="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4">
              <div>
                <p class="text-xs text-gray-500">Fecha de Pago</p>
                <p class="text-sm font-medium text-gray-900">{formatearFecha(detalle.fechaPago)}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Metodo de Pago</p>
                <p class="text-sm font-medium text-gray-900">{getMetodoNombre(detalle.metodo)}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Registrado por</p>
                <p class="text-sm font-medium text-gray-900">
                  {detalle.usuario?.nombre
                    ? `${detalle.usuario.nombre} ${detalle.usuario.apellido || ''}`.trim()
                    : 'N/A'}
                </p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Fecha de Registro</p>
                <p class="text-sm font-medium text-gray-900">{formatearFecha(detalle.createdAt)}</p>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      {#if detalle && !cargando && !error}
        <div class="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50 rounded-b-xl">
          <button
            on:click={cerrar}
            class="text-sm text-gray-500 hover:text-gray-700"
          >
            Cerrar
          </button>
          <Button variant="primary" size="md" on:click={descargarComprobante}>
            <Download class="w-4 h-4" />
            Descargar
          </Button>
        </div>
      {/if}
    </div>
  </div>
{/if}
