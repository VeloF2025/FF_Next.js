/**
 * Registration Form Fields Component
 * Name, email, password, and confirm password fields for registration mode
 */

import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { RegistrationFieldsProps } from './LoginFormTypes';

export function RegistrationFields({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  showPassword,
  setShowPassword,
  showConfirmPassword,
  setShowConfirmPassword
}: RegistrationFieldsProps) {
  return (
    <div className="space-y-4">
      {/* Name fields */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            First Name
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            autoComplete="given-name"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="block w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="First name"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Last Name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            autoComplete="family-name"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="block w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Last name"
          />
        </div>
      </div>

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
            autoComplete="new-password"
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

      {/* Confirm password field */}
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Confirm Password
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Lock className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
          </div>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="block w-full pl-10 pr-10 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Confirm Your Password"
            minLength={6}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute inset-y-0 right-0 pr-3 flex items-center"
          >
            {showConfirmPassword ? (
              <EyeOff className="h-5 w-5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]" />
            ) : (
              <Eye className="h-5 w-5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}