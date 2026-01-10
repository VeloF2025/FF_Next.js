import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { LoginCredentials, UserRole } from '@/types/auth.types';
import {
  LoginFormProps,
  AuthHeader,
  LoginFields,
  RegistrationFields,
  AuthErrorDisplay,
  GoogleSignInSection,
  SubmitButton
} from './login';

export function LoginForm({ onSuccess, mode = 'login', onModeChange }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { 
    signInWithEmailEnhanced, 
    registerWithEmail, 
    signInWithGoogleEnhanced, 
    error, 
    clearError 
  } = useAuth();

  const isSignUp = mode === 'register';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    clearError();

    try {
      if (isSignUp) {
        // Registration
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        
        await registerWithEmail({
          email,
          password,
          confirmPassword,
          firstName,
          lastName,
          role: UserRole.VIEWER, // Default role for new registrations
        });
      } else {
        // Login
        const credentials: LoginCredentials = {
          email,
          password,
          rememberMe,
        };
        await signInWithEmailEnhanced(credentials);
      }
      onSuccess?.();
    } catch (err) {
      // log.error('Authentication error:', { data: err }, 'LoginForm');
      // Error is handled by the auth context
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      clearError();
      await signInWithGoogleEnhanced(rememberMe);
      onSuccess?.();
    } catch (err) {
      // log.error('Google sign-in error:', { data: err }, 'LoginForm');
      // Error is handled by the auth context
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--ff-bg-tertiary)] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <AuthHeader 
          isSignUp={isSignUp} 
          {...(onModeChange && { onModeChange })} 
        />

        <GoogleSignInSection
          onClick={handleGoogleSignIn}
          loading={isLoading}
          rememberMe={rememberMe}
        />

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <AuthErrorDisplay error={error} />

          {isSignUp ? (
            <RegistrationFields
              firstName={firstName}
              setFirstName={setFirstName}
              lastName={lastName}
              setLastName={setLastName}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              confirmPassword={confirmPassword}
              setConfirmPassword={setConfirmPassword}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              showConfirmPassword={showConfirmPassword}
              setShowConfirmPassword={setShowConfirmPassword}
              isLoading={isLoading}
            />
          ) : (
            <LoginFields
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              rememberMe={rememberMe}
              setRememberMe={setRememberMe}
              isLoading={isLoading}
            />
          )}

          <SubmitButton isSignUp={isSignUp} isLoading={isLoading} />
        </form>

        <div className="text-center text-xs text-[var(--ff-text-tertiary)]">
          By continuing, you agree to FibreFlow&apos;s Terms of Service and Privacy Policy
        </div>
      </div>
    </div>
  );
}