import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { db } from './services/db';

interface WeightEntry {
  date: string;
  weight: number;
}

interface WeeklyStats {
  weekStart: string;
  mean: number;
  sd: number;
  ci: [number, number];
  dataLength: number;
  change?: number;
  changeCI?: [number, number];
}

export default function WeightTrackerApp() {
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [date, setDate] = useState('');
  const [weight, setWeight] = useState('');
  const [confidence, setConfidence] = useState(0.95);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadEntries = async () => {
      try {
        const loadedEntries = await db.getEntries();
        setEntries(loadedEntries);
      } catch (error) {
        console.error('Failed to load entries:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadEntries();
  }, []);

  const addEntry = async () => {
    if (!date || !weight) return;
    const newEntry = { date, weight: parseFloat(weight) };
    try {
      await db.addEntry(newEntry);
      const updatedEntries = await db.getEntries();
      setEntries(updatedEntries);
      setDate('');
      setWeight('');
    } catch (error) {
      console.error('Failed to add entry:', error);
    }
  };

  const removeEntry = async (date: string) => {
    try {
      await db.removeEntry(date);
      const updatedEntries = await db.getEntries();
      setEntries(updatedEntries);
    } catch (error) {
      console.error('Failed to remove entry:', error);
    }
  };

  const weeklyGroups = useMemo(() => {
    const weeks: { [key: string]: WeightEntry[] } = {};
    entries.forEach(({ date, weight }) => {
      const d = new Date(date);
      const monday = new Date(d);
      const day = d.getDay();
      const diff = (day + 6) % 7;
      monday.setDate(d.getDate() - diff);
      const key = monday.toISOString().split('T')[0];
      if (!weeks[key]) weeks[key] = [];
      weeks[key].push({ date, weight });
    });
    return Object.entries(weeks).map(([weekStart, data]) => ({ weekStart, data }));
  }, [entries]);

  function computeMean(arr: number[]) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function computeSD(arr: number[], mean: number) {
    const sumSq = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0);
    return Math.sqrt(sumSq / (arr.length - 1));
  }

  function computeCI(mean: number, sd: number, n: number, conf: number): [number, number] {
    const z = { 0.80: 1.28, 0.90: 1.645, 0.95: 1.96, 0.99: 2.576 }[conf.toFixed(2)] || 1.96;
    const se = sd / Math.sqrt(n);
    const margin = z * se;
    return [mean - margin, mean + margin];
  }

  const results = useMemo(() => {
    const res: WeeklyStats[] = [];
    weeklyGroups.forEach(({ weekStart, data }, idx) => {
      const weights = data.map(d => d.weight);
      const mean = computeMean(weights);
      const sd = weights.length > 1 ? computeSD(weights, mean) : 0;
      const ci: [number, number] = weights.length > 1 ? computeCI(mean, sd, weights.length, confidence) : [mean, mean];
      const entry: WeeklyStats = { weekStart, mean, sd, ci, dataLength: weights.length };

      if (idx > 0) {
        const prev = res[idx - 1];
        const gain = mean - prev.mean;
        const se_combined = Math.sqrt(
          (weights.length > 1 ? sd ** 2 / weights.length : 0) +
          (prev.dataLength > 1 ? prev.sd ** 2 / prev.dataLength : 0)
        );
        const z = { 0.80: 1.28, 0.90: 1.645, 0.95: 1.96, 0.99: 2.576 }[confidence.toFixed(2)] || 1.96;
        const margin = z * se_combined;
        entry.change = gain;
        entry.changeCI = [gain - margin, gain + margin];
      }

      res.push(entry);
    });
    return res;
  }, [weeklyGroups, confidence]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <Card className="p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">Add Weight Entry</h2>
          <div className="flex flex-col md:flex-row gap-4">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="flex-1" />
            <Input type="number" step="0.1" placeholder="Weight (kg)" value={weight} onChange={e => setWeight(e.target.value)} className="flex-1" />
            <Button onClick={addEntry} className="bg-blue-600 hover:bg-blue-700 text-white">Add</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">Entries</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Weight (kg)</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.date}>
                  <TableCell>{entry.date}</TableCell>
                  <TableCell>{entry.weight}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => removeEntry(entry.date)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">Weekly Stats</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week</TableHead>
                <TableHead>Mean (kg)</TableHead>
                <TableHead>95% CI</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>95% CI Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r, idx) => (
                <TableRow key={idx}>
                  <TableCell>{r.weekStart}</TableCell>
                  <TableCell>{r.mean.toFixed(2)}</TableCell>
                  <TableCell>[{r.ci[0].toFixed(2)}, {r.ci[1].toFixed(2)}]</TableCell>
                  <TableCell>{r.change !== undefined ? r.change.toFixed(2) : '-'}</TableCell>
                  <TableCell>{r.changeCI ? `[${r.changeCI[0].toFixed(2)}, ${r.changeCI[1].toFixed(2)}]` : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={results.map(r => ({ week: r.weekStart, mean: r.mean }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip />
                <Line type="monotone" dataKey="mean" stroke="#2563eb" strokeWidth={3} dot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 