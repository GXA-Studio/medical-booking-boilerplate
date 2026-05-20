'use client'
import * as React from 'react'

const TOAST_LIMIT = 3
const DEFAULT_TOAST_DURATION = 3500

type ToastVariant = 'default' | 'destructive' | 'success'

export interface Toast {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

type ToasterToast = Toast & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const listeners: Array<(state: ToasterToast[]) => void> = []
let memoryState: ToasterToast[] = []

function dispatch(toasts: ToasterToast[]) {
  memoryState = toasts
  listeners.forEach((l) => l(toasts))
}

function toast(props: Omit<Toast, 'id'>) {
  const id = String(Math.random())
  const update = (t: Partial<Toast>) =>
    dispatch(memoryState.map((item) => (item.id === id ? { ...item, ...t } : item)))
  const dismiss = () => dispatch(memoryState.filter((item) => item.id !== id))

  const duration = props.duration ?? DEFAULT_TOAST_DURATION

  dispatch([
    {
      ...props,
      id,
      open: true,
      onOpenChange: (open: boolean) => {
        if (!open) dismiss()
      },
    },
    ...memoryState,
  ].slice(0, TOAST_LIMIT))

  // Auto-dismiss after the configured duration
  if (duration > 0) {
    setTimeout(dismiss, duration)
  }

  return { id, dismiss, update }
}

function useToast() {
  const [toasts, setToasts] = React.useState<ToasterToast[]>(memoryState)

  React.useEffect(() => {
    listeners.push(setToasts)
    return () => {
      const index = listeners.indexOf(setToasts)
      if (index > -1) listeners.splice(index, 1)
    }
  }, [])

  return { toasts, toast, dismiss: (id: string) => dispatch(memoryState.filter((t) => t.id !== id)) }
}

export { useToast, toast }
