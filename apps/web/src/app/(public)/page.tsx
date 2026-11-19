import { Card, StatusBadge } from '@karen/ui/web';

export default function HomePage() {
  return (
    <section aria-labelledby="hero-title" className="space-y-8">
      <div className="space-y-4">
        <StatusBadge tone="warning" label="Pre-release foundation build" />
        <h1 id="hero-title" className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Your life. Understood. Taken care of.
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          You give the goal. KAREN owns the follow-through — with your permission, every step of the
          way.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [
            'Remembers with consent',
            'Only what you choose to share, always viewable and deletable.',
          ],
          ['Asks before acting', 'Every consequential action needs your explicit approval.'],
          ['Honest about outcomes', 'A task is complete only when it is verified.'],
        ].map(([title, body]) => (
          <Card key={title}>
            <h2 className="font-medium">{title}</h2>
            <p className="mt-2 text-sm text-muted">{body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
