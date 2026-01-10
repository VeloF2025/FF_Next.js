/**
 * Authentication Header Component
 * Displays title and mode toggle
 */

import { AuthHeaderProps } from './LoginFormTypes';

export function AuthHeader({ isSignUp, onModeChange }: AuthHeaderProps) {
  return (
    <div>
      <h2 className="mt-6 text-center text-3xl font-extrabold text-[var(--ff-text-primary)]">
        {isSignUp ? 'Create your account' : 'Sign in to FibreFlow'}
      </h2>
      <p className="mt-2 text-center text-sm text-[var(--ff-text-secondary)]">
        {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
        <button
          type="button"
          onClick={() => onModeChange?.(isSignUp ? 'login' : 'register')}
          className="font-medium text-blue-600 hover:text-blue-500"
        >
          {isSignUp ? 'Sign in' : 'Sign up'}
        </button>
      </p>
    </div>
  );
}