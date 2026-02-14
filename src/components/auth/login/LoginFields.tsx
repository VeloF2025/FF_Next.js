/**
 * Login Form Fields Component
 * Email, password, and remember me fields for login mode
 */

import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { LoginFieldsProps } from './LoginFormTypes';

export function LoginFields({
  email,
  setEmail,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  rememberMe,
  setRememberMe
}: LoginFieldsProps) {
  return (
    <div className="space-y-4">
      {/* Email field */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Email address
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Mail className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
          </div>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="block w-full pl-10 pr-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter Your Email Address"
          />
        </div>
      </div>

      {/* Password field */}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Password
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Lock className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
          </div>
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="block w-full pl-10 pr-10 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter Your Password"
            minLength={6}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-3 flex items-center"
          >
            {showPassword ? (
              <EyeOff className="h-5 w-5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]" />
            ) : (
              <Eye className="h-5 w-5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]" />
            )}
          </button>
        </div>
      </div>

      {/* Remember me and forgot password */}
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <input
            id="rememberMe"
            name="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-[var(--ff-border-light)] rounded"
          />
          <label htmlFor="rememberMe" className="ml-2 block text-sm text-[var(--ff-text-primary)]">
            Remember me
          </label>
        </div>
        <div className="text-sm">
          <button
            type="button"
            className="font-medium text-blue-600 hover:text-blue-500"
            onClick={() => {
              // TODO: Implement forgot password modal
            }}
          >
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  );
}