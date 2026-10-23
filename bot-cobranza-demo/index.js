// Bot de cobranza para la demo de la expo.
// Es Chikenelo 🐔 sin la inteligencia: solo se conecta a WhatsApp (misma conexión
// Baileys que BOTARDO2) y manda el mensaje que le indica la app desde
// Reportes > Cobranza. No lee ni contesta mensajes: solo envía.
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3010;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const AUTH_DIR = path.join(__dirname, 'auth_info_cobranza');

let sock = null;
let conectado = false;
let qrActual = null; // último QR, para mostrarlo en http://localhost:PORT/qr

// Start the Baileys connection
async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Fetch the latest WA Web version to avoid 405 errors
    const { version } = await fetchLatestBaileysVersion();
    console.log(`Using WA Web version: ${version.join('.')}`);

    sock = makeWASocket({
        auth: state,
        version,
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrActual = qr;
            console.log(`QR Code received, scan it with your WhatsApp app (o ábrelo en http://localhost:${PORT}/qr):`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            conectado = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 405;
            console.log(`Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(() => startSock(), 3000);
            } else {
                console.log('Logged out or invalid session (405). Deleting auth folder...');
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                startSock();
            }
        } else if (connection === 'open') {
            conectado = true;
            qrActual = null;
            console.log('✅ Bot de cobranza conectado.');
        } else if (connection === 'connecting') {
            console.log('⏳ Connecting...');
        }
    });
}

/** Comando "cobrar": manda a cada celular el mensaje que armó la app */
async function cobrar(lista) {
    const resultados = [];
    for (const c of lista) {
        try {
            const numero = String(c.celular || '').replace(/\D/g, '');
            const [existe] = await sock.onWhatsApp(numero);
            if (!existe?.exists) throw new Error('El número no tiene WhatsApp');

            await sock.sendMessage(existe.jid, { text: c.mensaje });
            console.log(`💸 Mensaje enviado a ${c.nombre} (••••${numero.slice(-4)})`);
            resultados.push({ clienteId: c.clienteId, ok: true });
        } catch (err) {
            console.error(`Error al enviar a ${c.nombre}:`, err.message);
            resultados.push({ clienteId: c.clienteId, ok: false, error: err.message });
        }
    }
    return resultados;
}

async function paginaQr() {
    const contenido = conectado
        ? '<h1>✅ Bot conectado a WhatsApp</h1><p>Ya puedes mandar la cobranza desde la app.</p>'
        : qrActual
            ? `<h1>Escanea con WhatsApp</h1><p>WhatsApp → Dispositivos vinculados → Vincular un dispositivo</p><img src="${await QRCode.toDataURL(qrActual, { width: 320, margin: 2 })}" alt="QR">`
            : '<h1>⏳ Generando QR…</h1>';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>Bot cobranza 🐔</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:40px;background:#f8fafc;color:#0f172a}</style>
</head><body>${contenido}</body></html>`;
}

function responder(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

// === Servidor HTTP: recibe los comandos de la app ===
http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/estado') {
        return responder(res, 200, { conectado });
    }
    // Página con el QR para vincular WhatsApp; se recarga sola porque el QR cambia
    if (req.method === 'GET' && req.url === '/qr') {
        return paginaQr().then((html) => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        });
    }
    if (req.method !== 'POST' || req.url !== '/cobrar') {
        return responder(res, 404, { message: 'No encontrado' });
    }
    if (!BOT_TOKEN || req.headers.authorization !== `Bearer ${BOT_TOKEN}`) {
        return responder(res, 401, { message: 'Token inválido' });
    }

    let body = '';
    req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', async () => {
        let data;
        try {
            data = JSON.parse(body);
        } catch {
            return responder(res, 400, { message: 'JSON inválido' });
        }
        if (data.comando !== 'cobrar' || !Array.isArray(data.cobros)) {
            return responder(res, 400, { message: 'Comando no reconocido' });
        }
        if (!conectado) {
            return responder(res, 503, { message: 'El bot no está conectado a WhatsApp' });
        }
        responder(res, 200, { ok: true, resultados: await cobrar(data.cobros) });
    });
}).listen(PORT, () => {
    console.log(`🐔 Bot de cobranza escuchando en http://localhost:${PORT}`);
    if (!BOT_TOKEN) console.warn('⚠️  Falta BOT_TOKEN en .env: se rechazarán todos los comandos');
});

startSock();
