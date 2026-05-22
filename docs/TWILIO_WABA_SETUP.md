# Twilio WhatsApp Business API — Proceso de aprobación

Cómo conseguir un número WhatsApp Business dedicado para una clínica, vía Twilio + Meta Business Manager.

> **Plazo real esperado**: 1-3 semanas desde el inicio del trámite hasta la aprobación. Empezar este proceso **el mismo día** que se cierra el contrato con la clínica.

---

## Por qué hace falta

El sandbox de Twilio (`whatsapp:+14155238886`) obliga a que **cada paciente envíe primero un "join <keyword>"** antes de poder recibir mensajes. Esto es inviable para una clínica real con pacientes que no son técnicos.

Un número WABA aprobado permite:
- Enviar WhatsApp a cualquier número sin opt-in previo (siempre dentro de los límites de Meta).
- Mostrar el nombre y logo de la clínica en la conversación.
- Plantillas pre-aprobadas para confirmaciones, recordatorios y cancelaciones.

---

## Fase 1 — Preparación documental (1-2 horas)

Reúne **antes** de entrar a Twilio:

- [ ] Documento legal de la clínica (CIF + escritura, o autónomo con NIF)
- [ ] Foto/escaneo del DNI del titular o administrador único
- [ ] Comprobante de domicilio físico (factura de luz, agua o telecom a nombre de la clínica)
- [ ] Web oficial de la clínica funcionando (no puede ser sandbox)
- [ ] Email corporativo del dominio de la clínica (no Gmail/Hotmail) — Meta lo exige
- [ ] Logo de la clínica en PNG cuadrado mínimo 500x500
- [ ] Número de teléfono local que NO esté ya registrado en WhatsApp personal — recomendado: comprar uno nuevo Twilio (~$1/mes) o usar un fijo VoIP

> Si el cliente no tiene ya un email del dominio, hay que crearlo (ej. `whatsapp@clinicasonrisa.es` con Google Workspace o Zoho gratis) **antes** de empezar.

---

## Fase 2 — Twilio Business Profile (15 min)

