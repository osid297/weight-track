import React from 'react';

interface InputProps {
  type?: string;
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  placeholder?: string;
  step?: string;
}

export function Input({
  type = 'text',
  value,
  onChange,
  className = '',
  placeholder,
  step
}: InputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      className={`border rounded px-3 py-2 ${className}`}
      placeholder={placeholder}
      step={step}
    />
  );
} 