// STEP 5 — Patient booking flow (implemented in the next phase)
// Public page — no auth required
// Route: /<clinicSlug>  e.g. /clinica-salud

interface Props {
  params: Promise<{ clinicSlug: string }>
}

export default async function BookingPage({ params }: Props) {
  const { clinicSlug } = await params

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">
        Booking flow for <strong>{clinicSlug}</strong> — coming in Step 5
      </p>
    </main>
  )
}
