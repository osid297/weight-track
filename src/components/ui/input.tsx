import React, { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & { step?: string };

export function Input({
  type = 'text',
  className = '',
  step,
  ...rest
}: InputProps) {
  return (
    <input
      type={type}
      className={`border rounded px-3 py-2 ${className}`}
      step={step}
      {...rest}
    />
  );
} 
