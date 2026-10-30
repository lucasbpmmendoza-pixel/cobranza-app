// ─── Demo de solo lectura: eliminar simulado ─────────────────────────────────
// En la demo los botones de eliminar "funcionan": la petición no sale del navegador (el
// servidor igual la rechazaría) y el registro se oculta de los listados hasta cerrar la
// pestaña. La BD no se toca.
const ELIMINADOS_KEY = 'demoEliminados';
const RECURSO_RE = /^\/api\/(facturas|pagos|clientes)(?:\/(\d+))?(?:$|\?)/;

function esSoloLectura(): boolean {
	try {
		return !!JSON.parse(sessionStorage.getItem('userData') || '{}').soloLectura;
	} catch {
		return false;
	}
}

function leerEliminados(): Record<string, number[]> {
	try {
		return JSON.parse(sessionStorage.getItem(ELIMINADOS_KEY) || '{}');
	} catch {
		return {};
	}
}

function respuestaJson(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function simularEliminar(url: string, options: RequestInit): Response {
	const ruta = new URL(url, window.location.origin);
	const match = (ruta.pathname + ruta.search).match(RECURSO_RE);
	if (match) {
		const [, recurso, id] = match;
		let ids: number[] = id ? [Number(id)] : [];
		if (!id && typeof options.body === 'string') {
			try {
				ids = (JSON.parse(options.body).ids || []).map(Number);
			} catch {}
		}
		const eliminados = leerEliminados();
		eliminados[recurso] = [...new Set([...(eliminados[recurso] || []), ...ids])];
		sessionStorage.setItem(ELIMINADOS_KEY, JSON.stringify(eliminados));
	}
	return respuestaJson({ success: true, simulado: true, message: 'Eliminado (demo: no se guarda ningún cambio)' });
}

/** Quita de la respuesta de un listado los registros eliminados en la demo */
async function ocultarEliminados(url: string, response: Response): Promise<Response> {
	const match = new URL(url, window.location.origin).pathname.match(/^\/api\/(facturas|pagos|clientes)$/);
	const ocultos = match ? leerEliminados()[match[1]] : undefined;
	if (!ocultos?.length || !response.ok) return response;

	const fuera = new Set(ocultos);
	const filtrar = (lista: unknown[]) =>
		lista.filter((x: any) => !(x && typeof x === 'object' && fuera.has(Number(x.id ?? x.Id))));
	try {
		const data = await response.clone().json();
		if (Array.isArray(data)) return respuestaJson(filtrar(data), response.status);
		if (data && typeof data === 'object') {
			for (const k of Object.keys(data)) if (Array.isArray(data[k])) data[k] = filtrar(data[k]);
		}
		return respuestaJson(data, response.status);
	} catch {
		return response;
	}
}

// Helper para hacer fetch con autenticación automática
export async function authFetch(url: string, options: RequestInit = {}) {
	if (typeof window !== 'undefined' && esSoloLectura()) {
		const metodo = (options.method || 'GET').toUpperCase();
		if (metodo === 'DELETE') return simularEliminar(url, options);
		// Paso previo de eliminar cliente (quitar sus agentes)
		if (url.startsWith('/api/clientes/remover-agente')) return respuestaJson({ success: true, simulado: true });
		if (metodo === 'GET') return ocultarEliminados(url, await authFetchReal(url, options));
	}
	return authFetchReal(url, options);
}

async function authFetchReal(url: string, options: RequestInit = {}) {
	// Obtener token del sessionStorage
	const token = typeof window !== 'undefined' ? sessionStorage.getItem('jwt') : null;

	// Obtener organizacionId para multi-tenant
	let organizacionId: string | null = null;
	if (typeof window !== 'undefined') {
		const userData = sessionStorage.getItem('userData');
		if (userData) {
			try {
				const user = JSON.parse(userData);
				organizacionId = user.organizacionId?.toString() || null;
			} catch (e) {
				// Ignorar errores de parsing
			}
		}
	}

	// Agregar headers de autenticación
	const headers = new Headers(options.headers || {});

	if (token) {
		headers.set('Authorization', `Bearer ${token}`);
	}

	// Agregar header de organización para multi-tenant (solo si existe)
	if (organizacionId) {
		headers.set('X-Organization-Id', organizacionId);
	}

	if (!headers.has('Content-Type') && options.method !== 'GET') {
		headers.set('Content-Type', 'application/json');
	}

	// Hacer el fetch
	const response = await fetch(url, {
		...options,
		headers
	});

	// Demo de solo lectura: el layout del dashboard avisa que ahí no se pueden hacer cambios
	// (las consultas que no tiene la demo fallan sin aviso)
	if (response.status === 403 && (options.method || 'GET') !== 'GET' && typeof window !== 'undefined') {
		response.clone().json().then((data) => {
			if (data?.soloLectura) window.dispatchEvent(new CustomEvent('demo-solo-lectura', { detail: data.message }));
		}).catch(() => {});
	}

	// Si es 401, redirigir al login
	if (response.status === 401) {
		if (typeof window !== 'undefined') {
			sessionStorage.clear();
			window.location.href = '/';
		}
	}

	return response;
}

// Helper para GET con autenticación
export async function authGet(url: string) {
	const response = await authFetch(url, { method: 'GET' });
	return response.json();
}

// Helper para POST con autenticación
export async function authPost(url: string, data: any) {
	const response = await authFetch(url, {
		method: 'POST',
		body: JSON.stringify(data)
	});
	return response.json();
}

// Helper para PUT con autenticación
export async function authPut(url: string, data: any) {
	const response = await authFetch(url, {
		method: 'PUT',
		body: JSON.stringify(data)
	});
	return response.json();
}

// Helper para DELETE con autenticación
export async function authDelete(url: string) {
	const response = await authFetch(url, { method: 'DELETE' });
	return response.json();
}
