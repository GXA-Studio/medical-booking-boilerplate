'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

type Status = 'idle' | 'loading' | 'success' | 'error'

export default function LandingForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage(null)

    const formData = new FormData(e.currentTarget)
    const payload = {
      name: String(formData.get('name') ?? '').trim(),
      email: String(formData.get('email') ?? '').trim(),
      clinic: String(formData.get('clinic') ?? '').trim(),
      message: String(formData.get('message') ?? '').trim(),
    }

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
        if (res.status === 429) {
          setErrorMessage('Demasiados envíos desde tu IP. Vuelve a intentarlo más tarde.')
        } else if (res.status === 422) {
          setErrorMessage('Revisa los campos: parece que hay algún dato inválido.')
        } else {
          setErrorMessage(body?.message ?? 'Algo ha fallado. Escríbenos por email mientras lo arreglamos.')
        }
        setStatus('error')
        return
      }

      setStatus('success')
      e.currentTarget.reset()
    } catch {
      setErrorMessage('No hemos podido enviar el formulario. ¿Quizá un problema de conexión?')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-8 text-center">
        <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-4" />
        <h3 className="text-xl font-semibold mb-2">¡Recibido!</h3>
        <p className="text-muted-foreground">
          Te responderemos en menos de 24 horas laborables con un hueco para la demo.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label htmlFor="name">Nombre y apellidos</Label>
          <Input id="name" name="name" type="text" required autoComplete="name" placeholder="Marta Ruiz" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email profesional</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder="marta@clinicasonrisa.es" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="clinic">Clínica y ciudad</Label>
        <Input id="clinic" name="clinic" type="text" required placeholder="Clínica Dental Sonrisa — Valencia" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="message">
          Cuéntanos algo de tu agenda <span className="text-muted-foreground font-normal">(opcional)</span>
        </Label>
        <Textarea
          id="message"
          name="message"
          rows={3}
          placeholder="Ej. somos 2 dentistas, recepción coge unas 30 llamadas al día sólo para reservar..."
        />
      </div>

      {status === 'error' && errorMessage && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={status === 'loading'}>
        {status === 'loading' ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Enviando…
          </>
        ) : (
          'Pedir demo'
        )}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        Al enviar aceptas nuestra{' '}
        <a href="/privacidad" className="underline hover:text-foreground">
          política de privacidad
        </a>
        . No compartimos tu email con terceros.
      </p>
    </form>
  )
}
