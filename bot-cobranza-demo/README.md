# Bot de cobranza (demo de expo)

Chikenelo 🐔 sin IA. Recibe el comando `cobrar` desde **Reportes → Demo → Cobranza** y le
manda a cada prospecto por WhatsApp el UUID ficticio de las facturas que "debe". Si la
persona contesta, le vuelve a mandar sus UUIDs.

## Arranque

```bash
cd bot-cobranza-demo
npm install
cp .env.example .env   # pon un BOT_TOKEN
npm start              # escanea el QR con el WhatsApp que mandará los mensajes
```

Usa su propia sesión (`auth_info_cobranza/`), así que no toca la de Chikenelo en BOTARDO2.

## En la app (`.env` de cobranza-app)

```
DEMO_CELULAR_REAL=6560000000          # tu celular: cliente demo 1
DEMO_NOMBRE_REAL=TuNombre             # opcional: cómo te saluda el bot
BOT_COBRANZA_URL=http://localhost:3010
BOT_COBRANZA_TOKEN=el-mismo-BOT_TOKEN
```

Y una vez en la BD: `scripts/create-demo-prospectos-table.sql`.

## Comando

`POST /cobrar` con `Authorization: Bearer <BOT_TOKEN>`:

```json
{ "comando": "cobrar", "cobros": [{ "clienteId": 900002, "celular": "526561234567", "nombre": "Ana", "total": 7000, "mensaje": "...", "facturas": [{ "uuid": "…", "concepto": "HONORARIOS 2026-10", "saldo": 3500 }] }] }
```

`GET /estado` indica si está conectado a WhatsApp.
