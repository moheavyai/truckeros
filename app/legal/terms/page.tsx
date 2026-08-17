import Link from 'next/link'
import { CURRENT_TERMS_VERSION, LEGAL_CONTACT } from '@/lib/legal'

export const metadata = {
  title: 'Terms of Service · MoHeavy AI',
  description: 'Terms of Service for the MoHeavy AI platform operated by MoHeavy AI, LLC.',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-black rounded flex items-center justify-center">
              <span className="text-white text-lg font-bold tracking-tighter">M</span>
            </div>
            <span className="text-xl font-semibold tracking-tight text-gray-900">MoHeavy AI</span>
          </Link>
          <Link href="/login" className="text-sm font-medium text-gray-700 hover:text-black">
            Log In
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 prose prose-gray prose-headings:tracking-tight">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-8">
          Last updated: August 16, 2026 · Version {CURRENT_TERMS_VERSION}
        </p>

        <p>
          These Terms of Service (“Terms”) govern your access to and use of the MoHeavy AI
          platform and related services (the “Service”). The Service is operated by{' '}
          <strong>MoHeavy AI, LLC</strong> (“MoHeavy AI, LLC,” “we,” “us,” or “our”), a Missouri
          limited liability company. In these Terms, “MoHeavy AI” refers to the product and
          platform; “MoHeavy AI, LLC” refers to the legal entity that operates it. The two may be
          used interchangeably where the context is clear.
        </p>

        <p>
          By creating an account or using the Service, you agree to these Terms and our{' '}
          <Link href="/legal/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>

        <h2>1. The Service</h2>
        <p>
          MoHeavy AI provides tools that help owner-operators and small carriers analyze routes,
          identify oversize/overweight (OSOW) permit and escort requirements, manage equipment
          profiles, and prepare information for state permit portals.
        </p>
        <p>
          <strong>Important limitations.</strong> The Service is a decision-support and
          productivity tool only. We do <strong>not</strong> file permits on your behalf, act as a
          motor carrier, broker, or legal advisor, or guarantee that any suggestion, corridor, cost
          estimate, or prefill will be accepted by a state agency. You remain solely responsible
          for the accuracy of all information you enter, for obtaining all required permits and
          escorts, and for compliance with every applicable law and regulation.
        </p>

        <h2>2. Accounts</h2>
        <p>
          You must provide accurate information and keep your credentials secure. You are
          responsible for all activity under your account. We may suspend or terminate accounts that
          violate these Terms or that we reasonably believe pose a security or legal risk.
        </p>

        <h2>3. Acceptable Use</h2>
        <p>You may use the Service only for lawful commercial transportation purposes. You may not:</p>
        <ul>
          <li>Attempt to reverse-engineer, scrape, or abuse the Service</li>
          <li>Share login credentials</li>
          <li>Use the Service to support illegal loads or evade permit requirements</li>
          <li>Interfere with other users or the integrity of the platform</li>
        </ul>

        <h2>4. Your Data &amp; Our Intellectual Property</h2>
        <p>
          You retain ownership of the data you upload (equipment, routes, driver information,
          etc.). You grant MoHeavy AI, LLC a limited license to host, process, and display that data
          solely to provide and improve the Service.
        </p>
        <p>
          MoHeavy AI, LLC owns the Service itself, including software, models, algorithms, and
          generated analyses and outputs (excluding your underlying data). You may not copy or
          redistribute our intellectual property.
        </p>

        <h2>5. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” WE DISCLAIM ALL WARRANTIES, EXPRESS
          OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE,
          OR THAT ANY ROUTE, PERMIT, OR COST SUGGESTION WILL BE ACCURATE OR COMPLETE.
        </p>

        <h2>6. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, MOHEAVY AI, LLC AND ITS AFFILIATES WILL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR
          ANY LOSS OF PROFITS, DATA, OR BUSINESS OPPORTUNITY, ARISING OUT OF OR RELATED TO YOUR USE
          OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE AMOUNT YOU PAID US
          (IF ANY) IN THE TWELVE MONTHS PRECEDING THE CLAIM.
        </p>

        <h2>7. Indemnification</h2>
        <p>
          You agree to indemnify and hold MoHeavy AI, LLC harmless from any claims, losses, or
          expenses (including reasonable attorneys’ fees) arising from your use of the Service, your
          data, or your violation of these Terms or applicable law.
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update these Terms from time to time. We will post the updated version and revise
          the “Last updated” date and version. Continued use after the effective date constitutes
          acceptance. For material changes we may also require re-acceptance.
        </p>

        <h2>9. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate access for
          violation of these Terms or for other legitimate reasons. Provisions that by their nature
          should survive (including ownership, disclaimers, limitation of liability, and
          indemnification) will survive termination.
        </p>

        <h2>10. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of Missouri, without regard to
          conflict-of-law principles. Any disputes will be resolved in the state or federal courts
          located in Missouri.
        </p>

        <h2>11. Contact</h2>
        <p>
          Questions about these Terms:{' '}
          <a href={`mailto:${LEGAL_CONTACT.legal}`} className="underline">
            {LEGAL_CONTACT.legal}
          </a>
        </p>

        <p className="mt-12 text-sm text-gray-500">
          <Link href="/legal/privacy" className="underline">
            Privacy Policy
          </Link>
          {' · '}
          <Link href="/" className="underline">
            Home
          </Link>
        </p>
      </main>
    </div>
  )
}
