export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p
        className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: 'var(--tg-primary)' }}
      >
        Phase 0 — Fondations
      </p>
      <h1 className="text-4xl font-bold" style={{ color: 'var(--tg-ink-strong)' }}>
        Teranga RH
      </h1>
      <p className="text-lg" style={{ color: 'var(--tg-ink-muted)' }}>
        La gestion RH et la paie de la zone UEMOA, au niveau des meilleurs SaaS mondiaux. Le socle
        est en construction : multi-tenancy, sécurité, audit et effective dating d&apos;abord — les
        écrans viennent ensuite.
      </p>
      <ul className="space-y-2 text-sm" style={{ color: 'var(--tg-ink-muted)' }}>
        <li>→ Dossier d&apos;architecture : docs/architecture</li>
        <li>→ Décisions gelées : docs/adr</li>
        <li>→ API : http://localhost:3001/v1/health</li>
      </ul>
    </main>
  );
}
