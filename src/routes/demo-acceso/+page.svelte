<script lang="ts">
  // Entrada desde el botón "Ver Cobranza" de la demo de AICuenta: canjea el pase de la
  // URL por una sesión de la cuenta demo y abre el dashboard.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { guardarSesion } from '$lib/auth';

  let error = '';

  onMount(async () => {
    const t = new URLSearchParams(window.location.search).get('t');
    // Quitar el pase de la barra de direcciones y del historial
    history.replaceState(null, '', '/demo-acceso');
    try {
      const response = await fetch('/api/demo-acceso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo entrar a la demo');
      await guardarSesion(data);
      goto('/dashboard', { replaceState: true });
    } catch (err) {
      error = err instanceof Error ? err.message : 'No se pudo entrar a la demo';
    }
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-50 p-6">
  <div class="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md text-center">
    {#if error}
      <h1 class="text-xl font-bold text-gray-800 mb-2">No se pudo entrar</h1>
      <p class="text-sm text-gray-600 mb-6">{error}</p>
      <a href="/" class="text-indigo-600 font-medium hover:underline">Ir al inicio de sesión</a>
    {:else}
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      <p class="mt-4 text-gray-700">Entrando a la demo de cobranza…</p>
    {/if}
  </div>
</div>
