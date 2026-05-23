import Link from 'next/link'
import type { Metadata } from 'next'
import {
  ArrowRight,
  ShieldCheck,
  MessageCircle,
  CalendarSearch,
  Clock,
  Bot,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import LandingForm from '@/components/marketing/landing-form'

const DEMO_PATH = '/clinica-prueba'
const ADMIN_PATH = '/admin/guest'
const CONTACT_EMAIL = 'studiogxa@gmail.com'

export const metadata: Metadata = {
  title: 'Reservas con WhatsApp para clínicas dentales',
  description:
    'Cero llamadas perdidas. Cero doble-citas. Tus pacientes reservan en 2 minutos. Demo navegable disponible — ningún registro requerido.',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Reservas con WhatsApp para clínicas dentales',
    description:
      'Sistema de reservas médico llave en mano. Confirmación automática por WhatsApp, autogestión sin llamadas, anti-doble-cita.',
    type: 'website',
    locale: 'es_ES',
  },
}

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Imposible reservar la misma hora dos veces',
    body: 'Validación a nivel de base de datos: PostgreSQL rechaza colisiones antes de que existan. Tus pacientes no se encuentran con citas duplicadas, ni siquiera bajo carga.',
  },
  {
    icon: MessageCircle,
    title: 'Cancelaciones por WhatsApp, sin llamar a recepción',
    body: 'Cada paciente recibe un link único de autogestión. Cancela o reprograma en 2 clicks. Tu recepción deja de coger llamadas para mover citas.',
  },
  {
    icon: CalendarSearch,
    title: 'Si no hay hueco hoy, te muestra el próximo',
    body: 'En vez de un calendario vacío, el sistema escanea automáticamente hasta 45 días por delante y enseña la siguiente disponibilidad. Cero abandonos por agenda llena.',
  },
  {
    icon: Clock,
    title: 'Maneja cambios de hora (verano e invierno)',
    body: 'Las citas no se descuadran cuando llega CET/CEST. La agenda mantiene la hora local correcta sin que toques nada.',
  },
  {
    icon: Bot,
    title: 'Protegido contra bots y reservas falsas',
    body: 'Rate-limit por IP y validación estricta de teléfonos E.164. Sin spam, sin huecos bloqueados por bots, sin números inventados.',
  },
]

const TIERS = [
  {
    name: 'Starter',
    setup: 490,
    monthly: 49,
    description: 'Para clínicas que quieren reservas online ya, sin complicaciones.',
    features: [
      'Sistema de reservas en tu subdominio',
      'Confirmación automática por WhatsApp',
      'Portal de autogestión del paciente',
      'Panel de administración para tu equipo',
      'Hasta 3 doctores / especialistas',
      'Soporte por email en horario laboral',
    ],
    cta: 'Empezar con Starter',
    highlighted: false,
  },
  {
    name: 'Pro',
    setup: 890,
    monthly: 89,
    description: 'Para clínicas que quieren recordatorios automáticos y mayor capacidad.',
    features: [
      'Todo lo del Starter',
      'Recordatorios automáticos 24h antes',
      'Número de WhatsApp Business dedicado',
      'Doctores / especialistas ilimitados',
      'Excepciones de agenda (vacaciones, congresos)',
      'Soporte prioritario por WhatsApp',
    ],
    cta: 'Quiero el Pro',
    highlighted: true,
  },
]

