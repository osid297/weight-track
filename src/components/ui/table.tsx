import React from 'react';

interface TableProps {
  children: React.ReactNode;
}

interface TableHeaderProps {
  children: React.ReactNode;
}

interface TableBodyProps {
  children: React.ReactNode;
}

interface TableRowProps {
  children: React.ReactNode;
}

interface TableCellProps {
  children: React.ReactNode;
}

interface TableHeadProps {
  children: React.ReactNode;
}

export function Table({ children }: TableProps) {
  return (
    <table className="min-w-full divide-y divide-gray-200">
      {children}
    </table>
  );
}

export function TableHeader({ children }: TableHeaderProps) {
  return (
    <thead className="bg-gray-50">
      {children}
    </thead>
  );
}

export function TableBody({ children }: TableBodyProps) {
  return (
    <tbody className="bg-white divide-y divide-gray-200">
      {children}
    </tbody>
  );
}

export function TableRow({ children }: TableRowProps) {
  return (
    <tr>
      {children}
    </tr>
  );
}

export function TableCell({ children }: TableCellProps) {
  return (
    <td className="px-6 py-4 whitespace-nowrap">
      {children}
    </td>
  );
}

export function TableHead({ children }: TableHeadProps) {
  return (
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      {children}
    </th>
  );
} 