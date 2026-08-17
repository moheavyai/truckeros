import Link from 'next/link'
import { CURRENT_PRIVACY_VERSION, LEGAL_CONTACT } from '@/lib/legal'

export const metadata = {
  title: 'Privacy Policy · MoHeavy AI',
  description: 'Privacy Policy for the MoHeavy AI platform operated by MoHeavy AI, LLC.',
}

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">
          Last updated: August 16, 2026 · Version {CURRENT_PRIVACY_VERSION}
        </p>

        <p>
          This Privacy Policy explains how <strong>MoHeavy AI, LLC</strong> (“MoHeavy AI, LLC,”
          “we,” “us,” or “our”) collects, uses, and shares information when you use the MoHeavy AI
          platform and related services (the “Service”). MoHeavy AI is the product; MoHeavy AI, LLC
          is the legal entity that operates it.
        </p>

        <h2>1. Information We Collect</h2>
        <ul>
          <li>
            <strong>Account &amp; profile information</strong>: email, name, phone, company details,
            CDL information and expiration, roles within an organization.
          </li>
          <li>
            <strong>Equipment &amp; operational data</strong>: tractor/trailer dimensions, axle
            configurations, rigs, routes, border crossings, permit analysis history.
          </li>
          <li>
            <strong>Usage &amp; technical data</strong>: log data, device/browser information, IP
            address, and interactions needed for security and performance.
          </li>
          <li>
            <strong>Communications</strong>: messages you send us and records of consent (including
            acceptance of the Terms of Service and this Policy).
          </li>
        </ul>
        <p>We do not intentionally collect information from children under 16.</p>

        <h2>2. How We Use Information</h2>
        <p>We use the information to:</p>
        <ul>
          <li>Provide, maintain, and improve the Service</li>
          <li>Authenticate users and manage organizations and roles</li>
          <li>Generate route and permit analysis, prefill packages, and related features</li>
          <li>Communicate with you about the Service</li>
          <li>Detect, prevent, and respond to security incidents and abuse</li>
          <li>Comply with legal obligations</li>
        </ul>

        <h2>3. How We Share Information</h2>
        <p>We do <strong>not</strong> sell your personal information.</p>
        <p>We share information only:</p>
        <ul>
          <li>
            With service providers who help us operate the platform (including Supabase for
            authentication and database, Vercel for hosting, and any mapping/routing providers we
            use). These providers are bound by contractual obligations to protect the data.
          </li>
          <li>
            When you choose to use Portal Assist features — information is prepared for{' '}
            <em>your</em> use on state agency websites; we do not automatically submit it to any
            state.
          </li>
          <li>
            If required by law, legal process, or to protect the rights, safety, or property of
            MoHeavy AI, LLC, our users, or the public.
          </li>
          <li>
            In connection with a merger, acquisition, or sale of assets (with notice where
            required).
          </li>
        </ul>

        <h2>4. Data Retention</h2>
        <p>
          We retain information for as long as your account is active or as needed to provide the
          Service. After account deletion or a verified deletion request we will delete or
          de-identify personal data within a reasonable period, except where we must retain it for
          legal, security, or legitimate business purposes.
        </p>

        <h2>5. Security</h2>
        <p>
          We use industry-standard technical and organizational measures (including encryption in
          transit, access controls, and row-level security in our database) designed to protect your
          information. No method of transmission or storage is 100% secure.
        </p>

        <h2>6. Your Rights &amp; Choices</h2>
        <p>
          Depending on your location you may have rights to access, correct, delete, or export your
          personal information, or to opt out of certain processing.
        </p>
        <p>
          To exercise these rights, contact us at{' '}
          <a href={`mailto:${LEGAL_CONTACT.privacy}`} className="underline">
            {LEGAL_CONTACT.privacy}
          </a>
          . We will respond within a reasonable time. California residents have additional rights
          under the CCPA/CPRA; we will honor verifiable consumer requests.
        </p>
        <p>
          You can update most profile information directly in the Service. You may also close your
          account.
        </p>

        <h2>7. Cookies &amp; Similar Technologies</h2>
        <p>
          We use only essential cookies and similar technologies needed for authentication,
          security, and basic functionality. We do not currently use advertising or third-party
          tracking cookies. If that changes we will update this Policy and provide appropriate
          controls.
        </p>

        <h2>8. International Users</h2>
        <p>
          The Service is operated from the United States. If you access it from outside the U.S.,
          you understand that your information will be processed in the United States.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will post the revised version and
          update the “Last updated” date and version. Material changes may also be communicated by
          email or in-product notice.
        </p>

        <h2>10. Contact</h2>
        <p>
          Privacy questions or requests:{' '}
          <a href={`mailto:${LEGAL_CONTACT.privacy}`} className="underline">
            {LEGAL_CONTACT.privacy}
          </a>
        </p>

        <p className="mt-12 text-sm text-gray-500">
          <Link href="/legal/terms" className="underline">
            Terms of Service
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
