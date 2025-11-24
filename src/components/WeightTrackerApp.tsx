import React, { useState, useMemo, ChangeEvent, useEffect } from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area } from 'recharts';

interface WeightEntry {
  date: string;
  weight: number;
  calories?: number;
}

// Add new interface for body measurements
interface BodyMeasurement {
  date: string;
  bodyFat?: number;
  neck?: number;
  shoulders?: number;
  chest?: number;
  waist?: number;
  hips?: number;
  biceps?: number;
  forearms?: number;
  thighs?: number;
  calves?: number;
  [key: string]: string | number | undefined;
}

interface WeeklyGroup {
  weekStart: string;
  data: WeightEntry[];
  startDateMs: number;
}

interface WeeklyStats {
  weekStart: string;
  startDateMs: number;
  mean: number;
  sd: number;
  ci: [number, number];
  dataLength: number;
  change?: number;
  changeCI?: [number, number];
}

interface CaloricInference {
  maintenanceCalories: number;
  confidenceInterval: [number, number];
  weightChangeRate: number;
  weightChangeRateCI: [number, number];
  slopeCI: [number, number];
  intercept: number;
  daysOfData: number;
  r2: number;
  trendData: Array<{ date: string; weight: number; predicted: number; predictedLow: number; predictedHigh: number; predictedRange: number }>;
}

type ConfidenceLevel = 0.80 | 0.90 | 0.95 | 0.99;

const zScores = {
  0.80: 1.28,
  0.90: 1.645,
  0.95: 1.96,
  0.99: 2.576
} as const;

// Constants for caloric calculations
const KCAL_PER_KG = 7700; // Approximate calories in 1kg of body fat
const MIN_DAYS_FOR_INFERENCE = 14; // Minimum days of data needed for inference
const DAY_MS = 24 * 60 * 60 * 1000;
type TrendWindowOption = 14 | 30 | 60 | 'all';
type StatsGroupingOption = '1w' | '2w' | '1m' | '2m';

// Add new interfaces for body composition tracking
interface BodyCompositionEstimate {
  date: string;
  weight: number;
  bodyFatPercentage: number;
  fatMass: number;
  leanMass: number;
  // Confidence values
  bodyFatPercentageCI: [number, number];
  isEstimated: boolean; // false if this is from an actual measurement
}

interface CalibrationFactor {
  date: string;
  muscleGainFactor: number; // How efficiently this person gains muscle in a surplus
  fatLossFactor: number;    // How efficiently this person loses fat in a deficit  
}

// Define the phase type
type SimulationPhase = {
  name: string;
  days: number;
  weeklyGain: number;
  calorieBase: number;
  surplus: number;
  calorieVariation: number;
  weightVariation: number;
  bodyfatIncrease: number;
  muscleGainRatio?: number;  // Optional
  muscleLossRatio?: number;  // Optional
};

