/**
 * VelocityInput Component - Refactored Main Component
 * Premium input with floating labels and glass effects using modular architecture
 */

import React, { useRef } from 'react';
import { cn } from '@/lib/utils';
import { VelocityInputProps } from './types';
import { useVelocityInputState } from './hooks';
import { InputField, FloatingLabel, InputIcons, InputMessages } from './components';

const VelocityInput = React.forwardRef<HTMLInputElement, VelocityInputProps>(
  ({
    className,
    variant,
    size,
    state,
    label,
    error,
    success,
    warning,
    icon,
    iconPosition = 'right',
    showPasswordReveal = false,
    helperText,
    showCharacterCount = false,
    maxLength,
    neonColor,
    loading = false,
    fullWidth = true,
    disableFloating = false,
    value,
    defaultValue,
    type: inputType = 'text',
    onChange,
    onFocus,
    onBlur,
    style,
    ...props
  }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);

    // Use our custom hook for state management
    const {
      focused,
      hasValue,
      showPassword,
      actualType,
      isPasswordInput,
      customNeonStyle,
      characterCount,
      isNearLimit,
      isAtLimit,
      togglePasswordVisibility,
      handleFocus,
      handleBlur,
      handleChange,
    } = useVelocityInputState({
      ...(value !== undefined && { value }),
      ...(defaultValue !== undefined && { defaultValue }),
      inputType,
      showPasswordReveal,
      ...(maxLength !== undefined && { maxLength }),
      ...(neonColor && { neonColor }),
      ...(variant && { variant }),
    });

    // Determine current state based on props
    const currentState = error ? 'error' : success ? 'success' : warning ? 'warning' : state || 'default';

    // Check if label should be floating
    const isFloating = !disableFloating && (focused || hasValue);

    const combinedStyle = {
      ...style,
      ...customNeonStyle,
    };

    // Helper function to create clean props objects for exactOptionalPropertyTypes compatibility
    const createPropsObject = <T extends Record<string, unknown>>(props: T): T => {
      const cleaned: Partial<T> = {};
      Object.entries(props).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          cleaned[key as keyof T] = value as T[keyof T];
        }
      });
      return cleaned as T;
    };

    return (
      <div className={cn('relative', fullWidth ? 'w-full' : 'w-auto')}>
        {/* Input field container */}
        <div className="relative">
      <InputIcons
        icon={icon}
        iconPosition={iconPosition}
        loading={loading}
        focused={focused}
        variant={variant || undefined}
        size={size || undefined}
        isPasswordInput={isPasswordInput}
        showPassword={showPassword}
        onTogglePassword={togglePasswordVisibility}
        showCharacterCount={showCharacterCount}
        characterCount={characterCount}
        inputId={props.id}
      />

      <InputField
        {...props}
        ref={ref}
        type={actualType}
        className={cn(
          'peer',
          className
        )}
        style={combinedStyle}
        variant={variant || undefined}
        size={size || undefined}
        currentState={currentState}
        hasIcon={!!icon}
        iconPosition={iconPosition}
        loading={loading}
        isPasswordInput={isPasswordInput}
        showCharacterCount={showCharacterCount}
        fullWidth={fullWidth}
        customStyle={customNeonStyle}
        onFocusHandler={handleFocus(onFocus)}
        onBlurHandler={handleBlur(onBlur)}
        onChangeHandler={handleChange(onChange)}
        error={error}
        success={success}
        warning={warning}
      />

      <FloatingLabel
        label={label}
        variant={variant || undefined}
        size={size || undefined}
        currentState={currentState}
        isFloating={isFloating}
        focused={focused}
        htmlFor={props.id}
        hasLeftIcon={!!icon && iconPosition === 'left'}
      />
        </div>

        <InputMessages
          {...createPropsObject({
            error,
            warning,
            success,
            helperText,
            inputId: props.id,
          })}
        />
      </div>
    );
  }
);

VelocityInput.displayName = 'VelocityInput';

export { VelocityInput };