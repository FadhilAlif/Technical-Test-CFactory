export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold tracking-tight text-white">
        CFactory Async Image Processor
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        Upload JPG, PNG, or WebP (max 20MB) • Async BullMQ + Sharp Worker Pipeline
      </p>
    </main>
  );
}
