import React from 'react';

interface TableProps {
  children: React.ReactNode;
  className?: string;
  [key: string]: any;
}

interface TableHeaderProps { children: React.ReactNode; className?: string; [key: string]: any; }
interface TableBodyProps { children: React.ReactNode; className?: string; [key: string]: any; }
interface TableRowProps { children: React.ReactNode; className?: string; [key: string]: any; }
interface TableCellProps { children: React.ReactNode; className?: string; [key: string]: any; }
interface TableHeadProps { children: React.ReactNode; className?: string; [key: string]: any; }

export function Table({ children, className = '', ...rest }: TableProps) {
  return (
    <table className={`min-w-full divide-y divide-gray-200 ${className}`} {...rest}>
      {children}
    </table>
  );
}

export function TableHeader({ children, className = '', ...rest }: TableHeaderProps) {
  return (
    <thead className={`bg-gray-50 ${className}`} {...rest}>
      {children}
    </thead>
  );
}

export function TableBody({ children, className = '', ...rest }: TableBodyProps) {
  return (
    <tbody className={`bg-white divide-y divide-gray-200 ${className}`} {...rest}>
      {children}
    </tbody>
  );
}

export function TableRow({ children, className = '', ...rest }: TableRowProps) {
  return (
    <tr className={className} {...rest}>
      {children}
    </tr>
  );
}

export function TableCell({ children, className = '', ...rest }: TableCellProps) {
  return (
    <td className={`px-6 py-4 whitespace-nowrap ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function TableHead({ children, className = '', ...rest }: TableHeadProps) {
  return (
    <th className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${className}`} {...rest}>
      {children}
    </th>
  );
} 
