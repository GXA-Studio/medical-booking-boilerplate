import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Aviso Legal',
  description: 'Aviso legal e información corporativa conforme a la LSSI-CE.',
}

const GXA_NAME  = 'GXA Studio'
const GXA_EMAIL = 'studiogxa@gmail.com'

export default function AvisoLegalPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">

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
          <h1 className="text-3xl font-bold text-slate-900">Aviso Legal</h1>
          <p className="mt-2 text-sm text-slate-500">
            Última actualización: mayo de 2026 · Conforme a la{' '}
            <strong className="text-slate-700">Ley 34/2002, LSSI-CE</strong>
          </p>
        </div>

        <div className="space-y-10 text-slate-700">

          <Section number="1" title="Datos del Titular del Servicio">
            <P>
              En cumplimiento de lo establecido en el artículo 10 de la Ley 34/2002, de 11 de
              julio, de Servicios de la Sociedad de la Información y de Comercio Electrónico
              (LSSI-CE), se ponen a disposición de los usuarios los siguientes datos
              identificativos del titular de la plataforma:
            </P>
            <LegalTable rows={[
              ['Denominación comercial', GXA_NAME],
              ['Actividad',              'Desarrollo y comercialización de software de gestión clínica como servicio (SaaS)'],
              ['Correo electrónico',      GXA_EMAIL],
              ['País de establecimiento', 'España'],
              ['Datos registrales',       'Facilitados en el contrato de prestación de servicios'],
            ]} />
          </Section>

          <Section number="2" title="Objeto y Ámbito de Aplicación">
            <P>
              Este aviso legal regula el acceso y uso de la plataforma de gestión de citas
              médicas desarrollada y operada por {GXA_NAME} (en adelante, «la Plataforma»),
              prestada como servicio (SaaS) en régimen B2B a clínicas, centros sanitarios
              y profesionales de la salud (en adelante, «la Clínica contratante»).
            </P>
            <P className="mt-2">
              El acceso o uso de la Plataforma implica la aceptación plena y sin reservas de
              las presentes condiciones. {GXA_NAME} se reserva el derecho a modificar este
              aviso legal en cualquier momento, siendo efectivas las modificaciones desde su
              publicación en la Plataforma.
            </P>
          </Section>

          <Section number="3" title="Condiciones de Uso">
            <P>El usuario se compromete a hacer un uso lícito de la Plataforma, absteniéndose de:</P>
            <ul className="mt-3 space-y-1.5 list-disc list-inside text-sm leading-relaxed">
              <li>Utilizar la Plataforma con fines fraudulentos o contrarios a la ley.</li>
              <li>Introducir o difundir contenidos ilícitos, lesivos o que vulneren derechos de terceros.</li>
              <li>Realizar acciones que puedan dañar, inutilizar o sobrecargar los sistemas de {GXA_NAME}.</li>
              <li>
                Intentar acceder, alterar o suprimir datos de otras clínicas u otros usuarios
                sin la debida autorización.
              </li>
              <li>
                Reproducir, copiar, distribuir o comunicar públicamente cualquier elemento de
                la Plataforma sin autorización expresa por escrito de {GXA_NAME}.
              </li>
            </ul>
          </Section>

          <Section number="4" title="Propiedad Intelectual e Industrial">
            <P>
              Todos los elementos de la Plataforma —incluyendo, de forma enunciativa y no
              limitativa, el código fuente, la arquitectura del software, el diseño gráfico,
              las interfaces, los logotipos, los textos y la documentación técnica— son
              propiedad exclusiva de {GXA_NAME} o de sus licenciantes, y están protegidos
              por la legislación española e internacional en materia de propiedad intelectual
              e industrial (Real Decreto Legislativo 1/1996, Ley de Propiedad Intelectual).
            </P>
            <P className="mt-2">
              Queda expresamente prohibida cualquier reproducción, distribución, comunicación
              pública o transformación de dichos elementos sin la autorización escrita previa
              de {GXA_NAME}. El incumplimiento de esta prohibición dará lugar a las
              responsabilidades legales previstas en la normativa vigente.
            </P>
          </Section>

          <Section number="5" title="Exclusión de Garantías y Responsabilidad">
            <P>
              {GXA_NAME} no garantiza la disponibilidad continua, ininterrumpida ni libre de
              errores de la Plataforma, si bien se compromete a adoptar las medidas técnicas
              necesarias para mantener los niveles de servicio acordados contractualmente con
              cada Clínica contratante.
            </P>
            <P className="mt-2">
              La Clínica contratante es la única responsable del uso que haga de los datos
              personales de sus pacientes, del cumplimiento de la normativa sanitaria
              aplicable en su territorio, y de la veracidad de la información introducida en
              la Plataforma.
            </P>
            <P className="mt-2">
              {GXA_NAME} no será responsable de daños indirectos, pérdida de datos o lucro
              cesante derivados del uso o de la imposibilidad de uso de la Plataforma, en los
              términos y con los límites establecidos en el contrato de prestación de
              servicios suscrito entre las partes.
            </P>
          </Section>

          <Section number="6" title="Hipervínculos">
            <P>
              La Plataforma puede contener enlaces a sitios web de terceros. {GXA_NAME} no
              controla ni se responsabiliza de los contenidos, políticas de privacidad o
              prácticas de dichos sitios, y su inclusión no implica recomendación ni
              asociación alguna.
            </P>
            <P className="mt-2">
              El establecimiento de hipervínculos hacia la Plataforma por parte de terceros
              requiere autorización previa y escrita de {GXA_NAME}.
            </P>
          </Section>

          <Section number="7" title="Legislación Aplicable y Jurisdicción">
            <P>
              Este aviso legal se rige íntegramente por la legislación española, en particular
              por la <strong>Ley 34/2002, LSSI-CE</strong>, el{' '}
              <strong>Reglamento (UE) 2016/679 (RGPD)</strong>, la{' '}
              <strong>Ley Orgánica 3/2018 (LOPDGDD)</strong> y el{' '}
              <strong>Real Decreto Legislativo 1/1996 (Ley de Propiedad Intelectual)</strong>.
            </P>
            <P className="mt-2">
              Para la resolución de cualquier controversia derivada del acceso o uso de la
              Plataforma, las partes se someten expresamente a la jurisdicción de los Juzgados
              y Tribunales de España, con renuncia a cualquier otro fuero que pudiera
              corresponderles.
            </P>
          </Section>

        </div>

        <div className="mt-12 pt-8 border-t border-slate-200 text-center">
          <p className="text-xs text-slate-400">
            {GXA_NAME} · Plataforma SaaS de gestión de citas médicas
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Contacto:{' '}
            <a href={`mailto:${GXA_EMAIL}`} className="hover:text-primary transition-colors">
              {GXA_EMAIL}
            </a>
          </p>
        </div>

      </div>
    </div>
  )
}

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
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
  return <p className={`text-sm leading-relaxed text-slate-600 ${className}`}>{children}</p>
}

function LegalTable({ rows }: { rows: [string, string][] }) {
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