function startOfWeek(date: Date) {
  const monday = new Date(date);
  const day = monday.getDay();
  const diff = (day + 6) % 7;
  monday.setDate(monday.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function iso(date: Date) {
  return date.toISOString().split('T')[0];
}

function getGroupInfo(dateStr: string, grouping: StatsGroupingOption) {
  const date = new Date(dateStr);
  const weekStart = startOfWeek(date);

  if (grouping === '1w') {
    const end = new Date(weekStart.getTime() + (7 * DAY_MS) - DAY_MS);
    return { key: iso(weekStart), label: `${iso(weekStart)}`, startDate: weekStart, endDate: end };
  }

  if (grouping === '2w') {
    const weeksSinceEpoch = Math.floor(weekStart.getTime() / (7 * DAY_MS));
    const bucketStartWeek = Math.floor(weeksSinceEpoch / 2) * 2;
    const startDate = new Date(bucketStartWeek * 7 * DAY_MS);
    const endDate = new Date(startDate.getTime() + (14 * DAY_MS) - DAY_MS);
    return { key: `${iso(startDate)}_2w`, label: `${iso(startDate)} to ${iso(endDate)}`, startDate, endDate };
  }

  if (grouping === '1m') {
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { key: `${startDate.getFullYear()}-${startDate.getMonth() + 1}`, label: `${startDate.getFullYear()}-${(startDate.getMonth() + 1).toString().padStart(2, '0')}`, startDate, endDate };
  }

  const bucketMonth = Math.floor(date.getMonth() / 2) * 2;
  const startDate = new Date(date.getFullYear(), bucketMonth, 1);
  const endDate = new Date(date.getFullYear(), bucketMonth + 2, 0);
  return { 
    key: `${startDate.getFullYear()}-${bucketMonth}`, 
    label: `${startDate.getFullYear()}-${(bucketMonth + 1).toString().padStart(2, '0')} to ${endDate.getFullYear()}-${(endDate.getMonth() + 1).toString().padStart(2, '0')}`, 
    startDate, 
    endDate 
  };
}

function filterEntriesByWindow(entries: WeightEntry[], window: TrendWindowOption) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (window === 'all' || sorted.length === 0) return sorted;

  const lastDate = new Date(sorted[sorted.length - 1].date);
  const cutoff = new Date(lastDate.getTime() - (window - 1) * DAY_MS);
  return sorted.filter(e => new Date(e.date) >= cutoff);
}

export default function WeightTrackerApp() {
  const [entries, setEntries] = useState<WeightEntry[]>(() => {
    const saved = localStorage.getItem('entries');
    return saved ? (JSON.parse(saved) as WeightEntry[]) : ([] as WeightEntry[]);
  });
  // Add new state for body measurements
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>(() => {
    const saved = localStorage.getItem('measurements');
    return saved ? (JSON.parse(saved) as BodyMeasurement[]) : ([] as BodyMeasurement[]);
  });
  const [date, setDate] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const [calories, setCalories] = useState<string>('');
  const [confidence, setConfidence] = useState<ConfidenceLevel>(0.95);
  const [trendWindow, setTrendWindow] = useState<TrendWindowOption>('all');
  const [statsGrouping, setStatsGrouping] = useState<StatsGroupingOption>('1w');
  const [goalWeight, setGoalWeight] = useState<string>(() => {
    const saved = localStorage.getItem('goalWeight');
    return saved ? (saved as string) : '';
  });
  // Pagination state for entries
  const [entriesPage, setEntriesPage] = useState<number>(1);
  const [entriesPerPage, setEntriesPerPage] = useState<number>(10);
  // Pagination state for measurements
  const [measurementsPage, setMeasurementsPage] = useState<number>(1);
  const [measurementsPerPage, setMeasurementsPerPage] = useState<number>(5);
  // Pagination state for weekly stats
  const [statsPage, setStatsPage] = useState<number>(1);
  const [statsPerPage, setStatsPerPage] = useState<number>(8);
  const [startingWeight, setStartingWeight] = useState<string>(() => {
    const saved = localStorage.getItem('startingWeight');
    return saved ? (saved as string) : '';
  });
  // Add new state for starting and goal body fat
  const [startingBodyFat, setStartingBodyFat] = useState<string>(() => {
    const saved = localStorage.getItem('startingBodyFat');
    return saved ? (saved as string) : '';
  });
  const [goalBodyFat, setGoalBodyFat] = useState<string>(() => {
    const saved = localStorage.getItem('goalBodyFat');
    return saved ? (saved as string) : '';
  });
  // Add new state for body measurement goals
  const [bodyMeasurementGoals, setBodyMeasurementGoals] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('bodyMeasurementGoals');
    return saved ? ((JSON.parse(saved) || {}) as Record<string, string>) : {};
  });
  const [bodyFat, setBodyFat] = useState<string>('');
  const [measurementInputs, setMeasurementInputs] = useState<Record<string, string>>({});
  const [measurementDate, setMeasurementDate] = useState<string>('');
  // Add new state for body composition estimates
  const [bodyCompositionHistory, setBodyCompositionHistory] = useState<BodyCompositionEstimate[]>([]);
  // Calibration factor that gets adjusted when new measurements are added
  const [calibrationFactor, setCalibrationFactor] = useState<CalibrationFactor>({
    date: new Date().toISOString().split('T')[0],
    muscleGainFactor: 0.3, // Default: 30% of surplus goes to muscle in a surplus
    fatLossFactor: 0.9     // Default: 90% of deficit comes from fat in a deficit
  });

  // Persist entries
  useEffect(() => {
    localStorage.setItem('entries', JSON.stringify(entries));
  }, [entries]);
  // Persist goalWeight
  useEffect(() => {
    localStorage.setItem('goalWeight', goalWeight);
  }, [goalWeight]);
  // Persist startingWeight
  useEffect(() => {
    localStorage.setItem('startingWeight', startingWeight);
  }, [startingWeight]);
  // Persist measurements
  useEffect(() => {
    localStorage.setItem('measurements', JSON.stringify(measurements));
  }, [measurements]);
  
  // Persist body fat goals
  useEffect(() => {
    localStorage.setItem('startingBodyFat', startingBodyFat);
  }, [startingBodyFat]);
  
  useEffect(() => {
    localStorage.setItem('goalBodyFat', goalBodyFat);
  }, [goalBodyFat]);
  
  // Persist measurement goals
  useEffect(() => {
    localStorage.setItem('bodyMeasurementGoals', JSON.stringify(bodyMeasurementGoals));
  }, [bodyMeasurementGoals]);

  const coverage = useMemo(() => {
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const uniqueDates = new Set(sorted.map(e => e.date));
    const weightDays = sorted.length > 0
      ? Array.from(uniqueDates).filter(date => {
          const last = new Date(sorted[sorted.length - 1].date);
          const cutoff = new Date(last.getTime() - 29 * DAY_MS);
          return new Date(date) >= cutoff;
        }).length
      : 0;

    let calorieIntervals = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (typeof sorted[i].calories === 'number' && typeof sorted[i + 1].calories === 'number') {
        calorieIntervals++;
      }
    }

    const lastBodyFat = measurements
      .filter((m: BodyMeasurement) => typeof m.bodyFat === 'number')
      .sort((a: BodyMeasurement, b: BodyMeasurement) => b.date.localeCompare(a.date))[0];
    const lastBFAge = lastBodyFat
      ? Math.max(0, Math.floor((Date.now() - new Date(lastBodyFat.date).getTime()) / DAY_MS))
      : null;

    return { weightDays, calorieIntervals, lastBFAge };
  }, [entries, measurements]);

  const getLatestMeasurementValue = (partName: string): number | undefined => {
    const key = partName.toLowerCase();
    const latestEntry = measurements
      .filter((m: BodyMeasurement) => typeof m[key] === 'number')
      .sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date))
      .pop();
    const value = latestEntry?.[key];
    return typeof value === 'number' ? value : undefined;
  };

  const addEntry = () => {
    if (!date || !weight) {
      alert('Please enter a date and weight');
      return;
    }
    const parsedWeight = parseFloat(weight);
    const parsedCalories = calories ? parseFloat(calories) : undefined;
    if (!isFinite(parsedWeight) || parsedWeight <= 0) {
      alert('Weight must be greater than 0');
      return;
    }
    if (parsedCalories !== undefined && (!isFinite(parsedCalories) || parsedCalories <= 0)) {
      alert('Calories must be greater than 0');
      return;
    }

    const newEntry: WeightEntry = { date, weight: parsedWeight };
    if (parsedCalories !== undefined) newEntry.calories = parsedCalories;

    // Deduplicate by date (last-write-wins)
    const filtered = entries.filter(e => e.date !== date);
    const newEntries = [...filtered, newEntry];
    setEntries(newEntries.sort((a, b) => a.date.localeCompare(b.date)));
    setDate('');
    setWeight('');
    setCalories('');
  };

  const removeEntry = (index: number) => {
    setEntries((prev: WeightEntry[]) => prev.filter((_: WeightEntry, i: number) => i !== index));
  };

  const weeklyGroups = useMemo(() => {
    const grouped = new Map<string, { data: WeightEntry[]; label: string; startDateMs: number }>();

    entries.forEach((entry: WeightEntry) => {
      const info = getGroupInfo(entry.date, statsGrouping);
      if (!grouped.has(info.key)) {
        grouped.set(info.key, { data: [], label: info.label, startDateMs: info.startDate.getTime() });
      }
      grouped.get(info.key)!.data.push(entry);
    });

    return Array.from(grouped.values())
      .map(group => ({
        weekStart: group.label,
        data: group.data.sort((a, b) => a.date.localeCompare(b.date)),
        startDateMs: group.startDateMs
      }))
      .sort((a, b) => a.startDateMs - b.startDateMs);
  }, [entries, statsGrouping]);

  const entriesForTrend = useMemo(() => filterEntriesByWindow(entries, trendWindow), [entries, trendWindow]);

  function computeMean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function computeSD(arr: number[], mean: number): number {
    const sumSq = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0);
    return Math.sqrt(sumSq / (arr.length - 1));
  }

  function computeCI(mean: number, sd: number, n: number, conf: ConfidenceLevel): [number, number] {
    const z = zScores[conf];
    const se = sd / Math.sqrt(n);
    const margin = z * se;
    return [mean - margin, mean + margin];
  }

  const results = useMemo(() => {
    const res: WeeklyStats[] = [];
    weeklyGroups.forEach(({ weekStart, data, startDateMs }, idx) => {
      const weights = data.map(d => d.weight);
      const mean = computeMean(weights);
      const sd = weights.length > 1 ? computeSD(weights, mean) : 0;
      const ci = weights.length > 1 ? computeCI(mean, sd, weights.length, confidence) : [mean, mean] as [number, number];
      const entry: WeeklyStats = { weekStart, mean, sd, ci, dataLength: weights.length, startDateMs };

      if (idx > 0) {
        const prev = res[idx - 1];
        const gain = mean - prev.mean;
        const se_combined = Math.sqrt(
          (weights.length > 1 ? sd ** 2 / weights.length : 0) +
          (prev.dataLength > 1 ? prev.sd ** 2 / prev.dataLength : 0)
        );
        const z = zScores[confidence];
        const margin = z * se_combined;
        entry.change = gain;
        entry.changeCI = [gain - margin, gain + margin];
      }

      res.push(entry);
    });
    return res;
  }, [weeklyGroups, confidence]);

  const getProgressPercentage = () => {
    if (!goalWeight || !startingWeight || entries.length === 0) return 0;
    const currentWeight = entries[entries.length - 1].weight;
    const start = parseFloat(startingWeight);
    const goal = parseFloat(goalWeight);
    const progress = (currentWeight - start) / (goal - start) * 100;
    return Math.min(Math.max(progress, 0), 100);
  };

  const getChangeColor = (changeCI: [number, number] | undefined) => {
    if (!changeCI) return 'text-gray-900';
    if (changeCI[0] > 0) return 'text-green-600';
    if (changeCI[1] < 0) return 'text-red-600';
    return 'text-gray-900';
  };

  function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
    const n = x.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
    const sumXX = x.reduce((a, b) => a + b * b, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R²
    const yMean = sumY / n;
    const ssTot = y.reduce((a, b) => a + Math.pow(b - yMean, 2), 0);
    const ssRes = y.reduce((a, b, i) => a + Math.pow(b - (slope * x[i] + intercept), 2), 0);
    const r2 = 1 - ssRes / ssTot;

    return { slope, intercept, r2 };
  }

  function calculateCaloricInference(entries: WeightEntry[], conf: ConfidenceLevel): CaloricInference | null {
    if (entries.length < 2) return null;

    // Convert dates to days since first entry
    const firstDate = new Date(entries[0].date);
    const x = entries.map(entry => {
      const days = (new Date(entry.date).getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
      return days;
    });
    const y = entries.map(entry => entry.weight);

    // Perform linear regression
    const { slope, intercept, r2 } = linearRegression(x, y);

    // Calculate standard error of the slope
    const n = x.length;
    const xMean = x.reduce((a, b) => a + b, 0) / n;
    const yMean = y.reduce((a, b) => a + b, 0) / n;
    const ssx = x.reduce((a, b) => a + Math.pow(b - xMean, 2), 0);
    const mse = y.reduce((a, b, i) => a + Math.pow(b - (slope * x[i] + yMean - slope * xMean), 2), 0) / (n - 2);
    const slopeSE = Math.sqrt(mse / ssx);

    // Calculate confidence interval for the slope
    const z = zScores[conf];
    const slopeCI: [number, number] = [
      slope - z * slopeSE,
      slope + z * slopeSE
    ];

    // Convert weight change rate to calories
    const weightChangeRate = slope; // kg per day
    const weightChangeRateCI: [number, number] = [
      slopeCI[0],
      slopeCI[1]
    ];

    // Calculate maintenance calories (assuming current intake is maintenance)
    const avgIntake = getAverageIntake(entries);
    const maintenanceCandidates = avgIntake !== null
      ? [
          avgIntake - weightChangeRateCI[1] * KCAL_PER_KG,
          avgIntake - weightChangeRateCI[0] * KCAL_PER_KG
        ]
      : [
          Math.abs(weightChangeRateCI[0] * KCAL_PER_KG),
          Math.abs(weightChangeRateCI[1] * KCAL_PER_KG)
        ];

    const maintenanceCalories = avgIntake !== null
      ? avgIntake - weightChangeRate * KCAL_PER_KG
      : Math.abs(weightChangeRate * KCAL_PER_KG);
    const maintenanceCaloriesCI: [number, number] = [
      Math.min(...maintenanceCandidates),
      Math.max(...maintenanceCandidates)
    ];

    // Create trend data for visualization
    const trendData = entries.map((entry, i) => {
      const predicted = slope * x[i] + intercept;
      const predictedLow = slopeCI[0] * x[i] + intercept;
      const predictedHigh = slopeCI[1] * x[i] + intercept;
      return {
        date: entry.date,
        weight: entry.weight,
        predicted,
        predictedLow,
        predictedHigh,
        predictedRange: predictedHigh - predictedLow
      };
    });

    return {
      maintenanceCalories,
      confidenceInterval: maintenanceCaloriesCI,
      weightChangeRate,
      weightChangeRateCI,
      slopeCI,
      intercept,
      daysOfData: (Math.max(...x) - Math.min(...x)) + 1,
      r2,
      trendData
    };
  }

  // Helper: Calculate average daily intake (for entries with calories)
  function getAverageIntake(entries: WeightEntry[]): number | null {
    const withCalories = entries.filter(e => typeof e.calories === 'number');
    if (withCalories.length < 2) return null;
    const total = withCalories.reduce((sum, e) => sum + (e.calories || 0), 0);
    return total / withCalories.length;
  }

  // Replace the entire getEmpiricalKcalPerKg function with this mathematically sound version
  function getEmpiricalKcalPerKg(entries: WeightEntry[], weightChangeRate: number): number | null {
    // Delegate to the regression-based helper that uses only weight & calorie data
    const { empirical } = calculateEmpiricalKcalPerKg(entries);
    return empirical || null;
  }

  // Helper: Calculate fat/lean % and CI from empirical kcal/kg and its CI
  function getFatLeanPercent(empKcal: number, empKcalCI: [number, number]) {
    const fatPct = (empKcal - 2000) / (7700 - 2000);
    const fatPctLow = (empKcalCI[0] - 2000) / (7700 - 2000);
    const fatPctHigh = (empKcalCI[1] - 2000) / (7700 - 2000);
    return {
      fatPct: Math.max(0, Math.min(1, fatPct)),
      fatPctLow: Math.max(0, Math.min(1, fatPctLow)),
      fatPctHigh: Math.max(0, Math.min(1, fatPctHigh)),
      leanPct: 1 - Math.max(0, Math.min(1, fatPct)),
      leanPctLow: 1 - Math.max(0, Math.min(1, fatPctHigh)),
      leanPctHigh: 1 - Math.max(0, Math.min(1, fatPctLow)),
    };
  }

  // Helper: Calculate actual kg change for fat and lean mass
  function getFatLeanKgChange(startingWeight: number, currentWeight: number, fatPct: number, fatPctLow: number, fatPctHigh: number) {
    const totalChange = currentWeight - startingWeight;
    const fatKg = totalChange * fatPct;
    const fatKgLow = totalChange * fatPctLow;
    const fatKgHigh = totalChange * fatPctHigh;
    const leanKg = totalChange * (1 - fatPct);
    const leanKgLow = totalChange * (1 - fatPctHigh);
    const leanKgHigh = totalChange * (1 - fatPctLow);
    return {
      totalChange,
      fatKg, fatKgLow, fatKgHigh,
      leanKg, leanKgLow, leanKgHigh
    };
  }

  const addBodyMeasurement = () => {
    if (!measurementDate) {
      alert('Please select a date for the measurements');
      return;
    }
    
    // Create new measurement entry
    const newMeasurement: BodyMeasurement = { date: measurementDate };
    
    // Add body fat if entered
    if (bodyFat) newMeasurement.bodyFat = parseFloat(bodyFat);
    
    // Add each measurement that was entered
    ['neck', 'shoulders', 'chest', 'waist', 'hips', 'biceps', 'forearms', 'thighs', 'calves'].forEach(part => {
      if (measurementInputs[part]) {
        (newMeasurement as any)[part] = parseFloat(measurementInputs[part]);
      }
    });
    
    // Check if at least one measurement was entered
    if (Object.keys(newMeasurement).length <= 1) {
      alert('Please enter at least one measurement');
      return;
    }
    
    // Add to measurements and sort by date
    const newMeasurements = [...measurements, newMeasurement];
    setMeasurements(newMeasurements.sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date)));
    
    // Reset form
    setMeasurementDate('');
    setBodyFat('');
    setMeasurementInputs({});
  };

  const removeMeasurement = (index: number) => {
    setMeasurements((prev: BodyMeasurement[]) => prev.filter((_: BodyMeasurement, i: number) => i !== index));
  };

  /**
   * Calculate body composition estimates for all dates with weight entries
   * This should be called whenever weights, calories, or body fat measurements change
   */
  const calculateBodyComposition = useMemo(() => {
    if (entries.length === 0 || !startingBodyFat) return { estimates: [], newCalibrationFactor: null };
    
    // Sort entries by date
    const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    
    // Get sorted body fat measurements
    const bodyFatMeasurements = measurements
      .filter((m: BodyMeasurement) => typeof m.bodyFat === 'number')
      .sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date));
    
    // Starting values
    const startWeight = sortedEntries[0].weight;
    const startBodyFat = parseFloat(startingBodyFat);
    const startFatMass = startWeight * (startBodyFat / 100);
    const startLeanMass = startWeight - startFatMass;
    
    let currentFatMass = startFatMass;
    let currentLeanMass = startLeanMass;
    let lastKnownFatPercentage = startBodyFat;
    let lastCalibrationDate = sortedEntries[0].date;
    
    // Prepare result array
    const results: BodyCompositionEstimate[] = [];
    
    // Create a copy of current calibration to potentially update
    let newCalibrationFactor = {...calibrationFactor};
    let shouldUpdateCalibration = false;
    
    // Process each weight entry
    for (let i = 0; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i];
      const prevEntry = i > 0 ? sortedEntries[i-1] : null;
      
      // Check if we have an actual body fat measurement for this date
      const actualMeasurement = bodyFatMeasurements.find((m: BodyMeasurement) => m.date === entry.date);
      const hasMeasurement = actualMeasurement && typeof actualMeasurement.bodyFat === 'number';
      
      if (hasMeasurement) {
        // If we have an actual measurement, use it to calibrate
        const actualBodyFat = actualMeasurement.bodyFat as number;
        const actualFatMass = entry.weight * (actualBodyFat / 100);
        const actualLeanMass = entry.weight - actualFatMass;
        
        // Update our current values with the measurement
        currentFatMass = actualFatMass;
        currentLeanMass = actualLeanMass;
        lastKnownFatPercentage = actualBodyFat;
        
        // Add this measurement to our results
        results.push({
          date: entry.date,
          weight: entry.weight,
          bodyFatPercentage: actualBodyFat,
          fatMass: actualFatMass,
          leanMass: actualLeanMass,
          bodyFatPercentageCI: [actualBodyFat - 1, actualBodyFat + 1], // Assume 1% measurement error
          isEstimated: false
        });
        
        // If we have a previous entry, use this measurement to calibrate our factors
        if (prevEntry) {
          const daysBetween = (new Date(entry.date).getTime() - new Date(lastCalibrationDate).getTime()) / (1000 * 60 * 60 * 24);
          
          // Calculate average daily caloric surplus/deficit
          let totalCalories = 0;
          let countDays = 0;
          
          for (let j = 0; j < sortedEntries.length; j++) {
            const e = sortedEntries[j];
            if (e.date >= lastCalibrationDate && e.date <= entry.date && e.calories) {
              totalCalories += e.calories;
              countDays++;
            }
          }
          
          if (countDays > 0) {
            const avgDailyCalories = totalCalories / countDays;
            
            // Get empirical kcal/kg value if available
            const estimatedKcalPerKg = entries.length >= MIN_DAYS_FOR_INFERENCE && getAverageIntake(entries) !== null
              ? getEmpiricalKcalPerKg(entries, calculateCaloricInference(entries, confidence)?.weightChangeRate || 0)
              : null;
            
            // Use the empiricalKcalPerKg if available, otherwise use 7700 as default
            const kcalPerKg = estimatedKcalPerKg || 7700;
            
            // Find our maintenance estimate
            const inference = calculateCaloricInference(
              sortedEntries.filter(e => e.date >= lastCalibrationDate && e.date <= entry.date),
              confidence
            );
            
            if (inference) {
              const maintenanceCalories = getAverageIntake(
                sortedEntries.filter(e => e.date >= lastCalibrationDate && e.date <= entry.date)
              ) as number - inference.weightChangeRate * kcalPerKg;
              
              const avgSurplus = avgDailyCalories - maintenanceCalories;
              const totalSurplus = avgSurplus * daysBetween;
              
              // Theoretical fat gain based on energy balance
              const theoreticalFatChange = totalSurplus / kcalPerKg;
              
              // Actual changes
              const weightChange = entry.weight - sortedEntries.find(e => e.date === lastCalibrationDate)!.weight;
              const fatMassChange = currentFatMass - (results.find(r => r.date === lastCalibrationDate)?.fatMass || startFatMass);
              const leanMassChange = weightChange - fatMassChange;
              
              // Calibrate our factors based on actual vs. theoretical changes
              if (avgSurplus > 0) { // In a surplus
                if (weightChange > 0 && theoreticalFatChange > 0) {
                  // Calculate what percentage of the surplus went to muscle vs fat
                  const newMuscleFactor = Math.max(0, Math.min(0.7, 1 - (fatMassChange / theoreticalFatChange)));
                  // Instead of directly updating state, update our local copy
                  newCalibrationFactor = {
                    ...newCalibrationFactor,
                    date: entry.date,
                    muscleGainFactor: (newCalibrationFactor.muscleGainFactor + newMuscleFactor) / 2 // Average with previous
                  };
                  shouldUpdateCalibration = true;
                }
              } else if (avgSurplus < 0) { // In a deficit
                if (weightChange < 0 && theoreticalFatChange < 0) {
                  // Calculate what percentage of the deficit came from fat vs muscle
                  const newFatLossFactor = Math.max(0.5, Math.min(1.0, fatMassChange / theoreticalFatChange));
                  // Instead of directly updating state, update our local copy
                  newCalibrationFactor = {
                    ...newCalibrationFactor,
                    date: entry.date,
                    fatLossFactor: (newCalibrationFactor.fatLossFactor + newFatLossFactor) / 2 // Average with previous
                  };
                  shouldUpdateCalibration = true;
                }
              }
            }
          }
          
          lastCalibrationDate = entry.date;
        }
      } else if (prevEntry) {
        // Estimate body composition for this entry based on weight change and calories
        const prevEstimate = results[results.length - 1];
        
        const weightChange = entry.weight - prevEntry.weight;
        const daysBetween = (new Date(entry.date).getTime() - new Date(prevEntry.date).getTime()) / (1000 * 60 * 60 * 24);
        
        // If we have calories for both days, use them to estimate composition change
        if (entry.calories && prevEntry.calories) {
          // --- Purely empirical body-comp partition ---------------------------
          // 1. Weight change over the interval
          const weightChange = entry.weight - prevEntry.weight;

          // 2. User-specific kcal per kg (empirical). Fallback to 7700 if not enough data.
          const empiricalRes = calculateEmpiricalKcalPerKg(entries);
          const kcalPerKgUsed = empiricalRes.empirical || 7700;

          // 3. Convert kcal/kg to fat-fraction (0 → all lean, 1 → all fat)
          const { fatPct } = getFatLeanPercent(kcalPerKgUsed, [kcalPerKgUsed, kcalPerKgUsed]);
          const leanPct = 1 - fatPct;

          // 4. Partition the actual scale change
          const fatMassChange  = weightChange * fatPct;
          const leanMassChange = weightChange * leanPct;

          // 5. Update running totals
          currentFatMass  += fatMassChange;
          currentLeanMass += leanMassChange;

          // Minimum physiological safety bounds
          currentFatMass  = Math.max(entry.weight * 0.03, currentFatMass);  // ≥3 % BF
          currentLeanMass = Math.max(entry.weight * 0.5,  currentLeanMass); // ≥50 % lean

          // 6. New BF% and rolling CI (uncertainty widens with time since last true measurement)
          const bodyFatPercentage = (currentFatMass / entry.weight) * 100;
          const daysSinceCalibration = (new Date(entry.date).getTime() - new Date(lastCalibrationDate).getTime()) / (1000 * 60 * 60 * 24);
          const confidenceMargin = 1 + (daysSinceCalibration * 0.05);

          results.push({
            date: entry.date,
            weight: entry.weight,
            bodyFatPercentage,
            fatMass: currentFatMass,
            leanMass: currentLeanMass,
            bodyFatPercentageCI: [
              Math.max(3, bodyFatPercentage - confidenceMargin),
              Math.min(bodyFatPercentage + confidenceMargin, 60)
            ],
            isEstimated: true
          });
        } else {
          // Without calorie data, assume the body fat percentage stays roughly the same
          const bodyFatPercentage = lastKnownFatPercentage;
          const fatMass = entry.weight * (bodyFatPercentage / 100);
          const leanMass = entry.weight - fatMass;
          
          results.push({
            date: entry.date,
            weight: entry.weight,
            bodyFatPercentage,
            fatMass,
            leanMass,
            bodyFatPercentageCI: [bodyFatPercentage - 3, bodyFatPercentage + 3], // Wide CI when we have little info
            isEstimated: true
          });
        }
      } else {
        // First entry - use starting body fat percentage
        results.push({
          date: entry.date,
          weight: entry.weight,
          bodyFatPercentage: startBodyFat,
          fatMass: startFatMass,
          leanMass: startLeanMass,
          bodyFatPercentageCI: [startBodyFat - 1, startBodyFat + 1],
          isEstimated: false
        });
      }
    }
    
    return {
      estimates: results,
      newCalibrationFactor: shouldUpdateCalibration ? newCalibrationFactor : null
    };
    // Note: helper functions here are pure/stable; keeping the dependency list to data/state
    // prevents a render/update loop caused by function identity changing each render.
  }, [entries, measurements, startingBodyFat, calibrationFactor, confidence]);

  // Update this useEffect to separate state updates from calculations
  useEffect(() => {
    const result = calculateBodyComposition;
    if (result.estimates.length > 0) {
      setBodyCompositionHistory(result.estimates);
    }
    
    // Only update calibration if we have a new value
    if (result.newCalibrationFactor) {
      setCalibrationFactor(result.newCalibrationFactor);
    }
  }, [calculateBodyComposition]);

  // Now let's add a function to get the current body composition estimate
  const getCurrentBodyComposition = () => {
    if (bodyCompositionHistory.length === 0) return null;
    
    return bodyCompositionHistory[bodyCompositionHistory.length - 1];
  };

  // Helper: Empirical kcal/kg via regression of weight change vs calories (no BMR/activity assumptions)
  
  // Helper: Empirical kcal/kg via regression of weight change vs calories (no BMR/activity assumptions)
  function calculateEmpiricalKcalPerKg(entries: WeightEntry[]): {
    empirical: number | null;
    maintenance: number | null;
    r2: number | null;
    intervals: number;
  } {
    const pairs: { calories: number; weightRate: number }[] = [];

    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      if (typeof curr.calories !== 'number') continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const next = sorted[j];
        if (typeof next.calories !== 'number') continue;
        const days = (new Date(next.date).getTime() - new Date(curr.date).getTime()) / DAY_MS;
        if (days <= 0) continue;
        const weightRate = (next.weight - curr.weight) / days; // kg per day
        const avgCalories = (curr.calories + next.calories) / 2; // kcal/day
        pairs.push({ calories: avgCalories, weightRate });
      }
    }

    const intervals = pairs.length;
    if (intervals < 3) return { empirical: null, maintenance: null, r2: null, intervals };

    const x = pairs.map(p => p.calories);
    const y = pairs.map(p => p.weightRate);

    const n = x.length;
    const sumX = x.reduce((s, v) => s + v, 0);
    const sumY = y.reduce((s, v) => s + v, 0);
    const sumXY = x.reduce((s, v, idx) => s + v * y[idx], 0);
    const sumXX = x.reduce((s, v) => s + v * v, 0);

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return { empirical: null, maintenance: null, r2: null, intervals };

    const slope = (n * sumXY - sumX * sumY) / denominator; // kg/day per kcal/day
    if (slope === 0) return { empirical: null, maintenance: null, r2: null, intervals };

    const intercept = (sumY - slope * sumX) / n;

    const meanY = sumY / n;
    const ssTot = y.reduce((s, v) => s + (v - meanY) ** 2, 0);
    const ssRes = y.reduce((s, v, idx) => s + (v - (slope * x[idx] + intercept)) ** 2, 0);
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    const empirical = Math.abs(1 / slope);
    const maintenance = -intercept / slope;

    return { empirical, maintenance, r2, intervals };
  }