1. Login en [console.twilio.com](https://console.twilio.com).
2. Ir a **Account** → **Business Profile**.
3. Completar todos los campos: razón social, sector ("Healthcare > Dentistry/Medical"), tamaño, web, dirección física.
4. Subir documento legal escaneado.
5. Esperar la aprobación del Business Profile — suele tardar **24-72 horas**.

**✅ Verificación**: el Business Profile aparece como "Verified" en el dashboard de Twilio.

---

## Fase 3 — Comprar número Twilio (5 min)

1. En Twilio Console → **Phone Numbers** → **Buy a number**.
2. Filtrar por país (España, +34), tipo "Local" o "Mobile" según disponibilidad.
3. Capabilities: marcar **Voice + SMS**. WhatsApp se añade después por separado.
4. Comprar (~$1/mes coste fijo).

> Alternativa: usar un fijo propio del cliente vía **BYON (Bring Your Own Number)**. Más complejo y solo recomendado si el cliente insiste.

---

## Fase 4 — Solicitar WhatsApp Sender (10 min para iniciar)

1. Twilio Console → **Messaging** → **Senders** → **WhatsApp Senders** → **New WhatsApp Sender**.
2. Seleccionar el número comprado en Fase 3.
3. **Display Name**: nombre comercial de la clínica (ej. "Clínica Dental Sonrisa").
4. **Use case**: "Customer service" + "Appointment reminders".
5. **Vertical**: Healthcare.
6. Submit.

A partir de aquí Twilio te redirige al portal de Meta Business Manager para conectar.

---

## Fase 5 — Meta Business Manager (30 min trabajo + 1-3 semanas espera)

1. Si la clínica no tiene cuenta Meta Business: crearla en [business.facebook.com](https://business.facebook.com) usando el email corporativo.
2. Meta Business Verification:
   - Subir documento legal del paso 1.
   - Subir comprobante de domicilio.
   - Email corporativo verificado.
   - Esta verificación tarda **3-15 días**. Es el cuello de botella principal.
3. Asociar el número Twilio al Business Manager (se hace en el flujo del paso anterior, Twilio te redirige).
4. Meta revisa la solicitud de Sender — tarda **1-7 días** adicionales.

**✅ Verificación final**: en Twilio Console → WhatsApp Senders, el número aparece como **Approved**.

---

## Fase 6 — Configurar en el deploy de la clínica

Una vez aprobado:

```bash
cd ~/projects/medical-booking-boilerplate
# Reemplazar el sandbox por el número aprobado en este proyecto Vercel:
echo "whatsapp:+34<NUMERO_APROBADO>" | npx vercel env rm TWILIO_WHATSAPP_FROM production
echo "whatsapp:+34<NUMERO_APROBADO>" | npx vercel env add TWILIO_WHATSAPP_FROM production
npx vercel --prod  # redeploy para que coja el nuevo env var
```

**✅ Verificación**: hacer un smoke test reservando una cita real → la confirmación debe llegar desde el número de la clínica (no desde el +1415).

---

## Plantillas de mensaje (HSM)

WhatsApp Business exige que mensajes proactivos (no en respuesta a un mensaje del usuario en las últimas 24h) usen **plantillas pre-aprobadas** llamadas HSMs (Highly Structured Messages).

Las plantillas que tenemos en `lib/twilio/client.ts` son **session messages** (respuesta a opt-in implícito al hacer la reserva). Funcionan en sandbox y deberían seguir funcionando en producción dado que el paciente acaba de iniciar la conversación al hacer la reserva (auto-opt-in en los 24h).

**Sin embargo**, el `sendWhatsAppReminder` 24h antes de la cita SÍ requiere HSM. Para activar recordatorios automáticos:

1. Crear una plantilla en Twilio Console → **Content Editor** → categoría "Utility" → "Appointment Reminder".
2. Texto sugerido (variables `{{1}}`, `{{2}}`, `{{3}}` se inyectan en runtime):
   ```
   Hola {{1}}, te recordamos que mañana tienes cita en nuestra clínica el {{2}}. Para gestionarla: {{3}}
   ```
3. Submit a Meta — tarda 1-2 días en aprobarse.
4. Una vez aprobada, refactorizar `sendWhatsAppReminder` para usar `contentSid` en lugar de `body`.

---

## Costes esperados

| Concepto                                    | Coste                  |
|---------------------------------------------|------------------------|
| Número Twilio (local España)                | ~$1/mes                |
| Mensaje session (paciente conversó <24h)   | ~$0.005 / mensaje      |
| Mensaje HSM utility (recordatorio)          | ~$0.04 / mensaje       |
| Mensaje HSM marketing                       | ~$0.07 / mensaje       |

Para una clínica de 200 reservas/mes: ~€8/mes de Twilio. Margen amplio sobre los €49 del tier Starter.

---

## Fallback durante la espera

Hasta que el WABA esté aprobado:

- Configurar `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` (sandbox).
- Avisar a la clínica: durante las primeras 1-3 semanas, cada paciente que reserve por primera vez tiene que enviar "join <keyword>" al +1 415 523 8886. Comunicar el keyword en la recepción de la clínica vía cartelito o mensaje pre-reserva.
- Una vez WABA aprobado, el cambio es invisible para los pacientes — los próximos WhatsApp les llegan del número de la clínica sin opt-in.

---

## Cuándo NO seguir este proceso

Si la clínica:

- Es un autónomo sin verificación legal posible → ofrecer tier Starter con sandbox indefinido (revisar tras 30 días si se sale del sandbox).
- Quiere mensajes 100% sin opt-in en 24h → necesita un canal alternativo (SMS), no WhatsApp.
- Rechaza compartir documentación legal con Meta → no se puede aprobar WABA; alternativa: API de WhatsApp via terceros (Wati, 360dialog) — fuera del scope actual del producto.
