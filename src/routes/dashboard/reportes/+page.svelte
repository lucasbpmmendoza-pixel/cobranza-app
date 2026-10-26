<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { Download, Search, TrendingUp, DollarSign, AlertTriangle, Users, XCircle, Send } from 'lucide-svelte';
  import { crearLibro, descargarLibro } from '$lib/reportes/excel';
  import Chart from 'chart.js/auto';
  import { authFetch } from '$lib/api';
  import { Button, Modal } from '$lib/components/ui';
  import { organizacionStore } from '$lib/stores/organizacion';
  import { CATEGORIAS, type CategoriaId } from '$lib/reportes/categorias';

  type Linea = {
    facturaId: number;
    folio: string;
    clienteId: number;
    cliente: string;
    rfc: string;
    mes: string;
    fecha: string;
    categoria: CategoriaId;
    conceptos: string;
    facturado: number;
    pagado: number;
    ultimoPago: string | null;
    uuid?: string;
  };

  type ClienteDemo = { clienteId: number; nombre: string; celular: string; real: boolean };
  type ResultadoCobro = { clienteId: number; cliente: string; celular: string; estado: 'enviado' | 'simulado' | 'error'; detalle?: string };

  type Celda = { facturado: number; pagado: number; lineas: Linea[] };
  type Fila = {
    clienteId: number;
    cliente: string;
    rfc: string;
    celdas: Record<string, Celda>;
    facturado: number;
    pagado: number;
    debe: number;
  };

  const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

  // Filtros
  let anio = hoy.getFullYear();
  let periodo = 'anio'; // anio | s1 | s2 | q1..q4 | rango
  let rangoDesde = `${anio}-01`;
  let rangoHasta = mesActual;
  let categoria: CategoriaId | 'todas' = 'todas';
  let busqueda = '';
  let soloConAdeudo = false;

  const anios = Array.from({ length: 5 }, (_, i) => hoy.getFullYear() - i);

  // Datos
  let lineas: Linea[] = [];
  let cargando = false;
  let error: string | null = null;
  let organizacionId = '';

  // Detalle de celda
  let detalleAbierto = false;
  let detalleTitulo = '';
  let detalleLineas: Linea[] = [];

  // Cuenta demo de expo: clientes demo (para saber a quién le llega el mensaje)
  let modoDemo = false;
  let demoClientes: ClienteDemo[] = [];

  // Cobranza por bot (demo)
  let cobranzaAbierta = false;
  let enviandoCobranza = false;
  let errorCobranza: string | null = null;
  let resultadosCobranza: ResultadoCobro[] = [];

  // Gráfica
  let canvasGrafica: HTMLCanvasElement;
  let grafica: Chart | null = null;

  function calcularRango(): { desde: string; hasta: string } {
    const m = (n: number) => `${anio}-${String(n).padStart(2, '0')}`;
    switch (periodo) {
      case 's1': return { desde: m(1), hasta: m(6) };
      case 's2': return { desde: m(7), hasta: m(12) };
      case 'q1': return { desde: m(1), hasta: m(3) };
      case 'q2': return { desde: m(4), hasta: m(6) };
      case 'q3': return { desde: m(7), hasta: m(9) };
      case 'q4': return { desde: m(10), hasta: m(12) };
      case 'rango': return { desde: rangoDesde, hasta: rangoHasta };
      default: return { desde: m(1), hasta: m(12) };
    }
  }

  function mesesEntre(desde: string, hasta: string): string[] {
    const meses: string[] = [];
    let [a, m] = desde.split('-').map(Number);
    const [ha, hm] = hasta.split('-').map(Number);
    while (a < ha || (a === ha && m <= hm)) {
      meses.push(`${a}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; a++; }
    }
    return meses;
  }

  function etiquetaMes(mes: string, conAnio = false): string {
    const [a, m] = mes.split('-').map(Number);
    return conAnio ? `${NOMBRES_MES[m - 1]} ${String(a).slice(2)}` : NOMBRES_MES[m - 1];
  }

  async function cargar() {
    organizacionId = sessionStorage.getItem('organizacionActualId') || '';
    if (!organizacionId) {
      error = 'No se ha seleccionado una organización';
      return;
    }
    const { desde, hasta } = calcularRango();
    if (!desde || !hasta || desde > hasta) {
      error = 'El rango de meses no es válido';
      return;
    }

    cargando = true;
    error = null;
    try {
      const params = new URLSearchParams({ organizacionId, desde, hasta });
      const response = await authFetch(`/api/reportes/sabana?${params}`);
      const data = await response.json();
      if (data.success) {
        lineas = data.lineas || [];
        // Cuenta demo de expo: además se cargan sus clientes demo
        modoDemo = !!data.demo;
        if (modoDemo) await cargarDemo();
      } else {
        error = data.message || data.error || 'Error al generar el reporte';
        lineas = [];
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Error desconocido';
      lineas = [];
    } finally {
      cargando = false;
    }
  }

  async function cargarDemo() {
    const response = await authFetch(`/api/reportes/demo?organizacionId=${organizacionId}`);
    const data = await response.json();
    if (data.success) {
      demoClientes = data.clientes || [];
    }
  }

  // Un clic manda el mensaje a todos los clientes; el modal solo muestra cómo fue cada envío
  async function enviarCobranza() {
    resultadosCobranza = [];
    cobranzaAbierta = true;
    enviandoCobranza = true;
    errorCobranza = null;
    try {
      const response = await authFetch(`/api/reportes/demo/cobranza?organizacionId=${organizacionId}`, { method: 'POST' });
      const data = await response.json();
      if (data.success) resultadosCobranza = data.resultados || [];
      else errorCobranza = data.message || 'No se pudo enviar la cobranza';
    } catch (err) {
      errorCobranza = err instanceof Error ? err.message : 'Error desconocido';
    } finally {
      enviandoCobranza = false;
    }
  }

  function clienteDemo(id: number): ClienteDemo | undefined {
    return demoClientes.find((c) => c.clienteId === id);
  }

  // --- Cálculos derivados ---
  $: rango = calcularRango();
  $: meses = mesesEntre(rango.desde, rango.hasta);
  $: mostrarAnioEnMes = rango.desde.slice(0, 4) !== rango.hasta.slice(0, 4);

  // Totales por categoría (para las pestañas)
  $: totalesCategoria = CATEGORIAS.map((c) => {
    const ls = lineas.filter((l) => l.categoria === c.id);
    return {
      ...c,
      facturado: ls.reduce((s, l) => s + l.facturado, 0),
      pagado: ls.reduce((s, l) => s + l.pagado, 0)
    };
  });

  $: lineasCategoria = categoria === 'todas' ? lineas : lineas.filter((l) => l.categoria === categoria);

  $: filas = construirFilas(lineasCategoria, busqueda, soloConAdeudo);

  function construirFilas(ls: Linea[], texto: string, soloAdeudo: boolean): Fila[] {
    const mapa = new Map<number, Fila>();
    for (const l of ls) {
      let fila = mapa.get(l.clienteId);
      if (!fila) {
        fila = { clienteId: l.clienteId, cliente: l.cliente, rfc: l.rfc, celdas: {}, facturado: 0, pagado: 0, debe: 0 };
        mapa.set(l.clienteId, fila);
      }
      const celda = fila.celdas[l.mes] || (fila.celdas[l.mes] = { facturado: 0, pagado: 0, lineas: [] });
      celda.facturado += l.facturado;
      celda.pagado += l.pagado;
      celda.lineas.push(l);
      fila.facturado += l.facturado;
      fila.pagado += l.pagado;
    }
    const q = texto.trim().toLowerCase();
    return [...mapa.values()]
      .map((f) => ({ ...f, debe: Math.max(0, f.facturado - f.pagado) }))
      .filter((f) => !q || f.cliente?.toLowerCase().includes(q) || f.rfc?.toLowerCase().includes(q))
      .filter((f) => !soloAdeudo || f.debe > 0.5)
      .sort((a, b) => (a.cliente || '').localeCompare(b.cliente || ''));
  }

  // Totales del periodo (respetan categoría y búsqueda)
  $: resumen = {
    facturado: filas.reduce((s, f) => s + f.facturado, 0),
    pagado: filas.reduce((s, f) => s + f.pagado, 0),
    clientes: filas.length,
    alCorriente: filas.filter((f) => f.debe <= 0.5).length
  };
  $: resumenDebe = Math.max(0, resumen.facturado - resumen.pagado);
  $: deudores = filas.filter((f) => f.debe > 0.5);
  $: resumenPct = resumen.facturado > 0 ? (resumen.pagado / resumen.facturado) * 100 : 0;

  $: totalesMes = meses.map((mes) => {
    let facturado = 0;
    let pagado = 0;
    for (const f of filas) {
      const c = f.celdas[mes];
      if (c) { facturado += c.facturado; pagado += c.pagado; }
    }
    return { mes, facturado, pagado };
  });

  $: if (canvasGrafica) actualizarGrafica(totalesMes);

  function actualizarGrafica(datos: typeof totalesMes) {
    const labels = datos.map((d) => etiquetaMes(d.mes, mostrarAnioEnMes));
    const facturado = datos.map((d) => Math.round(d.facturado));
    const pagado = datos.map((d) => Math.round(d.pagado));
    if (grafica) {
      grafica.data.labels = labels;
      grafica.data.datasets[0].data = facturado;
      grafica.data.datasets[1].data = pagado;
      grafica.update();
      return;
    }
    grafica = new Chart(canvasGrafica, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Facturado', data: facturado, backgroundColor: '#93c5fd', borderRadius: 4 },
          { label: 'Cobrado', data: pagado, backgroundColor: '#16a34a', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatearMoneda(Number(ctx.raw))}` } }
        },
        scales: { y: { ticks: { callback: (v) => formatearCorto(Number(v)) } } }
      }
    });
  }

  // --- Helpers ---
  function estadoCelda(c: Celda | undefined): 'pagado' | 'parcial' | 'pendiente' | 'vacio' {
    if (!c || c.facturado <= 0) return 'vacio';
    if (c.pagado >= c.facturado - 0.5) return 'pagado';
    if (c.pagado > 0.5) return 'parcial';
    return 'pendiente';
  }

  const clasesEstado = {
    pagado: 'bg-green-100 text-green-800 hover:bg-green-200',
    parcial: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200',
    pendiente: 'bg-red-100 text-red-800 hover:bg-red-200',
    vacio: 'text-gray-300'
  };
  const iconoEstado = { pagado: '✓', parcial: '◐', pendiente: '✕', vacio: '—' };

  function formatearMoneda(n: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);
  }

  function formatearCorto(n: number): string {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
    return `$${Math.round(n)}`;
  }

  function formatearFecha(f: string | null): string {
    if (!f) return '—';
    const d = new Date(f);
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }

  function nombreCategoria(id: string): string {
    return CATEGORIAS.find((c) => c.id === id)?.nombre || id;
  }

  function tooltipCelda(c: Celda | undefined): string {
    if (!c || c.facturado <= 0) return 'Sin facturas';
    return `Facturado ${formatearMoneda(c.facturado)} · Pagado ${formatearMoneda(c.pagado)}\n` +
      c.lineas.map((l) => `${l.folio || 'Sin folio'}: ${l.conceptos || nombreCategoria(l.categoria)}`).join('\n');
  }

  function abrirDetalle(fila: Fila, mes: string) {
    const c = fila.celdas[mes];
    if (!c) return;
    detalleTitulo = `${fila.cliente} · ${etiquetaMes(mes, true)}`;
    detalleLineas = c.lineas;
    detalleAbierto = true;
  }

  function limpiarFiltros() {
    busqueda = '';
    soloConAdeudo = false;
    categoria = 'todas';
  }

  // --- Exportar a Excel ---
  // Con los mismos colores de la página (✓ ◐ ✕); ver $lib/reportes/excel.ts
  function exportarExcel() {
    const etiquetas = meses.map((m) => etiquetaMes(m, mostrarAnioEnMes));
    const resumenCategorias = CATEGORIAS
      .map((c) => ({ c, ls: lineas.filter((l) => l.categoria === c.id) }))
      .filter(({ ls }) => ls.length > 0)
      .map(({ c, ls }) => ({
        categoria: c.nombre,
        porMes: meses.map((m) => {
          const lm = ls.filter((l) => l.mes === m);
          return { facturado: lm.reduce((s, l) => s + l.facturado, 0), pagado: lm.reduce((s, l) => s + l.pagado, 0) };
        })
      }));

    // Una sábana por categoría con datos (más "Todas")
    const hojas: { id: CategoriaId | 'todas'; nombre: string }[] = [{ id: 'todas', nombre: 'Todas' }, ...CATEGORIAS];
    const sabanas = hojas
      .map((h) => ({ nombre: h.nombre, ls: h.id === 'todas' ? lineas : lineas.filter((l) => l.categoria === h.id) }))
      .filter(({ ls }) => ls.length > 0)
      .map(({ nombre, ls }) => ({ nombre, filas: construirFilas(ls, '', false) }));

    const titulo = `Reporte de cobranza${modoDemo ? ' DEMO' : ''}`;
    const wb = crearLibro(
      {
        titulo,
        periodo: `${etiquetaMes(rango.desde, true)} – ${etiquetaMes(rango.hasta, true)}`,
        meses,
        etiquetas,
        resumen: resumenCategorias,
        sabanas,
        detalle: lineas
      },
      nombreCategoria,
      formatearFecha
    );
    descargarLibro(wb, `${titulo} ${rango.desde} a ${rango.hasta}.xlsx`);
  }

  // Recargar al cambiar de organización
  let orgPrevia: number | null = null;
  const desuscribir = organizacionStore.subscribe((org) => {
    if (orgPrevia !== null && org.id !== null && org.id !== orgPrevia) {
      tick().then(cargar);
    }
    orgPrevia = org.id;
  });

  onMount(() => {
    cargar();
  });

  onDestroy(() => {
    desuscribir();
    grafica?.destroy();
  });
