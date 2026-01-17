/**
 * Privacy Policy Page
 * Public page for legal compliance
 * URL: vf.fibreflow.app/privacy or app.fibreflow.app/privacy
 */

import Head from 'next/head';
import Link from 'next/link';
import { Network, ArrowLeft } from 'lucide-react';

export default function PrivacyPolicyPage() {
  const lastUpdated = 'January 17, 2026';

  return (
    <>
      <Head>
        <title>Privacy Policy - FibreFlow</title>
        <meta name="description" content="FibreFlow Privacy Policy - How we collect, use, and protect your data" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <header className="border-b border-[var(--ff-border)]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <Link href="/home" className="flex items-center gap-2">
                <Network className="h-6 w-6 text-purple-400" />
                <span className="text-lg font-bold text-[var(--ff-text-primary)]">FibreFlow</span>
              </Link>
              <Link
                href="/home"
                className="flex items-center gap-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Home
              </Link>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-[var(--ff-bg-secondary)] rounded-xl border border-[var(--ff-border)] p-8 sm:p-12">
              <h1 className="text-3xl font-bold text-[var(--ff-text-primary)] mb-2">Privacy Policy</h1>
              <p className="text-[var(--ff-text-tertiary)] mb-8">Last updated: {lastUpdated}</p>

              <div className="prose prose-invert prose-purple max-w-none">
                <Section title="1. Introduction">
                  <p>
                    VelocityFibre (Pty) Ltd (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the FibreFlow platform.
                    This Privacy Policy explains how we collect, use, disclose, and safeguard your information
                    when you use our Service.
                  </p>
                  <p>
                    We are committed to protecting your privacy in compliance with the Protection of Personal
                    Information Act (POPIA) of South Africa.
                  </p>
                </Section>

                <Section title="2. Information We Collect">
                  <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mt-4 mb-2">2.1 Information You Provide</h3>
                  <ul>
                    <li><strong>Account Information:</strong> Name, email address, organization name, role</li>
                    <li><strong>Project Data:</strong> Project details, locations, timelines, progress information</li>
                    <li><strong>Procurement Data:</strong> Supplier information, purchase orders, invoices, payments</li>
                    <li><strong>Financial Data:</strong> Budget allocations, cost tracking, accounting references</li>
                    <li><strong>Communications:</strong> Messages, feedback, support requests</li>
                  </ul>

                  <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mt-4 mb-2">2.2 Automatically Collected Information</h3>
                  <ul>
                    <li><strong>Usage Data:</strong> Pages visited, features used, timestamps</li>
                    <li><strong>Device Information:</strong> Browser type, operating system, device identifiers</li>
                    <li><strong>Log Data:</strong> IP address, access times, error logs</li>
                  </ul>

                  <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mt-4 mb-2">2.3 Third-Party Data</h3>
                  <p>When you connect integrations, we may receive data from:</p>
                  <ul>
                    <li><strong>Sage Business Cloud:</strong> Supplier records, invoices, payments, GL accounts</li>
                    <li><strong>1Map GIS:</strong> Location data, installation records</li>
                    <li><strong>Authentication Providers:</strong> Profile information from SSO providers</li>
                  </ul>
                </Section>

                <Section title="3. How We Use Your Information">
                  <p>We use the collected information to:</p>
                  <ul>
                    <li>Provide, maintain, and improve the Service</li>
                    <li>Process transactions and send related information</li>
                    <li>Synchronize data with connected third-party services</li>
                    <li>Send administrative notifications and updates</li>
                    <li>Respond to your comments, questions, and support requests</li>
                    <li>Monitor and analyze usage patterns to improve user experience</li>
                    <li>Detect, prevent, and address technical issues and security threats</li>
                    <li>Comply with legal obligations</li>
                  </ul>
                </Section>

                <Section title="4. Data Sharing">
                  <p>We may share your information with:</p>
                  <ul>
                    <li>
                      <strong>Service Providers:</strong> Third-party companies that perform services on our behalf
                      (hosting, analytics, customer support)
                    </li>
                    <li>
                      <strong>Connected Integrations:</strong> When you authorize connections to services like
                      Sage Business Cloud, we share relevant data to enable synchronization
                    </li>
                    <li>
                      <strong>Legal Requirements:</strong> When required by law, court order, or governmental authority
                    </li>
                    <li>
                      <strong>Business Transfers:</strong> In connection with mergers, acquisitions, or asset sales
                    </li>
                  </ul>
                  <p>
                    We do not sell your personal information to third parties.
                  </p>
                </Section>

                <Section title="5. Data Security">
                  <p>
                    We implement appropriate technical and organizational measures to protect your data, including:
                  </p>
                  <ul>
                    <li>Encryption of data in transit (TLS) and at rest</li>
                    <li>Access controls and authentication requirements</li>
                    <li>Regular security assessments and monitoring</li>
                    <li>Secure data centers with physical access controls</li>
                    <li>Employee training on data protection</li>
                  </ul>
                  <p>
                    While we strive to protect your data, no method of transmission over the Internet is 100% secure.
                    We cannot guarantee absolute security.
                  </p>
                </Section>

                <Section title="6. Data Retention">
                  <p>
                    We retain your data for as long as your account is active or as needed to provide services.
                    We may retain certain data for longer periods as required by law or for legitimate business purposes.
                  </p>
                  <p>
                    Upon account termination, we will delete or anonymize your data within 90 days, unless
                    retention is required by law.
                  </p>
                </Section>

                <Section title="7. Your Rights (POPIA)">
                  <p>Under the Protection of Personal Information Act, you have the right to:</p>
                  <ul>
                    <li><strong>Access:</strong> Request a copy of your personal information</li>
                    <li><strong>Correction:</strong> Request correction of inaccurate or incomplete data</li>
                    <li><strong>Deletion:</strong> Request deletion of your data (subject to legal requirements)</li>
                    <li><strong>Objection:</strong> Object to processing of your data in certain circumstances</li>
                    <li><strong>Portability:</strong> Request your data in a structured, machine-readable format</li>
                    <li><strong>Withdraw Consent:</strong> Withdraw consent for optional processing activities</li>
                  </ul>
                  <p>
                    To exercise these rights, contact us at privacy@velocityfibre.co.za
                  </p>
                </Section>

                <Section title="8. Third-Party Integrations">
                  <p>
                    When you connect third-party services to FibreFlow, their privacy policies also apply to
                    their handling of your data:
                  </p>
                  <ul>
                    <li>
                      <strong>Sage Business Cloud:</strong>{' '}
                      <a href="https://www.sage.com/en-za/legal/privacy-and-cookies/" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">
                        Sage Privacy Policy
                      </a>
                    </li>
                    <li>
                      <strong>Clerk Authentication:</strong>{' '}
                      <a href="https://clerk.com/privacy" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">
                        Clerk Privacy Policy
                      </a>
                    </li>
                  </ul>
                </Section>

                <Section title="9. Children&apos;s Privacy">
                  <p>
                    The Service is not intended for individuals under 18 years of age. We do not knowingly
                    collect personal information from children. If you become aware that a child has provided
                    us with personal information, please contact us.
                  </p>
                </Section>

                <Section title="10. International Data Transfers">
                  <p>
                    Your data may be transferred to and processed in countries other than South Africa.
                    We ensure appropriate safeguards are in place to protect your data in accordance with
                    POPIA requirements.
                  </p>
                </Section>

                <Section title="11. Changes to This Policy">
                  <p>
                    We may update this Privacy Policy from time to time. We will notify you of material
                    changes by posting the new policy on this page and updating the &quot;Last updated&quot; date.
                  </p>
                </Section>

                <Section title="12. Contact Us">
                  <p>For questions about this Privacy Policy or our data practices:</p>
                  <ul>
                    <li><strong>Information Officer:</strong> VelocityFibre (Pty) Ltd</li>
                    <li><strong>Email:</strong> privacy@velocityfibre.co.za</li>
                    <li><strong>Address:</strong> Pretoria, Gauteng, South Africa</li>
                  </ul>
                  <p>
                    You may also lodge a complaint with the Information Regulator of South Africa at{' '}
                    <a href="https://www.justice.gov.za/inforeg/" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">
                      www.justice.gov.za/inforeg
                    </a>
                  </p>
                </Section>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-[var(--ff-border)] py-6">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[var(--ff-text-tertiary)]">
              <span>© {new Date().getFullYear()} VelocityFibre (Pty) Ltd</span>
              <div className="flex gap-6">
                <Link href="/home" className="hover:text-[var(--ff-text-primary)] transition-colors">Home</Link>
                <Link href="/terms" className="hover:text-[var(--ff-text-primary)] transition-colors">Terms of Service</Link>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-4">{title}</h2>
      <div className="text-[var(--ff-text-secondary)] space-y-3">{children}</div>
    </section>
  );
}

// No authentication required - public page
PrivacyPolicyPage.getLayout = (page: React.ReactElement) => page;
