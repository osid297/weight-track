import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeightTrackerApp from './WeightTrackerApp';

// Recharts depends on browser APIs (ResizeObserver, SVG sizing). Mock it to keep tests lean.
jest.mock('recharts', () => {
  const React = require('react');
  const Null: React.FC<any> = () => null;
  const Container: React.FC<any> = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    Line: Null,
    XAxis: Null,
    YAxis: Null,
    CartesianGrid: Null,
    Tooltip: Null,
    ReferenceLine: Null,
    Area: Null,
  };
});

function addEntry(date: string, weight: string, calories?: string) {
  fireEvent.change(screen.getByTestId('date-input'), { target: { value: date } });
  fireEvent.change(screen.getByTestId('weight-input'), { target: { value: weight } });
  if (calories !== undefined) {
    fireEvent.change(screen.getByTestId('calories-input'), { target: { value: calories } });
  }
  fireEvent.click(screen.getByTestId('add-button'));
}

function getEntriesTable() {
  const header = screen.getAllByText('Weight (kg)').find(el => el.tagName === 'TH') as HTMLElement;
  return header.closest('table') as HTMLTableElement;
}

function getMeasurementTable() {
  const header = screen.getAllByText('Body Fat (%)').find(el => el.tagName === 'TH') as HTMLElement;
  return header.closest('table') as HTMLTableElement;
}

describe('WeightTrackerApp', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('renders without entering an infinite render loop when prior data exists', () => {
    localStorage.setItem(
      'entries',
      JSON.stringify([
        { date: '2024-01-01', weight: 70, calories: 2200 },
        { date: '2024-01-03', weight: 70.4, calories: 2300 },
        { date: '2024-01-05', weight: 70.8, calories: 2400 },
      ])
    );
    localStorage.setItem('startingBodyFat', '15');

    expect(() => render(<WeightTrackerApp />)).not.toThrow();
  });

  it('adds entries, sorts by date, and deduplicates by last write', () => {
    render(<WeightTrackerApp />);

    addEntry('2024-01-02', '72.0', '2300');
    addEntry('2024-01-01', '70.0', '2200');

    const rows = within(getEntriesTable()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByRole('cell')[0].textContent).toBe('2024-01-01');
    expect(within(rows[1]).getAllByRole('cell')[0].textContent).toBe('2024-01-02');

    // Duplicate date should overwrite prior entry (last write wins)
    addEntry('2024-01-02', '73.0', '2400');
    const rowsAfterDedup = within(getEntriesTable()).getAllByRole('row').slice(1);
    expect(rowsAfterDedup).toHaveLength(2);
    expect(within(rowsAfterDedup[1]).getAllByRole('cell')[1].textContent).toBe('73');
  });

  it('rejects invalid entries and shows a warning', () => {
    render(<WeightTrackerApp />);

    fireEvent.click(screen.getByTestId('add-button'));
    expect(alertSpy).toHaveBeenCalled();

    const rows = within(getEntriesTable()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(0);
  });

  it('allows deleting an entry', () => {
    render(<WeightTrackerApp />);
    addEntry('2024-01-02', '72.0', '2300');

    const entriesTable = getEntriesTable();
    fireEvent.click(within(entriesTable).getByRole('button', { name: /delete/i }));

    expect(within(entriesTable).queryAllByRole('row').slice(1)).toHaveLength(0);
  });

  it('shows progress toward goal weight', () => {
    render(<WeightTrackerApp />);

    fireEvent.change(screen.getByTestId('starting-weight-input'), { target: { value: '60' } });
    fireEvent.change(screen.getByTestId('goal-weight-input'), { target: { value: '70' } });
    addEntry('2024-01-02', '65.0', '2300');

    const progressBar = screen.getByTestId('progress-bar');
    const width = parseFloat(progressBar.style.width);
    expect(width).toBeCloseTo(50, 1);
  });

  it('adds body measurements and renders them in the table', () => {
    render(<WeightTrackerApp />);

    fireEvent.change(screen.getAllByLabelText('Date')[1], { target: { value: '2024-01-10' } }); // measurement date
    fireEvent.change(screen.getByLabelText('Body Fat (%)'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Waist (cm)'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: /add measurements/i }));

    const rows = within(getMeasurementTable()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    const cells = within(rows[0]).getAllByRole('cell');
    expect(cells[0].textContent).toBe('2024-01-10');
    expect(cells[1].textContent).toBe('12.0');
    expect(cells[5].textContent).toBe('80.0');
  });

  it('requires a measurement date and at least one metric', () => {
    render(<WeightTrackerApp />);

    fireEvent.click(screen.getByRole('button', { name: /add measurements/i }));
    expect(alertSpy).toHaveBeenCalled();
    expect(within(getMeasurementTable()).getAllByRole('row').slice(1)).toHaveLength(0);
  });

  it('persists entries to localStorage and reloads them', () => {
    const { unmount } = render(<WeightTrackerApp />);
    addEntry('2024-01-05', '75.0', '2500');
    unmount();

    render(<WeightTrackerApp />);
    expect(screen.getByText('2024-01-05')).toBeInTheDocument();
  });
});
