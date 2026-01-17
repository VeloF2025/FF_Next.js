/**
 * Terms of Service Page
 * Public page for Sage API registration and legal compliance
 * URL: vf.fibreflow.app/terms or app.fibreflow.app/terms
 */

import Head from 'next/head';
import Link from 'next/link';
import { Network, ArrowLeft } from 'lucide-react';

export default function TermsOfServicePage() {
  const lastUpdated = 'January 17, 2026';

  return (
    <>
      <Head>
        <title>Terms of Service - FibreFlow</title>
        <meta name="description" content="FibreFlow Terms of Service and User Agreement" />
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
              <h1 className="text-3xl font-bold text-[var(--ff-text-primary)] mb-2">Terms of Service</h1>
              <p className="text-[var(--ff-text-tertiary)] mb-8">Last updated: {lastUpdated}</p>

              <div className="prose prose-invert prose-purple max-w-none">
                <Section title="1. Agreement to Terms">
                  <p>
                    By accessing or using the FibreFlow platform (&quot;Service&quot;), operated by VelocityFibre (Pty) Ltd
                    (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), you agree to be bound by these Terms of Service
                    (&quot;Terms&quot;). If you disagree with any part of the terms, you may not access the Service.
                  </p>
                </Section>

                <Section title="2. Description of Service">
                  <p>
                    FibreFlow is an enterprise fiber network project management platform that provides:
                  </p>
                  <ul>
                    <li>Project planning and tracking for fiber deployments</li>
                    <li>Procurement management including purchase orders and supplier management</li>
                    <li>Integration with third-party accounting systems (e.g., Sage Business Cloud)</li>
                    <li>Field operations coordination and quality assurance tools</li>
                    <li>Reporting and analytics capabilities</li>
                  </ul>
                </Section>

                <Section title="3. User Accounts">
                  <p>
                    When you create an account with us, you must provide accurate, complete, and current information.
                    You are responsible for safeguarding your password and for all activities under your account.
                  </p>
                  <p>
                    You agree to notify us immediately of any unauthorized use of your account or any other breach of security.
                  </p>
                </Section>

                <Section title="4. Third-Party Integrations">
                  <p>
                    The Service may integrate with third-party services including but not limited to:
                  </p>
                  <ul>
                    <li><strong>Sage Business Cloud Accounting</strong> - For financial data synchronization</li>
                    <li><strong>1Map GIS</strong> - For geographic information and mapping</li>
                    <li><strong>WhatsApp Business API</strong> - For field communication</li>
                    <li><strong>Firebase</strong> - For file storage and authentication</li>
                  </ul>
                  <p>
                    Your use of these integrations is subject to the respective third-party terms of service.
                    We are not responsible for the availability, accuracy, or content of third-party services.
                  </p>
                </Section>

                <Section title="5. Data Processing">
                  <p>
                    By using the Service, you authorize us to:
                  </p>
                  <ul>
                    <li>Process and store project data including supplier information, purchase orders, and financial records</li>
                    <li>Synchronize data with connected third-party services as authorized by you</li>
                    <li>Use anonymized and aggregated data for service improvement</li>
                  </ul>
                  <p>
                    We implement appropriate technical and organizational measures to protect your data.
                    See our <Link href="/privacy" className="text-purple-400 hover:text-purple-300">Privacy Policy</Link> for details.
                  </p>
                </Section>

                <Section title="6. Acceptable Use">
                  <p>You agree not to:</p>
                  <ul>
                    <li>Use the Service for any unlawful purpose</li>
                    <li>Attempt to gain unauthorized access to any part of the Service</li>
                    <li>Interfere with or disrupt the Service or servers</li>
                    <li>Upload malicious code or content</li>
                    <li>Impersonate any person or entity</li>
                    <li>Share your account credentials with unauthorized users</li>
                  </ul>
                </Section>

                <Section title="7. Intellectual Property">
                  <p>
                    The Service and its original content, features, and functionality are owned by VelocityFibre (Pty) Ltd
                    and are protected by international copyright, trademark, and other intellectual property laws.
                  </p>
                  <p>
                    You retain all rights to data you input into the Service. By using the Service, you grant us
                    a license to use, process, and store your data solely for the purpose of providing the Service.
                  </p>
                </Section>

                <Section title="8. Limitation of Liability">
                  <p>
                    To the maximum extent permitted by law, VelocityFibre (Pty) Ltd shall not be liable for any
                    indirect, incidental, special, consequential, or punitive damages, including loss of profits,
                    data, or other intangible losses, resulting from:
                  </p>
                  <ul>
                    <li>Your use or inability to use the Service</li>
                    <li>Any unauthorized access to your data</li>
                    <li>Interruption or cessation of the Service</li>
                    <li>Third-party service failures or data inaccuracies</li>
                  </ul>
                </Section>

                <Section title="9. Indemnification">
                  <p>
                    You agree to indemnify and hold harmless VelocityFibre (Pty) Ltd and its directors, officers,
                    employees, and agents from any claims, damages, losses, or expenses arising from your use
                    of the Service or violation of these Terms.
                  </p>
                </Section>

                <Section title="10. Termination">
                  <p>
                    We may terminate or suspend your access to the Service immediately, without prior notice,
                    for any reason, including breach of these Terms. Upon termination, your right to use the
                    Service will immediately cease.
                  </p>
                  <p>
                    You may request export of your data within 30 days of account termination.
                  </p>
                </Section>

                <Section title="11. Changes to Terms">
                  <p>
                    We reserve the right to modify these Terms at any time. We will notify you of material changes
                    by posting the new Terms on this page and updating the &quot;Last updated&quot; date.
                  </p>
                  <p>
                    Your continued use of the Service after changes constitutes acceptance of the new Terms.
                  </p>
                </Section>

                <Section title="12. Governing Law">
                  <p>
                    These Terms shall be governed by and construed in accordance with the laws of the Republic
                    of South Africa, without regard to its conflict of law provisions.
                  </p>
                  <p>
                    Any disputes arising from these Terms or the Service shall be resolved in the courts of
                    Gauteng, South Africa.
                  </p>
                </Section>

                <Section title="13. Contact Information">
                  <p>
                    For questions about these Terms, please contact us at:
                  </p>
                  <ul>
                    <li><strong>Company:</strong> VelocityFibre (Pty) Ltd</li>
                    <li><strong>Email:</strong> legal@velocityfibre.co.za</li>
                    <li><strong>Address:</strong> Pretoria, Gauteng, South Africa</li>
                  </ul>
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
                <Link href="/privacy" className="hover:text-[var(--ff-text-primary)] transition-colors">Privacy Policy</Link>
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
TermsOfServicePage.getLayout = (page: React.ReactElement) => page;
