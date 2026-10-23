// routes/dashboard/+layout.ts
import { onMount } from 'svelte';
import { goto } from '$app/navigation';

// Organización de la cuenta demo de expo: el menú le oculta lo que no lleva a ningún lado
export function load() {
  return { demoOrganizacionId: Number(process.env.DEMO_ORGANIZACION_ID) || null };
}

onMount(() => {
  const token = sessionStorage.getItem('jwt');
  if (!token) {
    goto('/'); // redirige al login si no hay token
  }
});