export default function Landing() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* ── NAV ───────────────────────────────────────────────────── */}
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="text-base font-bold tracking-tight">
            GXA Studio<span className="text-muted-foreground"> · Reservas</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <a href="#features" className="hidden md:inline-block text-muted-foreground hover:text-foreground">
              Funciones
            </a>
            <a href="#pricing" className="hidden md:inline-block text-muted-foreground hover:text-foreground">
              Precios
            </a>
            <Button asChild size="sm" variant="outline">
              <a href="#demo">Probar el demo</a>
            </Button>
          </nav>
        </div>
      </header>

      {/* ── HERO ──────────────────────────────────────────────────── */}
      <section className="container py-20 md:py-32 text-center">
        <div className="inline-block rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium mb-8">
          Para clínicas dentales independientes en España
        </div>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 max-w-4xl mx-auto">
          Reservas con WhatsApp <br className="hidden md:block" />
          para tu clínica dental
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Cero llamadas perdidas. Cero doble-citas. Tus pacientes reservan en 2 minutos
          y reciben la confirmación por WhatsApp.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg" className="text-base h-12 px-6">
            <a href="#demo">
              Probar el demo <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="text-base h-12 px-6">
            <a href="#contacto">Solicitar consulta gratuita</a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-6">
          Demo navegable. No requiere registro ni datos personales.
        </p>
      </section>

      <Separator />

      {/* ── DEMO DOBLE ────────────────────────────────────────────── */}
      <section id="demo" className="container py-16 md:py-20">
        <div className="max-w-2xl mx-auto text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            Prueba el sistema completo
          </h2>
          <p className="text-muted-foreground">
            Sin registro. Sin límites. La misma app que usaría tu clínica.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <div className="border rounded-lg p-8 bg-card">
            <span className="inline-block text-xs font-medium bg-muted px-2 py-1 rounded mb-4">
              Vista del paciente
            </span>
            <h3 className="font-bold text-lg mb-2">Como lo ve quien reserva</h3>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Elige servicio, médico, fecha y hora. Recibe confirmación por WhatsApp en segundos.
            </p>
            <Button asChild className="w-full">
              <Link href={DEMO_PATH}>
                Reservar una cita <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="border rounded-lg p-8 bg-card">
            <span className="inline-block text-xs font-medium bg-primary/10 text-primary px-2 py-1 rounded mb-4">
              Panel de gestión
            </span>
            <h3 className="font-bold text-lg mb-2">Como lo ves tú</h3>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              Agenda, citas, médicos y horarios en tiempo real. Entra con las credenciales del demo:
            </p>
            <div className="bg-muted rounded-md px-4 py-3 mb-6 font-mono text-sm space-y-1">
              <div>
                <span className="text-muted-foreground">email: </span>admin@demo.com
              </div>
              <div>
                <span className="text-muted-foreground">contraseña: </span>demo1234
              </div>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href={ADMIN_PATH}>
                Entrar al panel <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <Separator />

      {/* ── FEATURES ──────────────────────────────────────────────── */}
      <section id="features" className="container py-20 md:py-28">
        <div className="max-w-2xl mx-auto text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Lo que ninguna herramienta genérica ofrece
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Construido específicamente para clínicas. Cada decisión técnica resuelve un
            problema real de recepción y agenda médica.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="border rounded-lg p-6 bg-card hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start gap-4">
                <div className="rounded-md bg-primary/10 p-2 shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* ── PRICING ───────────────────────────────────────────────── */}
      <section id="pricing" className="container py-20 md:py-28">
        <div className="max-w-2xl mx-auto text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Precio claro, sin sorpresas
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Pago único de instalación + mensualidad fija. Sin permanencia,
            sin comisiones por reserva.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={
                tier.highlighted
                  ? 'rounded-lg border-2 border-primary bg-card p-8 relative shadow-md'
                  : 'rounded-lg border bg-card p-8'
              }
            >
              {tier.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-primary-foreground text-xs font-medium px-3 py-1">
                  Recomendado
                </span>
              )}
              <h3 className="text-xl font-bold mb-2">{tier.name}</h3>
              <p className="text-sm text-muted-foreground mb-6 min-h-[2.5rem]">
                {tier.description}
              </p>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{tier.monthly} €</span>
                <span className="text-muted-foreground">/mes</span>
              </div>
              <div className="text-sm text-muted-foreground mb-6">
                + {tier.setup} € de instalación única
              </div>
              <Button
                asChild
                className="w-full mb-6"
                variant={tier.highlighted ? 'default' : 'outline'}
              >
                <a href="#contacto">{tier.cta}</a>
              </Button>
              <ul className="space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* ── CONTACTO ──────────────────────────────────────────────── */}
      <section id="contacto" className="container py-20 md:py-28">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-block rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium mb-6">
              Consulta inicial gratuita
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              ¿Te lo enseñamos en vivo?
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Sin coste ni compromiso. Cuéntanos cómo trabaja tu clínica y te enseñamos
              en vivo cómo encajaría el sistema en tu día a día.
            </p>
          </div>
          <LandingForm />
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <footer className="border-t">
        <div className="container py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div>
            © {new Date().getFullYear()} GXA Studio. Sistema de reservas médico.
          </div>
          <div className="flex items-center gap-6">
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground">
              {CONTACT_EMAIL}
            </a>
            <Link href="/privacidad" className="hover:text-foreground">
              Privacidad
            </Link>
            <Link href="/aviso-legal" className="hover:text-foreground">
              Aviso legal
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