</script>

<div class="space-y-6">
  <!-- Encabezado y periodo -->
  <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
    <div>
      <h1 class="text-xl font-semibold text-gray-900">
        Reporte de cobranza
        {#if modoDemo}<span class="ml-2 align-middle text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">DEMO</span>{/if}
      </h1>
      <p class="text-sm text-gray-600 mt-1">Qué meses ha pagado cada cliente en el periodo, separado por tipo de cobro.</p>
    </div>
    <div class="flex flex-wrap items-end gap-3">
      <label class="flex flex-col text-xs text-gray-600 gap-1">
        Periodo
        <select bind:value={periodo} on:change={cargar} class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
          <option value="anio">Año completo</option>
          <option value="s1">1er semestre</option>
          <option value="s2">2do semestre</option>
          <option value="q1">1er trimestre</option>
          <option value="q2">2do trimestre</option>
          <option value="q3">3er trimestre</option>
          <option value="q4">4to trimestre</option>
          <option value="rango">Rango personalizado</option>
        </select>
      </label>
      {#if periodo === 'rango'}
        <label class="flex flex-col text-xs text-gray-600 gap-1">
          Desde
          <input type="month" bind:value={rangoDesde} on:change={cargar} class="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </label>
        <label class="flex flex-col text-xs text-gray-600 gap-1">
          Hasta
          <input type="month" bind:value={rangoHasta} on:change={cargar} class="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </label>
      {:else}
        <label class="flex flex-col text-xs text-gray-600 gap-1">
          Año
          <select bind:value={anio} on:change={cargar} class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
            {#each anios as a}
              <option value={a}>{a}</option>
            {/each}
          </select>
        </label>
      {/if}
      <Button variant="success" size="md" on:click={exportarExcel} disabled={cargando || lineas.length === 0}>
        <Download class="w-4 h-4" />
        Exportar Excel
      </Button>
    </div>
  </div>

  <!-- Pestañas de categoría -->
  <div class="flex gap-2 overflow-x-auto pb-1">
    <button
      class="px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors {categoria === 'todas' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}"
      on:click={() => (categoria = 'todas')}
    >
      Todas
    </button>
    {#each totalesCategoria as c}
      {#if c.facturado > 0}
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors {categoria === c.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}"
          on:click={() => (categoria = c.id)}
          title="Facturado {formatearMoneda(c.facturado)} · Cobrado {formatearMoneda(c.pagado)}"
        >
          {c.nombre}
          <span class="ml-1 text-xs opacity-75">{formatearCorto(c.facturado)}</span>
        </button>
      {/if}
    {/each}
  </div>

  {#if error}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
  {/if}

  <!-- Resumen -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <div class="bg-white rounded-xl shadow-sm border border-blue-200 p-5">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-gray-600 font-medium">Facturado</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{formatearMoneda(resumen.facturado)}</p>
        </div>
        <DollarSign class="w-10 h-10 text-blue-500 opacity-20" />
      </div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border border-green-200 p-5">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-gray-600 font-medium">Cobrado</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{formatearMoneda(resumen.pagado)}</p>
          <p class="text-xs text-gray-500 mt-1">{resumenPct.toFixed(1)}% de lo facturado</p>
        </div>
        <TrendingUp class="w-10 h-10 text-green-500 opacity-20" />
      </div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border border-red-200 p-5">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-gray-600 font-medium">Pendiente</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{formatearMoneda(resumenDebe)}</p>
        </div>
        <AlertTriangle class="w-10 h-10 text-red-500 opacity-20" />
      </div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border border-purple-200 p-5">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-gray-600 font-medium">Clientes al corriente</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{resumen.alCorriente} de {resumen.clientes}</p>
          <p class="text-xs text-gray-500 mt-1">{resumen.clientes - resumen.alCorriente} con adeudo en el periodo</p>
        </div>
        <Users class="w-10 h-10 text-purple-500 opacity-20" />
      </div>
    </div>
  </div>

  <!-- Sábana -->
  <div class="bg-white rounded-xl shadow-sm border">
    <div class="p-4 border-b border-gray-200 flex flex-col sm:flex-row gap-3 sm:items-center">
      <div class="relative flex-1">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar cliente o RFC"
          bind:value={busqueda}
          class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 w-full text-sm"
        />
      </div>
      <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" bind:checked={soloConAdeudo} class="w-4 h-4 text-blue-600 border-gray-300 rounded" />
        Solo los que deben
      </label>
      {#if busqueda || soloConAdeudo || categoria !== 'todas'}
        <Button variant="outline" size="sm" on:click={limpiarFiltros}>
          <XCircle class="w-4 h-4" />
          Limpiar
        </Button>
      {/if}
      <div class="flex items-center gap-3 text-xs text-gray-600">
        <span class="inline-flex items-center gap-1"><span class="w-4 h-4 rounded bg-green-100 text-green-800 text-center leading-4">✓</span> Pagado</span>
        <span class="inline-flex items-center gap-1"><span class="w-4 h-4 rounded bg-yellow-100 text-yellow-800 text-center leading-4">◐</span> Parcial</span>
        <span class="inline-flex items-center gap-1"><span class="w-4 h-4 rounded bg-red-100 text-red-800 text-center leading-4">✕</span> Sin pagar</span>
      </div>
    </div>

    {#if cargando}
      <div class="p-12 text-center text-gray-500">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p class="mt-3 text-sm">Generando reporte...</p>
      </div>
    {:else if filas.length === 0}
      <div class="p-12 text-center text-gray-500 text-sm">No hay facturas en este periodo con los filtros seleccionados.</div>
    {:else}
      <div class="overflow-auto max-h-[70vh]">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th class="text-left px-4 py-3 font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[240px]">Cliente</th>
              {#each meses as mes}
                <th class="px-2 py-3 font-semibold text-gray-700 text-center min-w-[56px]">{etiquetaMes(mes, mostrarAnioEnMes)}</th>
              {/each}
              <th class="px-4 py-3 font-semibold text-gray-700 text-right">Facturado</th>
              <th class="px-4 py-3 font-semibold text-gray-700 text-right">Pagado</th>
              <th class="px-4 py-3 font-semibold text-gray-700 text-right">Debe</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            {#each filas as fila (fila.clienteId)}
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-2 sticky left-0 bg-white">
                  <div class="font-medium text-gray-900 truncate max-w-[280px]" title={fila.cliente}>{fila.cliente}</div>
                  <div class="text-xs text-gray-500">{fila.rfc}</div>
                </td>
                {#each meses as mes}
                  {@const celda = fila.celdas[mes]}
                  {@const estado = estadoCelda(celda)}
                  <td class="px-1 py-1 text-center">
                    {#if estado === 'vacio'}
                      <span class="text-gray-300">—</span>
                    {:else}
                      <button
                        class="w-full rounded-md py-1.5 font-semibold transition-colors {clasesEstado[estado]}"
                        title={tooltipCelda(celda)}
                        on:click={() => abrirDetalle(fila, mes)}
                      >
                        {iconoEstado[estado]}
                      </button>
                    {/if}
                  </td>
                {/each}
                <td class="px-4 py-2 text-right text-gray-700 whitespace-nowrap">{formatearMoneda(fila.facturado)}</td>
                <td class="px-4 py-2 text-right text-green-700 whitespace-nowrap">{formatearMoneda(fila.pagado)}</td>
                <td class="px-4 py-2 text-right whitespace-nowrap font-semibold {fila.debe > 0.5 ? 'text-red-600' : 'text-gray-400'}">{formatearMoneda(fila.debe)}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot class="bg-gray-50 sticky bottom-0 font-semibold">
            <tr>
              <td class="px-4 py-3 sticky left-0 bg-gray-50 text-gray-700">% cobrado del mes</td>
              {#each totalesMes as t}
                <td class="px-1 py-3 text-center text-xs {t.facturado === 0 ? 'text-gray-300' : t.pagado / t.facturado >= 0.9 ? 'text-green-700' : t.pagado / t.facturado >= 0.7 ? 'text-yellow-700' : 'text-red-600'}">
                  {t.facturado > 0 ? `${Math.round((t.pagado / t.facturado) * 100)}%` : '—'}
                </td>
              {/each}
              <td class="px-4 py-3 text-right whitespace-nowrap">{formatearMoneda(resumen.facturado)}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap text-green-700">{formatearMoneda(resumen.pagado)}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap text-red-600">{formatearMoneda(resumenDebe)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="px-4 py-2 border-t text-xs text-gray-500">{filas.length} clientes · Clic en una celda para ver las facturas del mes</div>
    {/if}
  </div>

  <!-- Gráfica facturado vs cobrado -->
  <div class="bg-white rounded-xl shadow-sm border p-4">
    <h2 class="text-sm font-semibold text-gray-700 mb-3">Facturado vs cobrado por mes{categoria !== 'todas' ? ` · ${nombreCategoria(categoria)}` : ''}</h2>
    <div class="h-72">
      <canvas bind:this={canvasGrafica}></canvas>
    </div>
  </div>

  {#if modoDemo}
    <div class="bg-white rounded-xl shadow-sm border p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h2 class="text-base font-semibold text-gray-900">Cobranza automática</h2>
        <p class="text-sm text-gray-600">{deudores.length} clientes deben {formatearMoneda(resumenDebe)} en el periodo. El bot les escribe por WhatsApp a todos: a los que deben con el UUID de cada factura y a los que están al corriente para agradecerles.</p>
      </div>
      <Button variant="danger" size="lg" on:click={enviarCobranza} loading={enviandoCobranza} disabled={cargando || enviandoCobranza}>
        <Send class="w-5 h-5" />
        Cobranza
      </Button>
    </div>
  {/if}
</div>

<Modal open={detalleAbierto} title={detalleTitulo} size="lg" on:close={() => (detalleAbierto = false)}>
  <table class="min-w-full text-sm">
    <thead class="bg-gray-50">
      <tr>
        <th class="text-left px-3 py-2 font-semibold text-gray-700">Folio</th>
        <th class="text-left px-3 py-2 font-semibold text-gray-700">Fecha</th>
        <th class="text-left px-3 py-2 font-semibold text-gray-700">Categoría / conceptos</th>
        <th class="text-right px-3 py-2 font-semibold text-gray-700">Facturado</th>
        <th class="text-right px-3 py-2 font-semibold text-gray-700">Pagado</th>
        <th class="text-left px-3 py-2 font-semibold text-gray-700">Último pago</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-100">
      {#each detalleLineas as l}
        <tr>
          <td class="px-3 py-2">
            {#if l.uuid}
              <div class="font-medium text-gray-800">{l.folio}</div>
              <div class="text-[11px] text-gray-500 font-mono">{l.uuid}</div>
            {:else}
              <a href="/dashboard/por-cobrar/{l.facturaId}" class="text-blue-600 hover:underline">{l.folio || `#${l.facturaId}`}</a>
            {/if}
          </td>
          <td class="px-3 py-2 whitespace-nowrap">{formatearFecha(l.fecha)}</td>
          <td class="px-3 py-2">
            <div class="font-medium text-gray-800">{nombreCategoria(l.categoria)}</div>
            <div class="text-xs text-gray-500">{l.conceptos}</div>
          </td>
          <td class="px-3 py-2 text-right whitespace-nowrap">{formatearMoneda(l.facturado)}</td>
          <td class="px-3 py-2 text-right whitespace-nowrap text-green-700">{formatearMoneda(l.pagado)}</td>
          <td class="px-3 py-2 whitespace-nowrap">{formatearFecha(l.ultimoPago)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</Modal>

<Modal open={cobranzaAbierta} title="Cobranza por WhatsApp" size="lg" on:close={() => (cobranzaAbierta = false)}>
  <div class="space-y-4">
    <p class="text-sm text-gray-600">
      {enviandoCobranza ? 'Enviando mensajes a todos los clientes…' : 'Así quedó el envío. A los celulares ficticios solo se les simula.'}
    </p>
    <div class="border rounded-lg divide-y max-h-[50vh] overflow-auto">
      {#each demoClientes as c (c.clienteId)}
        {@const debe = filas.find((f) => f.clienteId === c.clienteId)?.debe || 0}
        {@const r = resultadosCobranza.find((x) => x.clienteId === c.clienteId)}
        <div class="flex items-center gap-3 px-3 py-2 text-sm">
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-900 truncate">{c.nombre}</div>
            <div class="text-xs text-gray-500">
              {c.celular || '—'}
              <span class="ml-1 px-1.5 py-0.5 rounded {c.real ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}">{c.real ? 'Real' : 'Ficticio'}</span>
            </div>
          </div>
          <div class="text-right">
            <div class="font-semibold whitespace-nowrap {debe > 0.5 ? 'text-red-600' : 'text-green-700'}">{debe > 0.5 ? formatearMoneda(debe) : 'Al corriente'}</div>
            {#if r}
              <div class="text-xs {r.estado === 'enviado' ? 'text-green-700' : r.estado === 'simulado' ? 'text-gray-500' : 'text-red-600'}" title={r.detalle || ''}>
                {r.estado === 'enviado' ? 'Enviado ✓' : r.estado === 'simulado' ? 'Simulado' : `Error: ${r.detalle || ''}`}
              </div>
            {:else if enviandoCobranza}
              <div class="text-xs text-gray-400">Enviando…</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    {#if errorCobranza}
      <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{errorCobranza}</div>
    {/if}
    <div class="flex justify-end">
      <Button variant="outline" on:click={() => (cobranzaAbierta = false)} disabled={enviandoCobranza}>Cerrar</Button>
    </div>
  </div>
</Modal>
