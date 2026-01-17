/**
 * Public Home/Landing Page
 * Used for Sage API registration and public-facing information
 * URL: vf.fibreflow.app/home or app.fibreflow.app/home
 */

import Head from 'next/head';
import Link from 'next/link';
import { Network, Shield, BarChart3, Users, ArrowRight } from 'lucide-react';

export default function PublicHomePage() {
  return (
    <>
      <Head>
        <title>FibreFlow - Fiber Network Project Management</title>
        <meta name="description" content="Enterprise fiber network project management platform for telecom contractors and network operators." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <header className="border-b border-[var(--ff-border)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-2">
                <Network className="h-8 w-8 text-purple-400" />
                <span className="text-xl font-bold text-[var(--ff-text-primary)]">FibreFlow</span>
              </div>
              <Link
                href="/sign-in"
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Sign In
              </Link>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <main>
          <section className="py-20 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto text-center">
              <h1 className="text-4xl sm:text-5xl font-bold text-[var(--ff-text-primary)] mb-6">
                Fiber Network Project Management
              </h1>
              <p className="text-xl text-[var(--ff-text-secondary)] mb-8 max-w-2xl mx-auto">
                Streamline your fiber deployment with end-to-end project management,
                procurement tracking, and real-time field operations monitoring.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
                >
                  Get Started <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/terms"
                  className="inline-flex items-center justify-center px-6 py-3 border border-[var(--ff-border)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors font-medium"
                >
                  Terms of Service
                </Link>
              </div>
            </div>
          </section>

          {/* Features Section */}
          <section className="py-16 px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto">
              <h2 className="text-2xl font-bold text-[var(--ff-text-primary)] text-center mb-12">
                Platform Features
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                <FeatureCard
                  icon={Network}
                  title="Project Management"
                  description="Track fiber deployments from planning to completion with real-time progress monitoring."
                />
                <FeatureCard
                  icon={BarChart3}
                  title="Procurement & Budget"
                  description="Manage purchase orders, supplier invoices, and project budgets with Sage integration."
                />
                <FeatureCard
                  icon={Users}
                  title="Field Operations"
                  description="Coordinate field teams with WhatsApp integration and AI-powered photo review."
                />
                <FeatureCard
                  icon={Shield}
                  title="Quality Assurance"
                  description="Automated QA checks with VLM-powered categorization and compliance tracking."
                />
              </div>
            </div>
          </section>

          {/* Integration Partners */}
          <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-[var(--ff-border)]">
            <div className="max-w-4xl mx-auto text-center">
              <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-6">Integrated With</h2>
              <div className="flex flex-wrap justify-center gap-8 text-[var(--ff-text-secondary)]">
                <span className="text-lg">Sage Business Cloud</span>
                <span className="text-lg">1Map GIS</span>
                <span className="text-lg">WhatsApp Business</span>
                <span className="text-lg">Firebase</span>
              </div>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="border-t border-[var(--ff-border)] py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Network className="h-5 w-5 text-purple-400" />
                <span className="text-[var(--ff-text-primary)] font-medium">FibreFlow</span>
              </div>
              <div className="flex gap-6 text-sm text-[var(--ff-text-tertiary)]">
                <Link href="/terms" className="hover:text-[var(--ff-text-primary)] transition-colors">
                  Terms of Service
                </Link>
                <Link href="/privacy" className="hover:text-[var(--ff-text-primary)] transition-colors">
                  Privacy Policy
                </Link>
                <span>© {new Date().getFullYear()} VelocityFibre</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

function FeatureCard({ icon: Icon, title, description }: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-xl p-6 border border-[var(--ff-border)]">
      <Icon className="h-10 w-10 text-purple-400 mb-4" />
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">{title}</h3>
      <p className="text-[var(--ff-text-secondary)] text-sm">{description}</p>
    </div>
  );
}

// No authentication required - public page
PublicHomePage.getLayout = (page: React.ReactElement) => page;
