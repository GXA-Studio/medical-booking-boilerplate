'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cancelByToken } from './actions'

export function CancelButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleCancel() {
    setState('loading')
    const result = await cancelByToken(token)
    if (result.success) {
      setState('done')
    } else {
      setErrorMsg(result.error ?? 'Error desconocido.')
      setState('error')
    }
  }

  return (
    <AnimatePresence mode="wait">
      {state === 'idle' && (
        <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Button
            variant="destructive"
            size="lg"
            className="w-full"
            onClick={handleCancel}
          >
            Cancelar esta cita
          </Button>
        </motion.div>
      )}

      {state === 'loading' && (
        <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center py-2">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </motion.div>
      )}

      {state === 'done' && (
        <motion.div
          key="done"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-3 py-4 text-center"
        >
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <p className="text-lg font-bold text-slate-900">Cita cancelada</p>
          <p className="text-sm text-slate-500">El hueco ha quedado libre. ¡Hasta pronto!</p>
        </motion.div>
      )}

      {state === 'error' && (
        <motion.div
          key="error"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3 py-2 text-center"
        >
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="text-sm">{errorMsg}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
