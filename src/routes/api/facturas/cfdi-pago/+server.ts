import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import axios from 'axios';
import { getUserFromRequest, unauthorizedResponse } from '$lib/server/auth';
import { FACTURAPI_KEY } from '$env/static/private';

export const POST: RequestHandler = async (event) => {
	const user = getUserFromRequest(event);
	if (!user) {
		return unauthorizedResponse('Token de autenticación requerido');
	}

	const { request } = event;
	try {
		const payload = await request.json();

		const { data: invoice } = await axios.post('https://www.facturapi.io/v2/invoices', payload, {
			auth: {
				username: FACTURAPI_KEY,
				password: ''
			}
		});

		return json({ success: true, invoice });
	} catch (error: any) {
		console.error('Error al crear CFDI de pago:', error?.response?.data || error.message);
		return json(
			{ success: false, error: error?.response?.data?.message || 'Error al crear CFDI de pago' },
			{ status: 500 }
		);
	}
};
