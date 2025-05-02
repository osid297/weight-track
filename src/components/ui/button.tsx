import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'outline';
}

export function Button({ 
  children, 
  onClick, 
  className = '', 
  size = 'md',
  variant = 'default'
}: ButtonProps) {
  const sizeClasses = {
    sm: 'px-2 py-1 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg'
  };

  const variantClasses = {
    default: 'bg-blue-600 hover:bg-blue-700 text-white',
    outline: 'border border-gray-300 hover:bg-gray-100'
  };

  return (
    <button
      onClick={onClick}
      className={`rounded ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    >
      {children}
    </button>
  );
} 