import type { Metadata } from 'next'
import Link from 'next/link'
import { getClinicLegalData } from '@/lib/clinics/legal'

export const metadata: Metadata = {
  title: 'Política de Privacidad',
  description: 'Información sobre el tratamiento de datos personales conforme al RGPD y la LOPDGDD.',
}

const CONTACT_EMAIL = 'studiogxa@gmail.com'
const GXA_ROLE      = 'GXA Studio (Encargado del Tratamiento · Proveedor SaaS)'
const DPO_EMAIL     = CONTACT_EMAIL

const FALLBACK_CLINIC_NAME = 'La Clínica contratante del servicio'
const FALLBACK_CIF_TEXT    = 'Facilitado en el contrato de prestación de servicios'
const FALLBACK_ADDRESS     = 'Indicado en el contrato de prestación de servicios'

interface PageProps {
  searchParams: Promise<{ slug?: string }>
}

export default async function PrivacidadPage({ searchParams }: PageProps) {
  const { slug } = await searchParams
  const clinic = await getClinicLegalData(slug)

  // White-label values: fall back to placeholders when no clinic context is available
  const clinicName    = clinic?.legal_name || clinic?.name || FALLBACK_CLINIC_NAME
  const clinicCif     = clinic?.cif        || FALLBACK_CIF_TEXT
  const clinicAddress = clinic?.address    || FALLBACK_ADDRESS

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary transition-colors mb-6"
          >
            ← Volver
          </Link>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">
            Documento legal
          </p>
          <h1 className="text-3xl font-bold text-slate-900">Política de Privacidad</h1>
          <p className="mt-2 text-sm text-slate-500">
            Última actualización: mayo de 2026 · Conforme al{' '}
            <strong className="text-slate-700">Reglamento (UE) 2016/679 (RGPD)</strong> y la{' '}
            <strong className="text-slate-700">Ley Orgánica 3/2018 (LOPDGDD)</strong>
          </p>
        </div>

        <div className="space-y-10 text-slate-700">

          {/* 1. Responsable */}
          <Section number="1" title="Responsable del Tratamiento">
            <P>
              En el marco del presente servicio existen dos figuras diferenciadas conforme al
              art. 4 del RGPD:
            </P>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Responsable del tratamiento (la clínica)</p>
                <Table rows={[
                  ['Denominación',       clinicName],
                  ['NIF / CIF',          clinicCif],
                  ['Domicilio social',   clinicAddress],
                  ['Correo de contacto', CONTACT_EMAIL],
                  ['DPD / Contacto RGPD', DPO_EMAIL],
                ]} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Encargado del tratamiento (proveedor tecnológico)</p>
                <Table rows={[
                  ['Denominación', GXA_ROLE],
                  ['Rol',          'Desarrollo, mantenimiento y operación de la plataforma de gestión de citas bajo contrato de encargo (art. 28 RGPD)'],
                  ['Contacto',     CONTACT_EMAIL],
                ]} />
              </div>
            </div>
          </Section>

          {/* 2. Finalidad */}
          <Section number="2" title="Finalidad del Tratamiento">
            <P>
              Los datos personales que nos facilita (nombre completo y número de teléfono) se
              recogen con las siguientes finalidades:
            </P>
            <ul className="mt-3 space-y-2 list-disc list-inside text-sm leading-relaxed">
              <li>
                <strong>Gestión de citas médicas:</strong> crear, confirmar, modificar y cancelar
                su cita con los profesionales de la clínica.
              </li>
              <li>
                <strong>Comunicaciones de servicio:</strong> enviarle la confirmación de la cita y
                el enlace de cancelación mediante mensajería instantánea (WhatsApp), a través del
                servicio de Twilio Inc.
              </li>
              <li>
                <strong>Recordatorios:</strong> notificarle con antelación sobre citas próximas,
                siempre dentro del mismo canal WhatsApp, sin cesión a terceros con fines
                comerciales.
              </li>
            </ul>
            <P className="mt-3">
              Los datos no serán utilizados para ninguna finalidad incompatible con las
              descritas anteriormente.
            </P>
          </Section>

          {/* 3. Legitimación */}
          <Section number="3" title="Base Legal del Tratamiento">
            <P>
              La base jurídica que legitima el tratamiento de sus datos es la{' '}
              <strong>ejecución de un contrato o precontrato</strong> al que el interesado es
              parte, conforme al art. 6.1.b) del RGPD: la solicitud de una cita médica constituye
              el inicio de una relación contractual de prestación de servicios sanitarios.
            </P>
            <P className="mt-2">
              El envío de comunicaciones por WhatsApp se apoya adicionalmente en el{' '}
              <strong>consentimiento explícito</strong> del usuario (art. 6.1.a) del RGPD),
              prestado mediante el marcado del checkbox en el formulario de reserva.
            </P>
          </Section>

          {/* 4. Destinatarios */}
          <Section number="4" title="Destinatarios y Transferencias Internacionales">
            <P>
              Sus datos no se cederán a terceros salvo obligación legal. No obstante, para la
              prestación del servicio intervienen los siguientes encargados del tratamiento:
            </P>
            <Table rows={[
              ['GXA Studio (España)',      'Proveedor SaaS de la plataforma de reservas. Actúa como Encargado del Tratamiento bajo contrato expreso con la clínica (art. 28 RGPD).'],
              ['Twilio Inc. (EE. UU.)',    'Envío de mensajes WhatsApp de confirmación y recordatorio. Opera bajo cláusulas contractuales tipo (SCCs) aprobadas por la Comisión Europea.'],
              ['Supabase Inc. (EE. UU.)',  'Almacenamiento cifrado de la base de datos de citas. Opera bajo cláusulas contractuales tipo (SCCs) aprobadas por la Comisión Europea.'],
              ['Vercel Inc. (EE. UU.)',    'Alojamiento y distribución de la aplicación web. Opera bajo cláusulas contractuales tipo (SCCs) aprobadas por la Comisión Europea.'],
            ]} />
            <P className="mt-3">
              Todos los proveedores indicados actúan como encargados del tratamiento bajo
              contrato de encargo conforme al art. 28 del RGPD.
            </P>
          </Section>

          {/* 5. Conservación */}
          <Section number="5" title="Plazo de Conservación">
            <P>
              Los datos se conservarán durante el tiempo necesario para la gestión de la cita y,
              una vez finalizada la relación, durante los plazos de conservación exigidos por la
              normativa aplicable:
            </P>
            <ul className="mt-3 space-y-1 list-disc list-inside text-sm leading-relaxed">
              <li>Historial de citas: <strong>5 años</strong> (legislación sanitaria autonómica aplicable).</li>
              <li>Datos de facturación, si procede: <strong>5 años</strong> (art. 30 Código de Comercio).</li>
              <li>Registros de consentimiento: hasta la revocación del mismo.</li>
            </ul>
          </Section>

          {/* 6. Derechos */}
          <Section number="6" title="Derechos de los Usuarios">
            <P>
              Conforme al RGPD y la LOPDGDD, puede ejercer en cualquier momento los
              siguientes derechos:
            </P>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                { right: 'Acceso',           desc: 'Conocer qué datos personales suyos tratamos.' },
                { right: 'Rectificación',    desc: 'Corregir datos inexactos o incompletos.' },
                { right: 'Supresión',        desc: 'Solicitar la eliminación de sus datos («derecho al olvido»).' },
                { right: 'Oposición',        desc: 'Oponerse al tratamiento en determinadas circunstancias.' },
                { right: 'Limitación',       desc: 'Solicitar la restricción del tratamiento de sus datos.' },
                { right: 'Portabilidad',     desc: 'Recibir sus datos en un formato estructurado y legible.' },
                { right: 'Retirar consentimiento', desc: 'Sin que ello afecte a la licitud del tratamiento previo.' },
              ].map(({ right, desc }) => (
                <div key={right} className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-sm font-semibold text-slate-900">Derecho de {right}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
            <P className="mt-4">
              Para ejercer cualquiera de estos derechos, envíe un correo a{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-primary underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>{' '}
              indicando su nombre completo, el derecho que desea ejercer y su número de
              teléfono. Responderemos en el plazo máximo de <strong>30 días</strong>.
            </P>
            <P className="mt-2">
              Si considera que el tratamiento no se ajusta a la normativa vigente, puede
              presentar una reclamación ante la{' '}
              <strong>Agencia Española de Protección de Datos (AEPD)</strong>:{' '}
              <a
                href="https://www.aepd.es"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                www.aepd.es
              </a>
              .
            </P>
          </Section>

          {/* 7. Seguridad */}
          <Section number="7" title="Medidas de Seguridad">
            <P>
              Hemos adoptado medidas técnicas y organizativas apropiadas para garantizar la
              seguridad de sus datos personales y evitar su alteración, pérdida, tratamiento o
              acceso no autorizado, habida cuenta del estado de la tecnología, la naturaleza de
              los datos almacenados y los riesgos a los que están expuestos.
            </P>
          </Section>

          {/* 8. Cambios */}
          <Section number="8" title="Modificaciones de esta Política">
            <P>
              Nos reservamos el derecho a actualizar esta política para adaptarla a cambios
              legislativos o mejoras en nuestros servicios. Le notificaremos cualquier cambio
              sustancial a través del canal de WhatsApp o publicando la nueva versión en esta
              misma página con la fecha de actualización.
            </P>
          </Section>

        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-slate-200 text-center">
          <p className="text-xs text-slate-400">
            {clinicName} · Plataforma gestionada por {GXA_ROLE}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Contacto DPD:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-primary transition-colors">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>

      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  number,
  title,
  children,
}: {
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="flex-none w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
          {number}
        </span>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      </div>
      <div className="pl-10">{children}</div>
    </section>
  )
}

function P({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-sm leading-relaxed text-slate-600 ${className}`}>{children}</p>
  )
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {rows.map(([label, value], i) => (
        <div
          key={label}
          className={`flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-4 py-3 text-sm ${
            i < rows.length - 1 ? 'border-b border-slate-100' : ''
          }`}
        >
          <span className="sm:w-56 flex-none font-medium text-slate-700">{label}</span>
          <span className="text-slate-500 leading-relaxed">{value}</span>
        </div>
      ))}
    </div>
  )
}
