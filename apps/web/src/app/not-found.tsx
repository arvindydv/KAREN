import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-5xl space-y-3 px-6 pt-28 pb-12">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/" className="underline">
        Go home
      </Link>
    </div>
  );
}
