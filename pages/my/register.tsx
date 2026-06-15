/**
 * /my/register — field worker self-registration.
 *
 * Two-step flow:
 *   1. Profile (name, phone, site, role, optional ID + selfie)
 *      → POST /api/my/register (via registerFieldWorker)
 *   2. Verify OTP + set 6-digit PIN
 *      → POST /api/my/login/verify-otp (via verifyOtp)
 *
 * On success (sessionIssued) → /my/attendance
 * On PIN-saved-no-session → done_pin_only card
 */

import React from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { RegisterProfileForm } from '@/modules/attendance/portal/client/RegisterProfileForm';
import { RegisterVerifyForm } from '@/modules/attendance/portal/client/RegisterVerifyForm';

type Step = 'profile' | 'verify' | 'done_pin_only';

const MyRegisterPage: NextPage & { getLayout?: (page: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();

  const [step, setStep] = React.useState<Step>('profile');
  const [phone, setPhone] = React.useState('');
  const [info, setInfo] = React.useState<string | null>(null);

  const handleProfileSuccess = (registeredPhone: string) => {
    setPhone(registeredPhone);
    setStep('verify');
    setInfo('We sent a 6-digit code to your WhatsApp.');
  };

  const handleVerifySuccess = async () => {
    await router.push('/my/attendance');
  };

  const handlePinOnly = () => {
    setStep('done_pin_only');
    setInfo(null);
  };

  const handleBack = () => {
    setStep('profile');
    setInfo(null);
  };

  const stepSubtitle =
    step === 'profile'
      ? 'Fill in your details to request access.'
      : step === 'verify'
        ? 'Enter the code from WhatsApp and set a 6-digit PIN.'
        : 'All set.';

  return (
    <MyPortalShell title="Register as a field worker" showFooterNav={false} showHeader={false}>
      <div className="pt-6 pb-2">
        <Link
          href="/my"
          className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sign in
        </Link>
      </div>

      <div className="flex flex-col items-center mb-6">
        <div className="w-16 h-16 rounded-2xl bg-white border border-neutral-800 flex items-center justify-center shadow-lg p-2">
          <img
            src="/assets/vf/vf-logo.svg"
            alt="Velocity Fibre"
            className="w-full h-full object-contain"
          />
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-neutral-100">Register as a field worker</h1>
        <p className="mt-1 text-sm text-neutral-400 text-center">{stepSubtitle}</p>
      </div>

      {info && (
        <div className="rounded-lg bg-blue-950/50 border border-blue-800 px-3 py-2 text-sm text-blue-200 mb-4">
          {info}
        </div>
      )}

      {step === 'profile' && (
        <RegisterProfileForm onSuccess={handleProfileSuccess} />
      )}

      {step === 'verify' && (
        <RegisterVerifyForm
          phone={phone}
          onSuccess={handleVerifySuccess}
          onPinOnly={handlePinOnly}
          onBack={handleBack}
        />
      )}

      {step === 'done_pin_only' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-emerald-950/40 border border-emerald-800 p-5 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-900/60 text-emerald-300 flex items-center justify-center mb-3 text-2xl">
              ✓
            </div>
            <h2 className="text-lg font-semibold text-emerald-200">PIN saved</h2>
            <p className="mt-1 text-sm text-emerald-300">
              Your registration is submitted and your PIN is set up.
              Sign in with your phone number and new PIN.
            </p>
          </div>
          <Link
            href="/my"
            className="block text-center py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-600/20"
          >
            Go to sign in
          </Link>
        </div>
      )}
    </MyPortalShell>
  );
};

MyRegisterPage.getLayout = (page: React.ReactElement) => page;

export default MyRegisterPage;
