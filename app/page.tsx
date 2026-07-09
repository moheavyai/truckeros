export default function TruckerOSLanding() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-black rounded flex items-center justify-center">
              <span className="text-white text-lg font-bold tracking-tighter">T</span>
            </div>
            <span className="text-2xl font-semibold tracking-tight">TruckerOS</span>
          </div>
          <a
            href="/login"
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-black transition-colors"
          >
            Log In
          </a>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl sm:text-6xl font-semibold tracking-tighter text-gray-900 mb-6">
            Oversize &amp; Overweight<br />Permits. Simplified.
          </h1>
          <p className="text-xl text-gray-600 mb-10">
            Fast, data-driven permitting for owner-operators and carriers.
            Get accurate state requirements in seconds.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-lg bg-black px-8 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
            >
              Log In
            </a>
            <a
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-gray-300 px-8 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-colors"
            >
              Get Started
            </a>
          </div>
        </div>
      </main>

      {/* Value Props */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div>
              <h3 className="font-semibold mb-2">Real Route Intelligence</h3>
              <p className="text-gray-600 text-sm">
                We analyze your actual route using live data — not blanket rules.
              </p>
            </div>
            <div>
              <div className="text-2xl mb-3">📋</div>
              <h3 className="font-semibold mb-2">State-Specific Rules</h3>
              <p className="text-gray-600 text-sm">
                Accurate permit thresholds per state, not one-size-fits-all.
              </p>
            </div>
            <div>
              <div className="text-2xl mb-3">✅</div>
              <h3 className="font-semibold mb-2">Human Approval Gate</h3>
              <p className="text-gray-600 text-sm">
                Review and approve every permit before anything is submitted.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="max-w-5xl mx-auto px-6 text-center text-sm text-gray-500">
          TruckerOS Permit Agent — Phase I
        </div>
      </footer>
    </div>
  );
}