// Build interval pairs for calories vs weight-rate scatter plot
  const intervalPairs = useMemo(() => {
    const pairs: Array<{ avgCalories: number; weightRate: number; label: string }> = [];
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];
      if (typeof curr.calories !== 'number' || typeof next.calories !== 'number') continue;
      const days = (new Date(next.date).getTime() - new Date(curr.date).getTime()) / (1000 * 60 * 60 * 24);
      if (days <= 0) continue;
      const weightRate = (next.weight - curr.weight) / days;
      const avgCalories = (curr.calories + next.calories) / 2;
      pairs.push({ avgCalories, weightRate, label: `${curr.date} → ${next.date}` });
    }
    return pairs;
  }, [entries]);

  return (
    <div className="p-2 sm:p-4 md:p-6 max-w-4xl mx-auto space-y-6 md:space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Weight logs (last 30d)</p>
          <p className="text-lg font-semibold text-gray-800">{coverage.weightDays}</p>
          <p className="text-xs text-gray-500">More days = tighter trends</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Calorie intervals</p>
          <p className="text-lg font-semibold text-gray-800">{coverage.calorieIntervals}</p>
          <p className="text-xs text-gray-500">Pairs of days with calories for kcal/kg</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Last body-fat entry</p>
          <p className="text-lg font-semibold text-gray-800">
            {coverage.lastBFAge === null ? 'None' : `${coverage.lastBFAge}d ago`}
          </p>
          <p className="text-xs text-gray-500">Take a new BF% to tighten composition</p>
        </div>
      </div>
      <Card className="p-2 sm:p-4 md:p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-2 sm:gap-0">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Weight Goals</h2>
            <Button
              type="button"
              className="bg-green-600 hover:bg-green-700 text-white w-full sm:w-auto"
              onClick={() => {
                if (!window.confirm('This will overwrite all your current entries. Are you sure you want to simulate data?')) return;
                
                // REALISTIC BULKING JOURNEY: 60kg → 75kg over 1.5 years
                
                // Parameters
                const startDate = new Date('2023-01-01');
                const endDate = new Date('2024-07-01'); // 1.5 years later
                const startWeight = 60;
                const goalWeight = 75;
                const startBodyFat = 12; // Starting at 12% body fat
                
                // Phases - realistic bulking journey has different phases
                const phases: SimulationPhase[] = [
                  { 
                    name: 'Initial Bulk', 
                    days: 180, // 6 months
                    weeklyGain: 0.3, // kg per week
                    calorieBase: 2200, // starting maintenance
                    surplus: 400, // calorie surplus
                    calorieVariation: 150, // daily variation
                    weightVariation: 0.3, // weekly random fluctuation
                    bodyfatIncrease: 0.05, // 5% increase in body fat over this phase
                    muscleGainRatio: 0.4  // 40% of weight gain is muscle - makes empirical kcal/kg lower
                  },
                  { 
                    name: 'Mini Cut', 
                    days: 90, // 3 months
                    weeklyGain: -0.3, // kg per week (losing)
                    calorieBase: 2500, // maintenance after initial bulk
                    surplus: -500, // calorie deficit
                    calorieVariation: 100, // less variation during cut
                    weightVariation: 0.2, // less random fluctuation
                    bodyfatIncrease: -0.03, // 3% decrease in body fat
                    muscleLossRatio: 0.15  // 15% of weight loss is muscle - makes empirical kcal/kg higher
                  },
                  { 
                    name: 'Moderate Bulk', 
                    days: 275, // 9 months
                    weeklyGain: 0.25, // kg per week
                    calorieBase: 2450, // maintenance after mini cut
                    surplus: 300, // moderate surplus
                    calorieVariation: 200, // more variation in longer phase
                    weightVariation: 0.4, // more random fluctuation
                    bodyfatIncrease: 0.04, // 4% increase in body fat over this phase
                    muscleGainRatio: 0.35  // 35% of weight gain is muscle
                  }
                ];
                
                // When to take body fat measurements (start plus every 3 months plus end)
                const bodyFatMeasurementMonths = [0, 3, 6, 9, 12, 15, 18];
                
                // Generate entries
                const weightEntries: WeightEntry[] = [];
                const bodyMeasurements: BodyMeasurement[] = [];
                
                let currentDate = new Date(startDate);
                let currentWeight = startWeight;
                let currentBodyFat = startBodyFat;
                let phaseStartDay = 0;
                let phaseIndex = 0;
                let bmrIncreaseFactor = 0; // Track how much BMR has increased due to weight gain
                
                // Helper function to avoid duplicating entries on same day
                const dateExists = (date: string) => weightEntries.some(e => e.date === date);
                
                // Simulate data for each day through the journey
                while (currentDate <= endDate) {
                  // Get current phase
                  const currentPhase = phases[phaseIndex];
                  const daysIntoPhase = Math.floor((currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) - phaseStartDay;
                  
                  // Check if we need to move to next phase
                  if (daysIntoPhase >= currentPhase.days && phaseIndex < phases.length - 1) {
                    phaseStartDay += currentPhase.days;
                    phaseIndex++;
                    continue;
                  }
                  
                  // Calculate weight for this date
                  // 1. Planned progression based on weekly target
                  const daysSinceStart = Math.floor((currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                  const phaseDaysSoFar = daysSinceStart - phaseStartDay;
                  const expectedGain = currentPhase.weeklyGain * (phaseDaysSoFar / 7);
                  
                  // 2. Add reasonable daily weight fluctuation (water, etc)
                  const dailyNoise = ((Math.random() * 2) - 1) * 0.2; // -0.2 to +0.2 kg daily fluctuation
                  
                  // 3. Add weekly pattern (e.g., weight often higher on weekends)
                  const dayOfWeek = currentDate.getDay();
                  const weekendEffect = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.2 : 0;
                  
                  // 4. Calculate phase starting weight (weight at beginning of this phase)
                  let phaseStartWeight = startWeight;
                  for (let i = 0; i < phaseIndex; i++) {
                    phaseStartWeight += phases[i].weeklyGain * (phases[i].days / 7);
                  }
                  
                  // 5. Calculate final weight for this day
                  currentWeight = phaseStartWeight + expectedGain + dailyNoise + weekendEffect;
                  
                  // 6. Add a few weight plateaus (common in real bulking)
                  const plateauEffect = Math.random() > 0.97 ? -0.2 * currentPhase.weeklyGain : 0; // Occasional short plateaus
                  currentWeight += plateauEffect;
                  
                  // Round weight to 1 decimal place for realism
                  currentWeight = Math.round(currentWeight * 10) / 10;
                  
                  // Calculate body fat % progression (linear within each phase)
                  const phaseProgression = phaseDaysSoFar / currentPhase.days;
                  const phaseBFChange = currentPhase.bodyfatIncrease * phaseProgression;
                  
                  // Calculate body fat at start of current phase
                  let phaseStartBF = startBodyFat;
                  for (let i = 0; i < phaseIndex; i++) {
                    phaseStartBF += phases[i].bodyfatIncrease;
                  }
                  
                  currentBodyFat = phaseStartBF + phaseBFChange;
                  
                  // Calculate maintenance calories (increases as weight increases)
                  bmrIncreaseFactor = (currentWeight - startWeight) * 12; // ~12 extra calories per kg gained
                  const maintenanceCalories = currentPhase.calorieBase + bmrIncreaseFactor;
                  
                  // Calculate daily calories with realistic variation
                  const dailyCalorieNoise = ((Math.random() * 2) - 1) * currentPhase.calorieVariation;
                  
                  // Add phase-specific adjustments to make empirical kcal/kg different from 7700
                  let phaseAdjustment = 0;
                  
                  // For bulking phases, make calories a bit higher to account for muscle gain
                  if (currentPhase.weeklyGain > 0 && currentPhase.muscleGainRatio !== undefined) {
                    // The higher the muscle gain ratio, the more calories needed above the theoretical 7700
                    // This simulates the additional calories needed for muscle synthesis
                    const muscleAdjustment = currentPhase.muscleGainRatio * 2000; // Up to 2000 calories more per kg of muscle
                    phaseAdjustment = currentPhase.weeklyGain / 7 * muscleAdjustment;
                  }
                  
                  // For cutting phases, make calories a bit higher to account for metabolic adaptation
                  if (currentPhase.weeklyGain < 0 && currentPhase.muscleLossRatio !== undefined) {
                    // The higher the muscle loss ratio, the fewer calories lost per kg
                    const adaptationAdjustment = currentPhase.muscleLossRatio * 1000;
                    phaseAdjustment = Math.abs(currentPhase.weeklyGain) / 7 * adaptationAdjustment;
                  }
                  
                  const dailyCalories = Math.round(maintenanceCalories + currentPhase.surplus + dailyCalorieNoise + phaseAdjustment);
                  
                  // Only log entries for every 2-3 days (more realistic than daily logging)
                  if (Math.random() > 0.6 && !dateExists(currentDate.toISOString().split('T')[0])) {
                    weightEntries.push({
                      date: currentDate.toISOString().split('T')[0],
                      weight: currentWeight,
                      calories: dailyCalories
                    });
                  }
                  
                  // Add body fat measurement on scheduled months (start + every 3 months + end)
                  const monthsSinceStart = Math.floor((currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.5));
                  if (bodyFatMeasurementMonths.includes(monthsSinceStart) && 
                      !bodyMeasurements.some(m => Math.abs(new Date(m.date).getTime() - currentDate.getTime()) < 15 * 24 * 60 * 60 * 1000)) {
                    // Add slight measurement error for realism
                    const measurementError = ((Math.random() * 2) - 1) * 0.5; // ±0.5%
                    bodyMeasurements.push({
                      date: currentDate.toISOString().split('T')[0],
                      bodyFat: Math.round((currentBodyFat + measurementError) * 10) / 10
                    });
                  }
                  
                  // Move to next day
                  currentDate = new Date(currentDate);
                  currentDate.setDate(currentDate.getDate() + 1);
                }
                
                // Set the data
                setEntries(weightEntries);
                setMeasurements(bodyMeasurements);
                setStartingWeight(startWeight.toString());
                setGoalWeight(goalWeight.toString());
                setStartingBodyFat(startBodyFat.toString());
                setGoalBodyFat('15'); // Goal body fat at end
              }}
              data-testid="simulate-data-button"
            >
              Simulate Data
            </Button>
          </div>
          <div className="flex flex-col md:flex-row gap-2 md:gap-4">
            <Input 
              type="number" 
              step="0.1" 
              placeholder="Starting Weight (kg)" 
              value={startingWeight} 
              onChange={e => setStartingWeight(e.target.value)} 
              className="flex-1"
              data-testid="starting-weight-input"
            />
            <Input 
              type="number" 
              step="0.1" 
              placeholder="Goal Weight (kg)" 
              value={goalWeight} 
              onChange={e => setGoalWeight(e.target.value)} 
              className="flex-1"
              data-testid="goal-weight-input"
            />
          </div>
          {goalWeight && startingWeight && entries.length > 0 && (
            <div className="mt-4">
              <div className="flex justify-between mb-2 text-xs sm:text-sm">
                <span className="text-gray-600">Progress</span>
                <span className="text-gray-600">{getProgressPercentage().toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${getProgressPercentage()}%` }}
                  data-testid="progress-bar"
                ></div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="p-2 sm:p-4 md:p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-5">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Body Goals</h2>
          
          {/* Body Fat Goals */}
          <div className="space-y-2">
            <h3 className="text-lg font-medium text-gray-800 flex items-center gap-2">
              Body Fat
              <a 
                href="https://www.calculator.net/body-fat-calculator.html?ctype=metric&csex=m&cage=25&cweightlbs=152&cheightfeet=5&cheightinch=10.5&cneckfeet=1&cneckinch=7.5&cwaistfeet=3&cwaistinch=1.5&chipfeet=2&chipinch=10.5&cweightkgs=70&cheightmeter=178&cneckmeter=50&cwaistmeter=96&chipmeter=92" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-md hover:bg-blue-200 transition-colors"
              >
                Calculator ↗
              </a>
            </h3>
            <div className="flex flex-col md:flex-row gap-2 md:gap-4">
              <div className="flex-1">
                <label htmlFor="starting-body-fat" className="text-sm text-gray-600 block mb-1">Starting (%)</label>
                <Input 
                  id="starting-body-fat"
                  type="number" 
                  step="0.1" 
                  placeholder="Starting Body Fat (%)" 
                  value={startingBodyFat} 
                  onChange={e => setStartingBodyFat(e.target.value)} 
                  className="w-full"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="goal-body-fat" className="text-sm text-gray-600 block mb-1">Goal (%)</label>
                <Input 
                  id="goal-body-fat"
                  type="number" 
                  step="0.1" 
                  placeholder="Goal Body Fat (%)" 
                  value={goalBodyFat} 
                  onChange={e => setGoalBodyFat(e.target.value)} 
                  className="w-full"
                />
              </div>
            </div>
            
            {/* Body Fat Progress Bar */}
            {goalBodyFat && startingBodyFat && measurements.length > 0 && measurements.some((m: BodyMeasurement) => typeof m.bodyFat === 'number') && (
              <div className="mt-2">
                <div className="flex justify-between mb-1 text-xs sm:text-sm">
                  <span className="text-gray-600">Body Fat Progress</span>
                  <span className="text-gray-600">
                    {(() => {
                      const startBF = parseFloat(startingBodyFat);
                      const goalBF = parseFloat(goalBodyFat);
                      const latestBF = measurements
                        .filter((m: BodyMeasurement) => typeof m.bodyFat === 'number')
                        .sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date))
                        .pop()?.bodyFat;
                      
                      if (typeof latestBF !== 'number') return '0%';
                      
                      // For body fat, often the goal is to reduce, so we need to handle both directions
                      const isReduction = goalBF < startBF;
                      const progress = isReduction
                        ? (startBF - latestBF) / (startBF - goalBF) * 100
                        : (latestBF - startBF) / (goalBF - startBF) * 100;
                      
                      return `${Math.max(0, Math.min(100, progress)).toFixed(1)}%`;
                    })()}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ 
                      width: (() => {
                        const startBF = parseFloat(startingBodyFat);
                        const goalBF = parseFloat(goalBodyFat);
                        const latestBF = measurements
                          .filter((m: BodyMeasurement) => typeof m.bodyFat === 'number')
                          .sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date))
                          .pop()?.bodyFat;
                        
                        if (typeof latestBF !== 'number') return '0%';
                        
                        // For body fat, often the goal is to reduce, so we need to handle both directions
                        const isReduction = goalBF < startBF;
                        const progress = isReduction
                          ? (startBF - latestBF) / (startBF - goalBF) * 100
                          : (latestBF - startBF) / (goalBF - startBF) * 100;
                        
                        return `${Math.max(0, Math.min(100, progress))}%`;
                      })()
                    }}
                  ></div>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Latest: {measurements
                    .filter((m: BodyMeasurement) => typeof m.bodyFat === 'number')
                    .sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date))
                    .pop()?.bodyFat?.toFixed(1)}%
                </div>
              </div>
            )}
          </div>
          
          {/* Body Measurements Goals */}
          <div className="space-y-3">
            <h3 className="text-lg font-medium text-gray-800 flex items-center gap-2">
              Body Measurements (cm)
              <a 
                href="https://bonytobeastly.com/ideal-body-weight-and-muscle-measurement-calculator/" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-md hover:bg-blue-200 transition-colors"
              >
                Ideal Calculator ↗
              </a>
            </h3>
            
            {['Neck', 'Shoulders', 'Chest', 'Waist', 'Hips', 'Biceps', 'Forearms', 'Thighs', 'Calves'].map(part => (
              <div key={part} className="space-y-2 border-b border-gray-100 pb-3 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700 w-20">{part}</span>
                  <div className="flex-1 flex gap-2">
                    <div className="flex-1">
                      <Input 
                        id={`${part.toLowerCase()}-start`}
                        type="number" 
                        step="0.1" 
                        placeholder="Starting"
                        value={bodyMeasurementGoals[`starting${part}`] || ''}
                        onChange={e => {
                          setBodyMeasurementGoals((prev: Record<string, string>) => ({
                            ...prev,
                            [`starting${part}`]: e.target.value
                          }));
                        }}
                        className="w-full"
                      />
                    </div>
                    <div className="flex-1">
                      <Input 
                        type="number" 
                        step="0.1" 
                        placeholder="Goal"
                        value={bodyMeasurementGoals[`goal${part}`] || ''}
                        onChange={e => {
                          setBodyMeasurementGoals((prev: Record<string, string>) => ({
                            ...prev,
                            [`goal${part}`]: e.target.value
                          }));
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
                
                {/* Progress bar for each measurement */}
                {bodyMeasurementGoals[`starting${part}`] && bodyMeasurementGoals[`goal${part}`] && 
                  measurements.length > 0 && measurements.some((m: BodyMeasurement) => typeof m[part.toLowerCase()] === 'number') && (
                    <div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">Progress</span>
                        <span className="text-gray-600">
                          {(() => {
                            const start = parseFloat(bodyMeasurementGoals[`starting${part}`]);
                            const goal = parseFloat(bodyMeasurementGoals[`goal${part}`]);
                            const latest = getLatestMeasurementValue(part);
                            if (typeof latest !== 'number') return '0%';
                            
                            const isReduction = goal < start;
                            const progress = isReduction
                              ? (start - latest) / (start - goal) * 100
                              : (latest - start) / (goal - start) * 100;
                            
                            return `${Math.max(0, Math.min(100, progress)).toFixed(1)}%`;
                          })()}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ 
                            width: (() => {
                              const start = parseFloat(bodyMeasurementGoals[`starting${part}`]);
                              const goal = parseFloat(bodyMeasurementGoals[`goal${part}`]);
                              const latest = getLatestMeasurementValue(part);
                              if (typeof latest !== 'number') return '0%';
                              
                              const isReduction = goal < start;
                              const progress = isReduction
                                ? (start - latest) / (start - goal) * 100
                                : (latest - start) / (goal - start) * 100;
                              
                              return `${Math.max(0, Math.min(100, progress))}%`;
                            })()
                          }}
                        ></div>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {(() => {
                          const latest = getLatestMeasurementValue(part);
                          if (typeof latest !== 'number') {
                            return 'Latest: —';
                          }
                          return `Latest: ${latest.toFixed(1)} cm`;
                        })()}
                      </div>
                    </div>
                  )}
              </div>
            ))}
          </div>
          
          {/* Master Progress Bar */}
          {(
            (startingWeight && goalWeight && entries.length > 0) ||
            (startingBodyFat && goalBodyFat && measurements.some((m: BodyMeasurement) => typeof m.bodyFat === 'number')) ||
            Object.keys(bodyMeasurementGoals).some(key => 
              key.startsWith('starting') && 
              bodyMeasurementGoals[key] && 
              bodyMeasurementGoals[key.replace('starting', 'goal')] &&
              measurements.some((m: BodyMeasurement) => typeof m[key.replace('starting', '').toLowerCase()] === 'number')
            )
          ) && (
            <div className="mt-6 bg-gray-50 p-4 rounded-xl">
              <div className="flex justify-between mb-2 text-sm">
                <span className="font-bold text-gray-800">Overall Progress</span>
                <span className="font-bold text-gray-800">
                  {(() => {
                    let totalProgress = 0;
                    let metricCount = 0;
                    
                    // Weight progress
                    if (startingWeight && goalWeight && entries.length > 0) {
                      const startW = parseFloat(startingWeight);
                      const goalW = parseFloat(goalWeight);
                      const currentW = entries[entries.length - 1].weight;
                      const isReduction = goalW < startW;
                      const progress = isReduction
                        ? (startW - currentW) / (startW - goalW) * 100
                        : (currentW - startW) / (goalW - startW) * 100;
                      totalProgress += Math.max(0, Math.min(100, progress));
                      metricCount++;
                    }
                    
                    // Body fat progress
                    if (startingBodyFat && goalBodyFat && measurements.some((m: BodyMeasurement) => typeof m.bodyFat === 'number')) {
                      const startBF = parseFloat(startingBodyFat);
                      const goalBF = parseFloat(goalBodyFat);
                      const latestBF = measurements
                        .filter((m: BodyMeasurement) => typeof m.bodyFat === 'number')
                        .sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date))
                        .pop()?.bodyFat;
                      
                      if (typeof latestBF === 'number') {
                        const isReduction = goalBF < startBF;
                        const progress = isReduction
                          ? (startBF - latestBF) / (startBF - goalBF) * 100
                          : (latestBF - startBF) / (goalBF - startBF) * 100;
                        totalProgress += Math.max(0, Math.min(100, progress));
                        metricCount++;
                      }
                    }
                    
                    // Body measurements progress
                    ['Neck', 'Shoulders', 'Chest', 'Waist', 'Hips', 'Biceps', 'Forearms', 'Thighs', 'Calves'].forEach(part => {
                      const startKey = `starting${part}`;
                      const goalKey = `goal${part}`;
                      const partLower = part.toLowerCase();
                      
                      if (
                        bodyMeasurementGoals[startKey] && 
                        bodyMeasurementGoals[goalKey] && 
                        measurements.some((m: BodyMeasurement) => typeof m[partLower] === 'number')
                      ) {
                        const start = parseFloat(bodyMeasurementGoals[startKey]);
                        const goal = parseFloat(bodyMeasurementGoals[goalKey]);
                        const latest = measurements
                          .filter((m: BodyMeasurement) => typeof m[partLower] === 'number')
                          .sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date))
                          .pop()?.[partLower];
                        
                        if (typeof latest === 'number') {
                          const isReduction = goal < start;
                          const progress = isReduction
                            ? (start - latest) / (start - goal) * 100
                            : (latest - start) / (goal - start) * 100;
                          totalProgress += Math.max(0, Math.min(100, progress));
                          metricCount++;
                        }
                      }
                    });
                    
                    return metricCount > 0 
                      ? `${(totalProgress / metricCount).toFixed(1)}%` 
                      : '0%';
                  })()}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-4">
                <div 
                  className="bg-green-600 h-4 rounded-full transition-all duration-300"
                  style={{ 
                    width: (() => {
                      let totalProgress = 0;
                      let metricCount = 0;
                      
                      // Weight progress
                      if (startingWeight && goalWeight && entries.length > 0) {
                        const startW = parseFloat(startingWeight);
                        const goalW = parseFloat(goalWeight);
                        const currentW = entries[entries.length - 1].weight;
                        const isReduction = goalW < startW;
                        const progress = isReduction
                          ? (startW - currentW) / (startW - goalW) * 100
                          : (currentW - startW) / (goalW - startW) * 100;
                        totalProgress += Math.max(0, Math.min(100, progress));
                        metricCount++;
                      }
                      
                      // Body fat progress
                      if (startingBodyFat && goalBodyFat && measurements.some((m: BodyMeasurement) => typeof m.bodyFat === 'number')) {
                        const startBF = parseFloat(startingBodyFat);
                        const goalBF = parseFloat(goalBodyFat);
                        const latestBF = measurements
                          .filter((m: BodyMeasurement) => typeof m.bodyFat === 'number')
                          .sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date))
                          .pop()?.bodyFat;
                        
                        if (typeof latestBF === 'number') {
                          const isReduction = goalBF < startBF;
                          const progress = isReduction
                            ? (startBF - latestBF) / (startBF - goalBF) * 100
                            : (latestBF - startBF) / (goalBF - startBF) * 100;
                          totalProgress += Math.max(0, Math.min(100, progress));
                          metricCount++;
                        }
                      }
                      
                      // Body measurements progress
                      ['Neck', 'Shoulders', 'Chest', 'Waist', 'Hips', 'Biceps', 'Forearms', 'Thighs', 'Calves'].forEach(part => {
                        const startKey = `starting${part}`;
                        const goalKey = `goal${part}`;
                        const partLower = part.toLowerCase();
                        
                        if (
                          bodyMeasurementGoals[startKey] && 
                          bodyMeasurementGoals[goalKey] && 
                          measurements.some((m: BodyMeasurement) => typeof m[partLower] === 'number')
                        ) {
                          const start = parseFloat(bodyMeasurementGoals[startKey]);
                          const goal = parseFloat(bodyMeasurementGoals[goalKey]);
                          const latest = measurements
                            .filter((m: BodyMeasurement) => typeof m[partLower] === 'number')
                            .sort((a: BodyMeasurement, b: BodyMeasurement) => a.date.localeCompare(b.date))
                            .pop()?.[partLower];
                          
                          if (typeof latest === 'number') {
                            const isReduction = goal < start;
                            const progress = isReduction
                              ? (start - latest) / (start - goal) * 100
                              : (latest - start) / (goal - start) * 100;
                            totalProgress += Math.max(0, Math.min(100, progress));
                            metricCount++;
                          }
                        }
                      });
                      
                      return metricCount > 0 
                        ? `${Math.max(0, Math.min(100, totalProgress / metricCount))}%` 
                        : '0%';
                    })()
                  }}
                ></div>
              </div>
              <div className="text-xs text-gray-500 mt-1 text-center">
                Combined progress across all measurements
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="p-2 sm:p-4 md:p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Add Weight Entry</h2>
          <div className="flex flex-col md:flex-row gap-2 md:gap-4">
            <div className="flex flex-col flex-1">
              <label htmlFor="date-input" className="mb-1 text-xs sm:text-sm">Date</label>
              <Input 
                id="date-input"
                data-testid="date-input"
                type="date" 
                value={date} 
                onChange={(e) => setDate(e.target.value)} 
                className="flex-1 text-sm sm:text-base"
              />
            </div>
            <div className="flex flex-col flex-1">
              <label htmlFor="weight-input" className="mb-1 text-xs sm:text-sm">Weight (kg)</label>
              <Input 
                id="weight-input"
                data-testid="weight-input"
                type="number" 
                step="0.1" 
                placeholder="Weight (kg)" 
                value={weight} 
                onChange={(e) => setWeight(e.target.value)} 
                className="flex-1 text-sm sm:text-base" 
              />
            </div>
            <div className="flex flex-col flex-1">
              <label htmlFor="calories-input" className="mb-1 text-xs sm:text-sm">Calories Consumed</label>
              <Input 
                id="calories-input"
                data-testid="calories-input"
                type="number" 
                step="1" 
                placeholder="Calories (kcal)" 
                value={calories} 
                onChange={(e) => setCalories(e.target.value)} 
                className="flex-1 text-sm sm:text-base" 
              />
            </div>
            <Button 
              onClick={addEntry} 
              className="bg-blue-600 hover:bg-blue-700 text-white w-full md:w-auto"
              data-testid="add-button"
            >
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="p-2 sm:p-4 md:p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Add Body Measurements</h2>
          <div className="flex flex-col md:flex-row gap-2 md:gap-4 mb-4">
            <div className="flex flex-col flex-1">
              <label htmlFor="measurement-date-input" className="mb-1 text-xs sm:text-sm">Date</label>
              <Input 
                id="measurement-date-input"
                type="date" 
                value={measurementDate} 
                onChange={(e) => setMeasurementDate(e.target.value)} 
                className="flex-1 text-sm sm:text-base"
              />
            </div>
            <div className="flex flex-col flex-1">
              <label htmlFor="body-fat-input" className="mb-1 text-xs sm:text-sm">Body Fat (%)</label>
              <Input 
                id="body-fat-input"
                type="number" 
                step="0.1" 
                placeholder="Body Fat (%)" 
                value={bodyFat || ''}
                onChange={(e) => setBodyFat(e.target.value)} 
                className="flex-1 text-sm sm:text-base" 
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {['Neck', 'Shoulders', 'Chest', 'Waist', 'Hips', 'Biceps', 'Forearms', 'Thighs', 'Calves'].map(part => (
              <div key={part} className="flex flex-col">
                <label htmlFor={`${part.toLowerCase()}-input`} className="mb-1 text-xs sm:text-sm">{part} (cm)</label>
                <Input 
                  id={`${part.toLowerCase()}-input`}
                  type="number" 
                  step="0.1" 
                  placeholder={`${part} (cm)`}
                  value={measurementInputs[part.toLowerCase()] || ''}
                  onChange={(e) => setMeasurementInputs((prev: Record<string, string>) => ({
                    ...prev,
                    [part.toLowerCase()]: e.target.value
                  }))}
                  className="flex-1 text-sm sm:text-base" 
                />
              </div>
            ))}
          </div>
          
          <Button 
            onClick={addBodyMeasurement} 
            className="bg-blue-600 hover:bg-blue-700 text-white w-full md:w-auto mt-4"
          >
            Add Measurements
          </Button>
        </CardContent>
      </Card>

      <Card className="p-2 sm:p-4 md:p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Entries</h2>
          <div className="overflow-x-auto">
            <Table className="min-w-[400px] text-xs sm:text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Weight (kg)</TableHead>
                  <TableHead>Calories</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.slice((entriesPage - 1) * entriesPerPage, entriesPage * entriesPerPage).map((entry: WeightEntry, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{entry.date}</TableCell>
                    <TableCell>{entry.weight}</TableCell>
                    <TableCell>{entry.calories ? entry.calories.toFixed(0) : '-'}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => removeEntry(idx + (entriesPage - 1) * entriesPerPage)} className="w-full">Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Pagination Controls */}
          {entries.length > entriesPerPage && (
            <div className="flex justify-between items-center mt-4">
              <div className="text-sm text-gray-500">
                Showing {Math.min(entries.length, (entriesPage - 1) * entriesPerPage + 1)}-{Math.min(entriesPage * entriesPerPage, entries.length)} of {entries.length} entries
              </div>
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setEntriesPage(p => Math.max(1, p - 1))}
                  disabled={entriesPage === 1}
                >
                  Previous
                </Button>
                <span className="flex items-center px-3 bg-gray-100 rounded">
                  {entriesPage} / {Math.ceil(entries.length / entriesPerPage)}
                </span>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setEntriesPage(p => Math.min(Math.ceil(entries.length / entriesPerPage), p + 1))}
                  disabled={entriesPage >= Math.ceil(entries.length / entriesPerPage)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="p-2 sm:p-4 md:p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Body Measurements</h2>
          <div className="overflow-x-auto">
            <Table className="min-w-[500px] text-xs sm:text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Body Fat (%)</TableHead>
                  <TableHead>Neck</TableHead>
                  <TableHead>Shoulders</TableHead>
                  <TableHead>Chest</TableHead>
                  <TableHead>Waist</TableHead>
                  <TableHead>Hips</TableHead>
                  <TableHead>Biceps</TableHead>
                  <TableHead>Forearms</TableHead>
                  <TableHead>Thighs</TableHead>
                  <TableHead>Calves</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {measurements.slice((measurementsPage - 1) * measurementsPerPage, measurementsPage * measurementsPerPage).map((measurement: BodyMeasurement, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{measurement.date}</TableCell>
                    <TableCell>{measurement.bodyFat?.toFixed(1) || '-'}</TableCell>
                    <TableCell>{measurement.neck?.toFixed(1) || '-'}</TableCell>
                    <TableCell>{measurement.shoulders?.toFixed(1) || '-'}</TableCell>
                    <TableCell>{measurement.chest?.toFixed(1) || '-'}</TableCell>
                    <TableCell>{measurement.waist?.toFixed(1) || '-'}</TableCell>
                    <TableCell>{measurement.hips?.toFixed(1) || '-'}</TableCell>
                    <TableCell>{measurement.biceps?.toFixed(1) || '-'}</TableCell>
                    <TableCell>{measurement.forearms?.toFixed(1) || '-'}</TableCell>
                    <TableCell>{measurement.thighs?.toFixed(1) || '-'}</TableCell>
                    <TableCell>{measurement.calves?.toFixed(1) || '-'}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => removeMeasurement(idx + (measurementsPage - 1) * measurementsPerPage)} className="w-full">Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {/* Pagination Controls for Measurements */}
          {measurements.length > measurementsPerPage && (
            <div className="flex justify-between items-center mt-4">
              <div className="text-sm text-gray-500">
                Showing {Math.min(measurements.length, (measurementsPage - 1) * measurementsPerPage + 1)}-{Math.min(measurementsPage * measurementsPerPage, measurements.length)} of {measurements.length} measurements
              </div>
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setMeasurementsPage(p => Math.max(1, p - 1))}
                  disabled={measurementsPage === 1}
                >
                  Previous
                </Button>
                <span className="flex items-center px-3 bg-gray-100 rounded">
                  {measurementsPage} / {Math.ceil(measurements.length / measurementsPerPage)}
                </span>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setMeasurementsPage(p => Math.min(Math.ceil(measurements.length / measurementsPerPage), p + 1))}
                  disabled={measurementsPage >= Math.ceil(measurements.length / measurementsPerPage)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="p-2 sm:p-4 md:p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Trend Stats</h2>
            <div className="flex flex-wrap gap-2 items-center text-sm">
              <span className="text-gray-600">Group by:</span>
              {(['1w', '2w', '1m', '2m'] as StatsGroupingOption[]).map(option => (
                <Button
                  key={option}
                  size="sm"
                  variant={statsGrouping === option ? 'default' : 'outline'}
                  onClick={() => setStatsGrouping(option)}
                  className="text-xs"
                >
                  {option === '1w' ? '1 wk' : option === '2w' ? '2 wks' : option === '1m' ? '1 mo' : '2 mo'}
                </Button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-[500px] text-xs sm:text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Mean (kg)</TableHead>
                  <TableHead>{(confidence * 100).toFixed(0)}% CI</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>{(confidence * 100).toFixed(0)}% CI Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.slice((statsPage - 1) * statsPerPage, statsPage * statsPerPage).map((r, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{r.weekStart}</TableCell>
                    <TableCell>{r.mean.toFixed(2)}</TableCell>
                    <TableCell>[{r.ci[0].toFixed(2)}, {r.ci[1].toFixed(2)}]</TableCell>
                    <TableCell>{r.change !== undefined ? r.change.toFixed(2) : '-'}</TableCell>
                    <TableCell className={getChangeColor(r.changeCI)}>
                      {r.changeCI ? `[${r.changeCI[0].toFixed(2)}, ${r.changeCI[1].toFixed(2)}]` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {/* Pagination Controls for Weekly Stats */}
          {results.length > statsPerPage && (
            <div className="flex justify-between items-center mt-4">
              <div className="text-sm text-gray-500">
                Showing {Math.min(results.length, (statsPage - 1) * statsPerPage + 1)}-{Math.min(statsPage * statsPerPage, results.length)} of {results.length} periods
              </div>
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setStatsPage(p => Math.max(1, p - 1))}
                  disabled={statsPage === 1}
                >
                  Previous
                </Button>
                <span className="flex items-center px-3 bg-gray-100 rounded">
                  {statsPage} / {Math.ceil(results.length / statsPerPage)}
                </span>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setStatsPage(p => Math.min(Math.ceil(results.length / statsPerPage), p + 1))}
                  disabled={statsPage >= Math.ceil(results.length / statsPerPage)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
          
          <div className="h-48 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={results.map(r => ({
                week: r.weekStart,
                mean: r.mean,
                lower: r.ci[0],
                upper: r.ci[1],
                range: r.ci[1] - r.ci[0]
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip 
                  formatter={(value: number, name: string) => {
                    if (name === 'lower' || name === 'range') return ['', ''] as any;
                    return [`${value.toFixed(2)} kg`, name === 'mean' ? 'Mean' : name];
                  }}
                />
                <Area 
                  type="monotone"
                  dataKey="lower"
                  stackId="statBand"
                  stroke="none"
                  fill="transparent"
                  isAnimationActive={false}
                  activeDot={false}
                />
                <Area 
                  type="monotone"
                  dataKey="range"
                  stackId="statBand"
                  stroke="none"
                  fill="rgba(37, 99, 235, 0.12)"
                  name="CI"
                  isAnimationActive={false}
                  activeDot={false}
                />
                <Line type="monotone" dataKey="mean" stroke="#2563eb" strokeWidth={3} dot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="p-2 sm:p-4 md:p-6 shadow-lg rounded-2xl border border-gray-200">
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Caloric Needs Inference</h2>
            <div className="flex flex-wrap gap-2 items-center text-sm">
              <span className="text-gray-600">Trend window:</span>
              {([14, 30, 60, 'all'] as TrendWindowOption[]).map(option => (
                <Button
                  key={option}
                  size="sm"
                  variant={trendWindow === option ? 'default' : 'outline'}
                  onClick={() => setTrendWindow(option)}
                  className="text-xs"
                >
                  {option === 'all' ? 'All history' : `${option}d`}
                </Button>
              ))}
            </div>
          </div>
          {entriesForTrend.length >= 2 ? (
            (() => {
              const inference = calculateCaloricInference(entriesForTrend, confidence);
              if (!inference || inference.daysOfData < MIN_DAYS_FOR_INFERENCE) {
                return (
                  <div className="text-gray-600">
                    Add at least 2 weight entries to see caloric inference. Need at least {MIN_DAYS_FOR_INFERENCE} days of data to make a reliable inference.
                    Currently have {Math.round(inference?.daysOfData || 0)} days using the selected window.
                  </div>
                );
              }

              // Calculate empirical kcal/kg and show both
              const avgIntake = getAverageIntake(entries);

              // Purely data-driven empirical kcal/kg (no BMR/activity assumptions)
              const { empirical: empiricalKcalPerKg, maintenance: maintenanceEmpirical } = calculateEmpiricalKcalPerKg(entries);

              // Use empirical kcal/kg for surplus/deficit if available, else fall back to 7700
              const kcalPerKgUsed = empiricalKcalPerKg || KCAL_PER_KG;
              const surplusDeficitCalc = inference.weightChangeRate * kcalPerKgUsed; // sign carries direction

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h3 className="text-lg font-medium text-gray-800 mb-2">Weight Change Rate</h3>
                      <p className="text-2xl font-bold text-gray-900">
                        {inference.weightChangeRate.toFixed(3)} kg/day
                      </p>
                      <p className="text-sm text-gray-600">
                        95% CI: [{inference.weightChangeRateCI[0].toFixed(3)}, {inference.weightChangeRateCI[1].toFixed(3)}] kg/day
                      </p>
                      
                      {/* Add user-friendly explanation */}
                      <p className="text-sm text-gray-600 mt-3 border-t border-gray-200 pt-2">
                        {entries.length > 0 && (
                          (() => {
                            const weeklyConst = (Number(inference.weightChangeRate.toFixed(3)) * 7).toFixed(3);
                            return (
                              <>Since {new Date(entries[0].date).toLocaleDateString()}, you have {inference.weightChangeRate > 0 ? 'gained' : 'lost'} {weeklyConst} kg as a constant rate per week.<br /><span className="text-gray-500">(Rate derived from the slope of a best-fit line through your weight readings vs. time.)</span></>
                            );
                          })()
                        )}
                      </p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg self-start max-h-fit h-auto" style={{height: 'auto', maxHeight: 'fit-content'}}>
                      <h3 className="text-lg font-medium text-gray-800 mb-2">kcal per kg (Weight Change)</h3>
                      <p className="text-xl font-bold text-gray-900">Standard: 7700 kcal/kg</p>
                      {empiricalKcalPerKg && (
                        <p className="text-xl font-bold text-green-700">Empirical: {empiricalKcalPerKg.toFixed(0)} kcal/kg</p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        Standard is the physiological average. Empirical is calculated from your own data (if enough calorie entries).
                      </p>
                      
                      {/* More detailed explanation */}
                      <div className="text-sm text-gray-600 mt-3 border-t border-gray-200 pt-2 space-y-2">
                        <p>
                          <span className="font-semibold">Interpreting your number:</span>
                          <ul className="list-disc pl-5 mt-1 space-y-2 text-sm">
                            {/* ───── Close to 7700 */}
                            <li>
                              <span className="italic font-medium">Close&nbsp;to&nbsp;7700&nbsp;kcal/kg&nbsp;(≈&nbsp;6.5–8.5&nbsp;k)</span>
                              <ul className="list-circle pl-4 mt-1 space-y-1">
                                <li>Weight-change energy ≈ chemical energy in fat.</li>
                                <li>Bulking – most of the gain is body-fat <span className="text-xs">(depends on goals)</span>.</li>
                                <li>Cutting – most of the loss is body-fat <span className="text-xs">(ideal)</span>.</li>
                                <li className="text-gray-500">Caveats: logging likely accurate. No immediate action required.</li>
                              </ul>
                            </li>

                            {/* ───── Lower than 7700 */}
                            <li>
                              <span className="italic font-medium">Lower&nbsp;than&nbsp;7700&nbsp;kcal/kg</span>
                              <ul className="list-circle pl-4 mt-1 space-y-1">
                                <li>Bulking – part of the gain is muscle, water, or glycogen (all "cheaper" in kcal).</li>
                                <li className="text-gray-500">Caveats: possible calorie under-reporting or large scale noise.</li>
                                <li>Cutting – dropping kg faster than the deficit alone predicts (water/glycogen dump or muscle loss).</li>
                                <li className="text-gray-500">Caveats: calories may be over-estimated.</li>
                                <li className="font-semibold">Action check:</li>
                                <li className="pl-4 list-disc">
                                  • Bulking – good up to a point; monitor body-fat %.
                                </li>
                                <li className="pl-4 list-disc">
                                  • Cutting – beware muscle loss; moderate deficit, keep protein &amp; training, ensure accurate logging.
                                </li>
                              </ul>
                            </li>

                            {/* ───── Higher than 7700 */}
                            <li>
                              <span className="italic font-medium">Higher&nbsp;than&nbsp;7700&nbsp;kcal/kg</span>
                              <ul className="list-circle pl-4 mt-1 space-y-1">
                                <li>Bulking – much of the surplus is being burned; body is less efficient at adding mass.</li>
                                <li className="text-gray-500">Caveats: calorie over-reporting or hidden water loss can inflate the figure.</li>
                                <li>Cutting – you need a bigger deficit per kg lost (strong fat-biased loss or metabolic adaptation).</li>
                                <li className="text-gray-500">Caveats: could also be calorie under-reporting.</li>
                                <li className="font-semibold">Action check:</li>
                                <li className="pl-4 list-disc">
                                  • Bulking – tighten calorie tracking; if gains are slow &amp; kcal/kg sky-high, reduce surplus and focus on progressive overload.
                                </li>
                                <li className="pl-4 list-disc">
                                  • Cutting – great if strength is stable &amp; body-fat % falling; otherwise re-audit intake/expenditure.
                                </li>
                              </ul>
                            </li>
                          </ul>

                          {/* Sanity reminders */}
                          <div className="mt-3 text-xs space-y-1 text-gray-500">
                            <p><strong>Sanity reminders</strong></p>
                            <ul className="list-disc pl-5 space-y-1">
                              <li>Water &amp; glycogen can swing weight ±1–2&nbsp;kg in days, distorting short spans.</li>
                              <li>Regression needs multiple calorie + weight pairs; sparse data → wide confidence bands.</li>
                              <li>Logging accuracy dominates: scale error, un-weighed food, skipped days, etc.</li>
                              <li>Treat the number as a trend indicator, not an exact thermodynamic truth.</li>
                              <li>Combine it with body-fat %, tape measures &amp; gym performance to judge progress quality.</li>
                            </ul>
                          </div>
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h3 className="text-lg font-medium text-gray-800 mb-2">Inferred Maintenance Calories</h3>
                      <p className="text-xl font-bold text-gray-900">
                        Surplus/Deficit: {Math.round(surplusDeficitCalc)} kcal/day
                      </p>
                      {maintenanceEmpirical && (
                        <p className="text-xl font-bold text-gray-900">
                          Empirical: {Math.round(maintenanceEmpirical)} kcal/day
                        </p>
                      )}
                      
                      {/* Updated, user-friendly explanation */}
                      <div className="text-sm text-gray-600 mt-3 border-t border-gray-200 pt-2 space-y-2">
                        {/* Surplus / Deficit */}
                        <div>
                          <span className="font-semibold">What is "Surplus / Deficit"?</span>
                          <ul className="list-disc pl-5 mt-1 space-y-1">
                            <li>It's the energy gap between what you <em>eat</em> and what you <em>burn</em> each day.</li>
                            <li>Positive → eating above maintenance, weight tends to rise.</li>
                            <li>Negative → eating below maintenance, weight tends to fall.</li>
                          </ul>
                          <span className="text-xs block mt-1">Formula: <code>Weight-Change&nbsp;Rate&nbsp;(kg/day) × {(empiricalKcalPerKg ? empiricalKcalPerKg.toFixed(0) : '7700')}&nbsp;kcal/kg</code></span>
                        </div>

                        {/* Empirical maintenance */}
                        <div>
                          <span className="font-semibold">What is "Empirical Maintenance"?</span>
                          <ul className="list-disc pl-5 mt-1 space-y-1">
                            <li>Your personalised Total Daily Energy Expenditure (TDEE).</li>
                            <li>Derived straight from your own calorie logs &amp; weight trend—no BMR or activity guesses.</li>
                          </ul>
                          <span className="text-xs block mt-1">Formula: <code>Average Calories Logged − Surplus/Deficit</code></span>
                        </div>

                        {/* How to use */}
                        <div>
                          <span className="font-semibold">How to use these numbers</span>
                          <ul className="list-disc pl-5 mt-1 space-y-1">
                            <li>Maintain → eat ~ your Empirical Maintenance.</li>
                            <li>Lose fat → eat 300-500 kcal <em>below</em> it.</li>
                            <li>Gain muscle → eat 300-500 kcal <em>above</em> it.</li>
                          </ul>
                          <p className="mt-1 text-xs">The model updates continuously; as your body weight changes, so does your maintenance.</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h3 className="text-lg font-medium text-gray-800 mb-2">Data Quality</h3>
                      <div className="space-y-2">
                        <div>
                          <p className="text-sm text-gray-600">R² (Fit Quality)</p>
                          <p className="text-xl font-bold text-gray-900">
                            {(inference.r2 * 100).toFixed(1)}%
                          </p>
                          <p className="text-xs text-gray-500">
                            {inference.r2 > 0.7 ? 'Strong trend' : 
                             inference.r2 > 0.4 ? 'Moderate trend' : 
                             'Weak trend'}
                          </p>
                          <p className="text-xs text-gray-600 mt-1">
                            {inference.weightChangeRate > 0.005
                              ? "You're gaining weight overall."
                              : inference.weightChangeRate < -0.005
                                ? "You're losing weight overall."
                                : "Trend is flat/weak right now."}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Calorie coverage</p>
                          <p className="text-xl font-bold text-gray-900">
                            {(() => {
                              const { intervals } = calculateEmpiricalKcalPerKg(entries);
                              return intervals || 0;
                            })()} intervals
                          </p>
                          <p className="text-xs text-gray-500">
                            {(() => {
                              const { intervals } = calculateEmpiricalKcalPerKg(entries);
                              if (intervals >= 6) return 'Good coverage for kcal/kg estimate.';
                              if (intervals >= 3) return 'Fair coverage; expect wider uncertainty.';
                              return 'Low coverage; kcal/kg is a rough guess.';
                            })()}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Days of Data</p>
                          <p className="text-xl font-bold text-gray-900">
                            {Math.round(inference.daysOfData)} days
                          </p>
                        </div>
                      </div>
                      
                      {/* Add user-friendly explanation */}
                      <div className="text-sm text-gray-600 mt-3 border-t border-gray-200 pt-2 space-y-2">
                        <p><span className="font-semibold">What is R²?</span></p>
                        <p>Statistical "goodness-of-fit" from the linear regression between days and weight.</p>

                        <p><span className="font-semibold">Assumptions &amp; Caveats</span></p>
                        <ul className="list-disc pl-5 space-y-1">
                          <li>All the model is saying is this: your weight should respond to what you're eating—because physics.</li>
                          <li>If it doesn't respond, either logging is off or the model's linear assumption is too short-term. Usually it's logging.</li>
                          <li>Large water swings, illness or missed logs add noise and pull R² down.</li>
                          <li>A high R² doesn't prove causation; it only shows the trend is clear.</li>
                        </ul>

                        <p><span className="font-semibold">How to read it</span></p>
                        <ul className="list-disc pl-5 space-y-1">
                          <li>&lt; 50 % – Trend is weak / data noisy. Daily fluctuations dominate.</li>
                          <li>50–70 % – Moderate trend. Keep logging to firm things up.</li>
                          <li>&gt; 70 % – Strong, reliable trend. Confidence bands are tight.</li>
                        </ul>
                        <p className="pl-5 text-xs">More days → better R² and narrower confidence intervals (if logging stays consistent).</p>

                        <p><span className="font-semibold">Why you should care</span></p>
                        <ul className="list-disc pl-5 space-y-1">
                          <li>High R² → kcal/kg and maintenance estimates are trustworthy.</li>
                          <li>Low R² → prioritise consistent weighing &amp; calorie logging before drastic diet changes.</li>
                          <li>Watch R² over time—if it suddenly drops, something in your routine or logging probably changed.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start h-auto">
                    {/* Interpretation card removed */}
                  </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-gray-800 mb-4">Weight Trend Analysis</h3>
                    <div style={{ height: "300px" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={inference.trendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="date" 
                          tickFormatter={(date) => new Date(date).toLocaleDateString()}
                        />
                        <YAxis 
                          domain={[
                            Math.min(...inference.trendData.map(d => d.weight)) - 1,
                            Math.max(...inference.trendData.map(d => d.weight)) + 1
                          ]}
                        />
                        <Tooltip 
                          labelFormatter={(date) => new Date(date).toLocaleDateString()}
                          formatter={(value: number, name: string) => {
                            if (name === 'predictedLow' || name === 'predictedRange') return ['', ''] as any;
                            if (name === 'predicted') return [`${value.toFixed(2)} kg`, 'Trend Line'];
                            return [`${value.toFixed(2)} kg`, 'Actual Weight'];
                          }}
                        />
                        <Area 
                          type="monotone"
                          dataKey="predictedLow"
                          stackId="trendBand"
                          stroke="none"
                          fill="transparent"
                          isAnimationActive={false}
                          activeDot={false}
                        />
                        <Area 
                          type="monotone"
                          dataKey="predictedRange"
                          stackId="trendBand"
                          stroke="none"
                          fill="rgba(16, 185, 129, 0.15)"
                          name="Trend Range"
                          isAnimationActive={false}
                          activeDot={false}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="weight" 
                          stroke="#2563eb" 
                          strokeWidth={2} 
                          dot={{ r: 4 }}
                          name="Actual Weight"
                        />
                        <Line 
                          type="monotone" 
                          dataKey="predicted" 
                          stroke="#10b981" 
                          strokeWidth={2} 
                          strokeDasharray="5 5"
                          dot={false}
                          name="Trend Line"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    </div>
                    <div className="text-sm text-gray-600 mt-2 space-y-1">
                      <p className="font-semibold mb-1">How to read this chart:</p>
                      <p>Blue dots: Your actual weight measurements</p>
                      <p>Green line: The trend line (R<sup>2</sup> = {(inference.r2 * 100).toFixed(1)}%)</p>
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>The line is a simple linear trend fitted through every logged weigh-in.</li>
                        <li>The slope is your average daily weight change: positive&nbsp;=&nbsp;gain, negative&nbsp;=&nbsp;loss.</li>
                        <li>No assumption is made about maintenance—the line just reports what <em>is</em> happening.</li>
                        <li>If the dots hug the line (high&nbsp;R<sup>2</sup>) your logging is consistent; wide scatter means day-to-day noise.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="text-gray-600">
              Add at least 2 weight entries in the selected trend window (or choose All history) to see caloric inference.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Body Composition Analysis Section */}
      {!startingBodyFat && (
        <Card className="p-4 shadow-lg rounded-2xl border border-yellow-200 bg-yellow-50">
          <p className="text-sm text-gray-800 font-semibold">Body composition needs a starting body-fat %.</p>
          <p className="text-xs text-gray-600 mt-1">Add a starting BF% in Body Goals to unlock composition estimates.</p>
        </Card>
      )}
      {startingBodyFat && bodyCompositionHistory.length > 0 && (
        <div className="p-4 bg-gray-50 rounded-lg mt-4">
          <h3 className="text-lg font-medium text-gray-800 mb-4">Body Composition Analysis</h3>
          
          {/* Current Estimate Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="p-4 bg-white rounded-lg shadow-sm">
              <h4 className="text-md font-medium text-gray-700 mb-2">Current Estimates</h4>
              {(() => {
                const current = getCurrentBodyComposition();
                if (!current) return <p>Insufficient data</p>;
                
                return (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Body Fat %:</span>
                      <span className="font-semibold text-gray-800">
                        {current.bodyFatPercentage.toFixed(1)}% 
                        <span className="text-xs text-gray-500 ml-1">
                          (±{((current.bodyFatPercentageCI[1] - current.bodyFatPercentageCI[0])/2).toFixed(1)}%)
                        </span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Fat Mass:</span>
                      <span className="font-semibold text-gray-800">
                        {current.fatMass.toFixed(1)} kg 
                        <span className="text-xs text-gray-500 ml-1">
                          (±{((current.bodyFatPercentageCI[1] - current.bodyFatPercentageCI[0]) * current.weight / 200).toFixed(1)} kg)
                        </span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Lean Mass:</span>
                      <span className="font-semibold text-gray-800">
                        {current.leanMass.toFixed(1)} kg
                        <span className="text-xs text-gray-500 ml-1">
                          (±{((current.bodyFatPercentageCI[1] - current.bodyFatPercentageCI[0]) * current.weight / 200).toFixed(1)} kg)
                        </span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Last Measured:</span>
                      <span className="font-semibold text-gray-800">
                        {measurements
                          .filter((m: BodyMeasurement) => typeof m.bodyFat === 'number')
                          .sort((a: BodyMeasurement, b: BodyMeasurement) => b.date.localeCompare(a.date))
                          .slice(0, 1)
                          .map((m: BodyMeasurement) => `${m.date} (${m.bodyFat}%)`)
                          .join('') || 'Never'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      {current.isEstimated 
                        ? "This is an algorithmic estimate based on your weight, calorie, and the occasional body fat measurement data (though the more frequent the better)."
                        : "This is based on your actual measurement."}
                    </div>
                    <p className="text-sm text-gray-600 mt-3 border-t border-gray-200 pt-2">
                      Your current body composition, showing both fat mass and lean mass (muscle, water, bones). The ± value indicates the confidence range of the estimate.
                    </p>
                  </div>
                );
              })()}
            </div>
            
            <div className="p-4 bg-white rounded-lg shadow-sm">
              <h4 className="text-md font-medium text-gray-700 mb-2">Changes Since Start</h4>
              {(() => {
                const current = getCurrentBodyComposition();
                if (!current || bodyCompositionHistory.length < 2) return <p>Insufficient data</p>;
                
                const first = bodyCompositionHistory[0];
                const fatMassChange = current.fatMass - first.fatMass;
                const leanMassChange = current.leanMass - first.leanMass;
                const weightChange = current.weight - first.weight;
                
                // Calculate proportions
                const fatChangePct = weightChange !== 0 ? (fatMassChange / weightChange) * 100 : 0;
                const leanChangePct = weightChange !== 0 ? (leanMassChange / weightChange) * 100 : 0;
                
                return (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Weight Change:</span>
                      <span className={`font-semibold ${weightChange > 0 ? 'text-green-600' : weightChange < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                        {weightChange > 0 ? '+' : ''}{weightChange.toFixed(1)} kg
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Fat Mass Change:</span>
                      <span className={`font-semibold ${fatMassChange > 0 ? 'text-red-600' : fatMassChange < 0 ? 'text-green-600' : 'text-gray-800'}`}>
                        {fatMassChange > 0 ? '+' : ''}{fatMassChange.toFixed(1)} kg
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Lean Mass Change:</span>
                      <span className={`font-semibold ${leanMassChange > 0 ? 'text-green-600' : leanMassChange < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                        {leanMassChange > 0 ? '+' : ''}{leanMassChange.toFixed(1)} kg
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Composition of Change:</span>
                      <span className="font-semibold text-gray-800">
                        {weightChange !== 0 
                          ? `${Math.abs(fatChangePct).toFixed(1)}% fat, ${Math.abs(leanChangePct).toFixed(1)}% lean` 
                          : 'No change'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      {calibrationFactor.date !== bodyCompositionHistory[0].date 
                        ? `Your body composition model was last calibrated on ${calibrationFactor.date}.`
                        : "Your body composition model has not been calibrated with measurements yet."}
                    </div>
                    <p className="text-sm text-gray-600 mt-3 border-t border-gray-200 pt-2 space-y-2">
                      <p>Shows how your body has changed since you first started tracking.</p>
                      <ul className="list-disc pl-5">
                        <li><strong>Fat percentage</strong> means that of your total weight change, this percentage is estimated to be fat tissue.</li>
                        <li><strong>Lean percentage</strong> means the remaining percentage is estimated to be muscle, water, bone, etc.</li>
                      </ul>
                      <p className="mt-1"><strong>What's ideal?</strong></p>
                      <ul className="list-disc pl-5">
                        <li>When <u>gaining weight</u>: Higher lean % is better (more muscle, less fat).</li>
                        <li>When <u>losing weight</u>: Higher fat % is better (preserving muscle while losing fat).</li>
                      </ul>
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
          
          {/* Body Composition Chart */}
          <div className="h-64 bg-white rounded-lg shadow-sm p-4 mb-4">
            <h4 className="text-md font-medium text-gray-700 mb-2">Body Composition Over Time</h4>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={bodyCompositionHistory.map(item => ({
                ...item,
                bfLow: item.bodyFatPercentageCI[0],
                bfRange: item.bodyFatPercentageCI[1] - item.bodyFatPercentageCI[0]
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(date) => new Date(date).toLocaleDateString()}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip 
                  labelFormatter={(date) => new Date(date).toLocaleDateString()}
                  formatter={(value: number, name: string) => {
                    if (name === 'bfLow' || name === 'bfRange') return ['', ''] as any;
                    return [
                      `${value.toFixed(1)}%`,
                      name === 'bodyFatPercentage' ? 'Body Fat %' : name
                    ];
                  }}
                />
                <Area 
                  type="monotone"
                  dataKey="bfLow"
                  stackId="bfBand"
                  stroke="none"
                  fill="transparent"
                  isAnimationActive={false}
                  activeDot={false}
                />
                <Area 
                  type="monotone"
                  dataKey="bfRange"
                  stackId="bfBand"
                  stroke="none"
                  fill="rgba(239, 68, 68, 0.12)"
                  name="CI Band"
                  isAnimationActive={false}
                  activeDot={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="bodyFatPercentage" 
                  stroke="#ef4444" 
                  strokeWidth={2} 
                  dot={{ r: 3 }}
                  name="Body Fat %"
                  connectNulls
                />
                {goalBodyFat && (
                  <ReferenceLine 
                    y={parseFloat(goalBodyFat)} 
                    stroke="#10b981" 
                    strokeDasharray="3 3" 
                    label={{ value: 'Goal', position: 'insideTopRight' }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
            
            {/* Add simple chart explanation */}
            <p className="text-sm text-gray-600 mt-3 border-t border-gray-200 pt-2">
              This chart shows your body fat percentage over time (red line) and your goal (green dashed line).
            </p>
          </div>
          
          {/* Explanation and Methodology */}
          <div className="text-sm text-gray-600 mt-4 p-4 bg-white rounded-lg shadow-sm">
            <h4 className="text-md font-medium text-gray-700 mb-2">How This Works</h4>
            
            <div className="space-y-3">
              <div className="space-y-4">
                <p>
                  The model is 100 % data-driven. It relies only on what you log: weights, calories, and the occasional body-fat check-in.
                </p>

                <h5 className="font-semibold">Between body-fat measurements</h5>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Your calorie ↔ weight trend gives a personal <code className="font-mono">kcal&nbsp;/&nbsp;kg</code>.</li>
                  <li>2000 kcal/kg ≈ all lean tissue, 7700 kcal/kg ≈ all fat tissue.</li>
                  <li>Each scale change is split fat-vs-lean using that ratio, and BF % is updated.</li>
                </ul>

                <h5 className="font-semibold pt-2">When you log a body-fat measurement</h5>
                <p className="pl-2">
                  The curve snaps to the measured value (the vertical step) and starts a new empirical run from that anchor.
                </p>

                <h5 className="font-semibold pt-2">How to read the slope</h5>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Flat / gentle rise with weight gain → mostly lean tissue.</li>
                  <li>Steep rise with stable weight → hidden fat gain (water loss masking the scale).</li>
                  <li>Lower personal <code className="font-mono">kcal/kg</code> = more muscle-efficient surplus.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 
