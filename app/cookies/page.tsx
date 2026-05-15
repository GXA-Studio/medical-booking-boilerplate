import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Política de Cookies',
  description: 'Información sobre las cookies utilizadas en la plataforma, conforme a la LSSI-CE y la Directiva ePrivacy.',
}

const GXA_EMAIL = 'studiogxa@gmail.com'

export default function CookiesPage() {
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
          <h1 className="text-3xl font-bold text-slate-900">Política de Cookies</h1>
          <p className="mt-2 text-sm text-slate-500">
            Última actualización: mayo de 2026 · Conforme a la{' '}
            <strong className="text-slate-700">Ley 34/2002, LSSI-CE</strong> y la{' '}
            <strong className="text-slate-700">Directiva 2009/136/CE (ePrivacy)</strong>
          </p>
        </div>

        <div className="space-y-10 text-slate-700">

          <Section number="1" title="¿Qué son las cookies?">
            <P>
              Las cookies son pequeños ficheros de texto que los sitios web depositan en el
              dispositivo del usuario con la finalidad de almacenar información sobre su
              sesión o preferencias. La presente plataforma hace un uso deliberadamente
              mínimo de cookies, limitado estrictamente a las necesarias para el
              funcionamiento técnico del servicio.
            </P>
          </Section>

          <Section number="2" title="Cookies que utilizamos">
            <P>
              Esta plataforma únicamente instala <strong>cookies técnicas o estrictamente
              necesarias</strong> para la gestión de sesiones autenticadas del panel de
              administración. No se utilizan cookies de análisis, publicidad ni seguimiento
              de terceros.
            </P>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm border-collapse rounded-lg overflow-hidden border border-slate-200">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">Cookie</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">Proveedor</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">Finalidad</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 border-b border-slate-200">Duración</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      name: 'sb-*-auth-token',
                      provider: 'Supabase',
                      purpose: 'Mantiene la sesión autenticada del administrador de la clínica en el panel de gestión.',
                      duration: 'Sesión / 1 semana',
                    },
                    {
                      name: 'sb-*-auth-token.0 / .1',
                      provider: 'Supabase',
                      purpose: 'Fragmentos del token de sesión para almacenamiento seguro cuando excede el límite de tamaño de una cookie.',
                      duration: 'Sesión / 1 semana',
                    },
                  ].map((row, i, arr) => (
                    <tr key={row.name} className={i < arr.length - 1 ? 'border-b border-slate-100' : ''}>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.name}</td>
                      <td className="px-4 py-3 text-slate-500">{row.provider}</td>
                      <td className="px-4 py-3 text-slate-500">{row.purpose}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{row.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <P className="mt-4">
              Las cookies de Supabase son <strong>cookies de primera parte</strong> (dominio
              propio) y son de carácter técnico. Conforme al art. 22.2 de la LSSI-CE y la
              Directiva ePrivacy, están exentas del requisito de consentimiento previo dado
              que son estrictamente necesarias para prestar el servicio expresamente
              solicitado por el usuario.
            </P>
          </Section>

          <Section number="3" title="Cookies de Terceros">
            <P>
              <strong>Esta plataforma no instala ninguna cookie de terceros.</strong> No
              utilizamos servicios de análisis web (Google Analytics, Hotjar, etc.), publicidad
              programática ni herramientas de seguimiento de comportamiento de usuario.
            </P>
          </Section>

          <Section number="4" title="Finalidad del Tratamiento">
            <P>
              Las cookies técnicas indicadas se utilizan exclusivamente para:
            </P>
            <ul className="mt-3 space-y-1.5 list-disc list-inside text-sm leading-relaxed">
              <li>
                <strong>Autenticación segura:</strong> permitir que los administradores de la
                clínica accedan al panel de gestión sin necesidad de introducir sus credenciales
                en cada página.
              </li>
              <li>
                <strong>Integridad de la sesión:</strong> proteger la sesión frente a accesos
                no autorizados mediante tokens firmados criptográficamente.
              </li>
              <li>
                <strong>Seguridad:</strong> detectar y prevenir usos abusivos o fraudulentos
                de la plataforma.
              </li>
            </ul>
          </Section>

          <Section number="5" title="Gestión y Desactivación de Cookies">
            <P>
              Dado que las cookies utilizadas son estrictamente necesarias para el
              funcionamiento de la plataforma, su desactivación impedirá el acceso al panel
              de administración. No obstante, puede gestionar o eliminar las cookies desde
              la configuración de su navegador:
            </P>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[
                { browser: 'Google Chrome',   url: 'https://support.google.com/chrome/answer/95647' },
                { browser: 'Mozilla Firefox', url: 'https://support.mozilla.org/kb/cookies-information-websites-store-on-your-computer' },
                { browser: 'Microsoft Edge',  url: 'https://support.microsoft.com/microsoft-edge/cookies' },
                { browser: 'Apple Safari',    url: 'https://support.apple.com/guide/safari/manage-cookies-sfri11471' },
              ].map(({ browser, url }) => (
                <div key={browser} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                  <span className="font-medium text-slate-700">{browser}</span>
                  <br />
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Ver instrucciones →
                  </a>
                </div>
              ))}
            </div>
          </Section>

          <Section number="6" title="Transferencias Internacionales">
            <P>
              Las cookies de sesión son gestionadas por Supabase Inc. (Estados Unidos), que
              opera bajo las Cláusulas Contractuales Tipo (CCT) aprobadas por la Comisión
              Europea como garantía adecuada para transferencias internacionales de datos
              conforme al art. 46 del RGPD.
            </P>
          </Section>

          <Section number="7" title="Actualizaciones de esta Política">
            <P>
              GXA Studio se reserva el derecho a actualizar esta política de cookies para
              adaptarla a cambios legislativos, tecnológicos o en la configuración de la
              plataforma. Le recomendamos revisarla periódicamente. Cualquier cambio
              sustancial será notificado mediante aviso en la plataforma.
            </P>
            <P className="mt-2">
              Para cualquier consulta sobre el uso de cookies, puede contactar con nosotros en{' '}
              <a
                href={`mailto:${GXA_EMAIL}`}
                className="text-primary underline underline-offset-2"
              >
                {GXA_EMAIL}
              </a>
              .
            </P>
          </Section>

        </div>

        <div className="mt-12 pt-8 border-t border-slate-200 text-center">
          <p className="text-xs text-slate-400">GXA Studio · Plataforma SaaS de gestión de citas médicas</p>
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
