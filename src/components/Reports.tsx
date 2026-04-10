import { useState, useEffect, useCallback } from 'react';
import {
  Download, FileText, Calendar, Filter, TrendingUp, Bus, Users,
  DollarSign, Loader2, RefreshCw, Clock, AlertCircle, BarChart2,
  ArrowUpRight, ArrowDownRight, Minus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Trip {
  id: string;
  busId: string;
  busPlateNumber: string;
  driver: string;
  route: string;
  startTime: string;
  endTime?: string;
  status: 'ongoing' | 'completed';
  passengersBoarded: number;
  totalFare: number;
}

interface BusPerformance {
  plate: string;
  trips: number;
  passengers: number;
  revenue: number;
  avgDuration: number;
}

interface PeriodStats {
  totalTrips: number;
  totalPassengers: number;
  totalRevenue: number;
  avgTripDuration: number;
  busUtilization: number;
  peakHours: string[];
  avgPassengersPerTrip: number;
}

interface TrendPoint {
  label: string;
  trips: number;
  passengers: number;
  revenue: number;
}

interface CustomRange {
  start: string;
  end: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDateRangeForType(
  type: 'daily' | 'weekly' | 'monthly' | 'custom',
  customRange: CustomRange
): { startDate: Date; endDate: Date } {
  const now = new Date();

  if (type === 'daily') {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { startDate: s, endDate: e };
  }
  if (type === 'weekly') {
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    const s = new Date(now); s.setDate(now.getDate() - 6); s.setHours(0, 0, 0, 0);
    return { startDate: s, endDate: e };
  }
  if (type === 'monthly') {
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    const s = new Date(now); s.setDate(now.getDate() - 29); s.setHours(0, 0, 0, 0);
    return { startDate: s, endDate: e };
  }
  // custom
  const s = new Date(customRange.start); s.setHours(0, 0, 0, 0);
  const e = new Date(customRange.end);   e.setHours(23, 59, 59, 999);
  return { startDate: s, endDate: e };
}

function getPreviousPeriodRange(
  startDate: Date,
  endDate: Date
): { prevStart: Date; prevEnd: Date } {
  const duration = endDate.getTime() - startDate.getTime();
  return {
    prevStart: new Date(startDate.getTime() - duration - 1),
    prevEnd:   new Date(startDate.getTime() - 1),
  };
}

function filterTrips(trips: Trip[], start: Date, end: Date): Trip[] {
  return trips.filter(t => {
    const d = new Date(t.startTime);
    return d >= start && d <= end;
  });
}

function calcStats(trips: Trip[]): PeriodStats {
  const completed = trips.filter(t => t.status === 'completed');
  const totalTrips = completed.length;
  const totalPassengers = completed.reduce((s, t) => s + (t.passengersBoarded || 0), 0);
  const totalRevenue = completed.reduce((s, t) => s + (t.totalFare || 0), 0);

  let durationSum = 0, durationCount = 0;
  completed.forEach(t => {
    if (t.endTime && t.startTime) {
      durationSum += (new Date(t.endTime).getTime() - new Date(t.startTime).getTime()) / 60000;
      durationCount++;
    }
  });
  const avgTripDuration = durationCount > 0 ? Math.round(durationSum / durationCount) : 0;

  const uniqueBuses = new Set(completed.map(t => t.busId)).size;
  const busUtilization = uniqueBuses > 0 ? Math.min(100, Math.round((totalTrips / (uniqueBuses * 12)) * 100)) : 0;

  const hourCounts: Record<string, number> = {};
  completed.forEach(t => {
    const h = new Date(t.startTime).getHours();
    const key = `${h}:00 - ${h + 1}:00`;
    hourCounts[key] = (hourCounts[key] || 0) + 1;
  });
  const peakHours = Object.entries(hourCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([h]) => h);

  const avgPassengersPerTrip = totalTrips > 0 ? +(totalPassengers / totalTrips).toFixed(1) : 0;

  return { totalTrips, totalPassengers, totalRevenue, avgTripDuration, busUtilization, peakHours, avgPassengersPerTrip };
}

function buildTrendPoints(
  trips: Trip[],
  start: Date,
  end: Date,
  type: 'daily' | 'weekly' | 'monthly' | 'custom'
): TrendPoint[] {
  const completed = trips.filter(t => t.status === 'completed');

  if (type === 'daily') {
    // By hour
    const hours: Record<number, TrendPoint> = {};
    for (let h = 0; h < 24; h++) {
      hours[h] = { label: `${h}:00`, trips: 0, passengers: 0, revenue: 0 };
    }
    completed.forEach(t => {
      const h = new Date(t.startTime).getHours();
      hours[h].trips++;
      hours[h].passengers += t.passengersBoarded || 0;
      hours[h].revenue += t.totalFare || 0;
    });
    return Object.values(hours);
  }

  // By day
  const days: Record<string, TrendPoint> = {};
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = cursor.toISOString().split('T')[0];
    const label = cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    days[key] = { label, trips: 0, passengers: 0, revenue: 0 };
    cursor.setDate(cursor.getDate() + 1);
  }
  completed.forEach(t => {
    const key = new Date(t.startTime).toISOString().split('T')[0];
    if (days[key]) {
      days[key].trips++;
      days[key].passengers += t.passengersBoarded || 0;
      days[key].revenue += t.totalFare || 0;
    }
  });
  return Object.values(days);
}

function pct(value: number, prev: number): { delta: number; dir: 'up' | 'down' | 'same' } {
  if (prev === 0 && value === 0) return { delta: 0, dir: 'same' };
  if (prev === 0) return { delta: 100, dir: 'up' };
  const delta = Math.round(((value - prev) / prev) * 100);
  return { delta: Math.abs(delta), dir: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same' };
}

function DeltaBadge({ value, prev }: { value: number; prev: number }) {
  const { delta, dir } = pct(value, prev);
  if (dir === 'same') return <span className="text-xs text-gray-400 flex items-center gap-0.5"><Minus className="w-3 h-3" />0%</span>;
  const color = dir === 'up' ? 'text-emerald-600' : 'text-red-500';
  const Icon = dir === 'up' ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`text-xs font-medium flex items-center gap-0.5 ${color}`}>
      <Icon className="w-3 h-3" />{delta}%
    </span>
  );
}

function SkeletonLine({ w = 'w-full' }: { w?: string }) {
  return <div className={`h-4 bg-gray-200 rounded animate-pulse ${w}`} />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Reports() {
  const [selectedReport, setSelectedReport] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('daily');
  const [customRange, setCustomRange] = useState<CustomRange>({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end:   new Date().toISOString().split('T')[0],
  });
  const [trendMetric, setTrendMetric] = useState<'trips' | 'passengers' | 'revenue'>('revenue');

  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const [allTrips,       setAllTrips]       = useState<Trip[]>([]);
  const [currentTrips,   setCurrentTrips]   = useState<Trip[]>([]);
  const [currentStats,   setCurrentStats]   = useState<PeriodStats | null>(null);
  const [prevStats,      setPrevStats]      = useState<PeriodStats | null>(null);
  const [busPerformance, setBusPerformance] = useState<BusPerformance[]>([]);
  const [trendPoints,    setTrendPoints]    = useState<TrendPoint[]>([]);
  const [dateLabel,      setDateLabel]      = useState('');

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-4f5edd33/trips`,
        { headers: { Authorization: `Bearer ${publicAnonKey}` } }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load trips');
      setAllTrips(json.data || []);
    } catch (e: any) {
      console.error('Error fetching trips for reports:', e);
      setError(e.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Re-calculate whenever allTrips, reportType or customRange change ───────

  useEffect(() => {
    if (!allTrips.length && !loading) {
      setCurrentStats(calcStats([]));
      setPrevStats(calcStats([]));
      setBusPerformance([]);
      setTrendPoints([]);
      return;
    }
    if (!allTrips.length) return;

    const { startDate, endDate } = getDateRangeForType(selectedReport, customRange);
    const { prevStart, prevEnd } = getPreviousPeriodRange(startDate, endDate);

    const cur  = filterTrips(allTrips, startDate, endDate);
    const prev = filterTrips(allTrips, prevStart, prevEnd);

    setCurrentTrips(cur);
    setCurrentStats(calcStats(cur));
    setPrevStats(calcStats(prev));

    // Bus performance
    const busList: Record<string, BusPerformance> = {};
    cur.filter(t => t.status === 'completed').forEach(t => {
      const plate = t.busPlateNumber || t.busId;
      if (!busList[plate]) busList[plate] = { plate, trips: 0, passengers: 0, revenue: 0, avgDuration: 0 };
      busList[plate].trips++;
      busList[plate].passengers += t.passengersBoarded || 0;
      busList[plate].revenue    += t.totalFare || 0;
      if (t.endTime && t.startTime) {
        busList[plate].avgDuration += (new Date(t.endTime).getTime() - new Date(t.startTime).getTime()) / 60000;
      }
    });
    Object.values(busList).forEach(b => {
      b.avgDuration = b.trips > 0 ? Math.round(b.avgDuration / b.trips) : 0;
    });
    setBusPerformance(Object.values(busList).sort((a, b) => b.revenue - a.revenue));

    // Trend
    setTrendPoints(buildTrendPoints(cur, startDate, endDate, selectedReport));

    // Date label
    const fmt = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    if (selectedReport === 'daily')   setDateLabel(`Today, ${fmt(startDate)}`);
    else if (selectedReport === 'weekly')  setDateLabel(`${fmt(startDate)} – ${fmt(endDate)}`);
    else if (selectedReport === 'monthly') setDateLabel(`${fmt(startDate)} – ${fmt(endDate)}`);
    else setDateLabel(`${fmt(startDate)} – ${fmt(endDate)}`);
  }, [allTrips, selectedReport, customRange, loading]);

  // ── Download helpers ───────────────────────────────────────────────────────

  const downloadCSV = () => {
    if (!currentStats) return;
    let csv = `"Transportation Management System - ${selectedReport.charAt(0).toUpperCase() + selectedReport.slice(1)} Report"\n`;
    csv += `"Period: ${dateLabel}"\n\n`;
    csv += '"SUMMARY"\n"Metric","Value"\n';
    csv += `"Total Trips","${currentStats.totalTrips}"\n`;
    csv += `"Total Passengers","${currentStats.totalPassengers}"\n`;
    csv += `"Total Revenue","₱${currentStats.totalRevenue.toLocaleString()}"\n`;
    csv += `"Avg Trip Duration","${currentStats.avgTripDuration} min"\n`;
    csv += `"Fleet Utilization","${currentStats.busUtilization}%"\n`;
    csv += `"Peak Hours","${currentStats.peakHours.join(' | ')}"\n\n`;
    csv += '"BUS PERFORMANCE"\n"Plate","Trips","Passengers","Revenue","Avg Duration"\n';
    busPerformance.forEach(b => {
      csv += `"${b.plate}","${b.trips}","${b.passengers}","₱${b.revenue.toLocaleString()}","${b.avgDuration} min"\n`;
    });
    csv += '\n"TRIP DETAILS"\n"ID","Bus","Route","Driver","Start","End","Passengers","Fare","Status"\n';
    currentTrips.forEach(t => {
      csv += `"${t.id}","${t.busPlateNumber || t.busId}","${t.route || ''}","${t.driver || ''}","${t.startTime}","${t.endTime || ''}","${t.passengersBoarded}","₱${(t.totalFare || 0).toLocaleString()}","${t.status}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `transport_report_${selectedReport}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPDF = () => {
    if (!currentStats) return;
    const doc = new jsPDF();

    doc.setFontSize(18); doc.setTextColor(79, 70, 229);
    doc.text('Transportation Management System', 14, 18);
    doc.setFontSize(13); doc.setTextColor(30, 30, 30);
    doc.text(`${selectedReport.charAt(0).toUpperCase() + selectedReport.slice(1)} Report`, 14, 27);
    doc.setFontSize(9); doc.setTextColor(120, 120, 120);
    doc.text(`Period: ${dateLabel}`, 14, 34);
    doc.text(`Generated: ${new Date().toLocaleString('en-PH')}`, 14, 40);

    autoTable(doc, {
      startY: 48,
      head:   [['Metric', 'Current Period', 'Previous Period', 'Change']],
      body:   [
        ['Total Trips',       currentStats.totalTrips.toString(),       prevStats?.totalTrips.toString() ?? '—',       prevStats ? `${pct(currentStats.totalTrips, prevStats.totalTrips).dir === 'up' ? '+' : prevStats.totalTrips === 0 ? '' : '-'}${pct(currentStats.totalTrips, prevStats.totalTrips).delta}%` : '—'],
        ['Total Passengers',  currentStats.totalPassengers.toString(),  prevStats?.totalPassengers.toString() ?? '—',  prevStats ? `${pct(currentStats.totalPassengers, prevStats.totalPassengers).dir === 'up' ? '+' : '-'}${pct(currentStats.totalPassengers, prevStats.totalPassengers).delta}%` : '—'],
        ['Total Revenue',     `₱${currentStats.totalRevenue.toLocaleString()}`, prevStats ? `₱${prevStats.totalRevenue.toLocaleString()}` : '—', prevStats ? `${pct(currentStats.totalRevenue, prevStats.totalRevenue).dir === 'up' ? '+' : '-'}${pct(currentStats.totalRevenue, prevStats.totalRevenue).delta}%` : '—'],
        ['Avg Trip Duration', `${currentStats.avgTripDuration} min`,    prevStats ? `${prevStats.avgTripDuration} min` : '—', '—'],
        ['Fleet Utilization', `${currentStats.busUtilization}%`,        prevStats ? `${prevStats.busUtilization}%` : '—', '—'],
        ['Peak Hours',        currentStats.peakHours.join(', ') || '—', '—', '—'],
      ],
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229] },
      margin: { left: 14 },
    });

    const y1 = (doc as any).lastAutoTable.finalY + 12;
    doc.setFontSize(12); doc.setTextColor(30, 30, 30);
    doc.text('Bus Performance', 14, y1);

    autoTable(doc, {
      startY: y1 + 5,
      head:   [['Bus Plate', 'Trips', 'Passengers', 'Revenue', 'Avg Duration']],
      body:   busPerformance.map(b => [b.plate, b.trips.toString(), b.passengers.toString(), `₱${b.revenue.toLocaleString()}`, `${b.avgDuration} min`]),
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229] },
      margin: { left: 14 },
    });

    if (currentTrips.length > 0) {
      const y2 = (doc as any).lastAutoTable.finalY + 12;
      doc.setFontSize(12); doc.setTextColor(30, 30, 30);
      doc.text('Trip Details', 14, y2);
      autoTable(doc, {
        startY: y2 + 5,
        head:   [['Bus', 'Route', 'Driver', 'Start Time', 'PAX', 'Revenue', 'Status']],
        body:   currentTrips.map(t => [
          t.busPlateNumber || t.busId,
          t.route || '—',
          t.driver || '—',
          new Date(t.startTime).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          (t.passengersBoarded || 0).toString(),
          `₱${(t.totalFare || 0).toLocaleString()}`,
          t.status,
        ]),
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        margin: { left: 14 },
      });
    }

    const pages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pages}  |  Transportation Management System`, 14, doc.internal.pageSize.height - 8);
    }
    doc.save(`transport_report_${selectedReport}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // ── UI Constants ──────────────────────────────────────────────────────────

  const reportTypes = [
    { id: 'daily'   as const, label: 'Daily',   sub: 'Today',         icon: Calendar   },
    { id: 'weekly'  as const, label: 'Weekly',  sub: 'Last 7 days',   icon: TrendingUp },
    { id: 'monthly' as const, label: 'Monthly', sub: 'Last 30 days',  icon: FileText   },
    { id: 'custom'  as const, label: 'Custom',  sub: 'Pick a range',  icon: Filter     },
  ];

  const trendMetrics = [
    { id: 'revenue'    as const, label: 'Revenue',    color: '#6366f1', fmt: (v: number) => `₱${v.toLocaleString()}` },
    { id: 'passengers' as const, label: 'Passengers', color: '#0ea5e9', fmt: (v: number) => v.toString() },
    { id: 'trips'      as const, label: 'Trips',      color: '#10b981', fmt: (v: number) => v.toString() },
  ];

  const activeTrendMeta = trendMetrics.find(m => m.id === trendMetric)!;

  // The loading skeleton card
  const StatSkeleton = () => (
    <div className="bg-white/10 backdrop-blur-xl rounded-xl p-4 space-y-3">
      <div className="w-8 h-8 bg-white/20 rounded-lg animate-pulse" />
      <div className="h-8 w-24 bg-white/20 rounded animate-pulse" />
      <div className="h-3 w-16 bg-white/20 rounded animate-pulse" />
    </div>
  );

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-gray-900 mb-1">Reports & Analytics</h2>
            <p className="text-gray-500 text-sm">Real-time data from the fleet database</p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 shadow-sm transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </motion.div>

        {/* ── Error Banner ────────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">{error}</p>
              <button onClick={fetchData} className="ml-auto text-xs underline">Retry</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Report Type Selector ─────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-gray-800 text-sm font-semibold uppercase tracking-wider mb-4">Report Type</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {reportTypes.map(type => {
              const Icon = type.icon;
              const active = selectedReport === type.id;
              return (
                <button key={type.id} onClick={() => setSelectedReport(type.id)}
                  className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                    active
                      ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                  }`}>
                  <Icon className={`w-6 h-6 mb-2 ${active ? 'text-indigo-600' : 'text-gray-400'}`} />
                  <p className={`font-semibold text-sm ${active ? 'text-indigo-700' : 'text-gray-700'}`}>{type.label}</p>
                  <p className={`text-xs mt-0.5 ${active ? 'text-indigo-500' : 'text-gray-400'}`}>{type.sub}</p>
                  {active && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-indigo-500" />}
                </button>
              );
            })}
          </div>

          {/* Custom date range inputs */}
          <AnimatePresence>
            {selectedReport === 'custom' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mt-4">
                <div className="flex flex-wrap gap-4 p-4 bg-indigo-50 rounded-xl border border-indigo-200">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">From:</label>
                    <input
                      type="date"
                      value={customRange.start}
                      max={customRange.end}
                      onChange={e => setCustomRange(r => ({ ...r, start: e.target.value }))}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">To:</label>
                    <input
                      type="date"
                      value={customRange.end}
                      min={customRange.start}
                      max={new Date().toISOString().split('T')[0]}
                      onChange={e => setCustomRange(r => ({ ...r, end: e.target.value }))}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Summary Cards ─────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-blue-700 text-white rounded-2xl p-6 shadow-xl">

          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h3 className="text-white font-bold text-lg">Report Summary</h3>
              {loading
                ? <div className="h-4 w-40 bg-white/20 rounded animate-pulse mt-1" />
                : <p className="text-indigo-200 text-sm mt-0.5">{dateLabel}</p>
              }
            </div>
            <div className="flex gap-2">
              <button onClick={downloadPDF} disabled={loading || !currentStats}
                className="px-3 py-1.5 bg-white/15 backdrop-blur rounded-lg hover:bg-white/25 transition-colors flex items-center gap-1.5 text-sm disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
              <button onClick={downloadCSV} disabled={loading || !currentStats}
                className="px-3 py-1.5 bg-white/15 backdrop-blur rounded-lg hover:bg-white/25 transition-colors flex items-center gap-1.5 text-sm disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {loading ? (
              <><StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton /></>
            ) : (
              <>
                {/* Trips */}
                <div className="bg-white/10 backdrop-blur-xl rounded-xl p-4">
                  <Bus className="w-7 h-7 mb-2 text-indigo-200" />
                  <div className="text-3xl font-bold mb-0.5">{currentStats?.totalTrips ?? 0}</div>
                  <div className="text-indigo-200 text-xs">Completed Trips</div>
                  {prevStats && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <DeltaBadge value={currentStats?.totalTrips ?? 0} prev={prevStats.totalTrips} />
                      <span className="text-indigo-300 text-xs">vs prev</span>
                    </div>
                  )}
                </div>

                {/* Passengers */}
                <div className="bg-white/10 backdrop-blur-xl rounded-xl p-4">
                  <Users className="w-7 h-7 mb-2 text-indigo-200" />
                  <div className="text-3xl font-bold mb-0.5">{currentStats?.totalPassengers ?? 0}</div>
                  <div className="text-indigo-200 text-xs">Passengers</div>
                  {prevStats && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <DeltaBadge value={currentStats?.totalPassengers ?? 0} prev={prevStats.totalPassengers} />
                      <span className="text-indigo-300 text-xs">vs prev</span>
                    </div>
                  )}
                </div>

                {/* Revenue */}
                <div className="bg-white/10 backdrop-blur-xl rounded-xl p-4">
                  <DollarSign className="w-7 h-7 mb-2 text-indigo-200" />
                  <div className="text-2xl font-bold mb-0.5">₱{(currentStats?.totalRevenue ?? 0).toLocaleString()}</div>
                  <div className="text-indigo-200 text-xs">Total Revenue</div>
                  {prevStats && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <DeltaBadge value={currentStats?.totalRevenue ?? 0} prev={prevStats.totalRevenue} />
                      <span className="text-indigo-300 text-xs">vs prev</span>
                    </div>
                  )}
                </div>

                {/* Utilization */}
                <div className="bg-white/10 backdrop-blur-xl rounded-xl p-4">
                  <TrendingUp className="w-7 h-7 mb-2 text-indigo-200" />
                  <div className="text-3xl font-bold mb-0.5">{currentStats?.busUtilization ?? 0}%</div>
                  <div className="text-indigo-200 text-xs">Fleet Utilization</div>
                  <div className="mt-2 w-full bg-white/20 rounded-full h-1.5">
                    <div className="bg-white h-1.5 rounded-full transition-all duration-700"
                      style={{ width: `${currentStats?.busUtilization ?? 0}%` }} />
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>

        {/* ── Trend Chart ──────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-indigo-500" />
              <h3 className="text-gray-800 font-semibold">
                {selectedReport === 'daily' ? 'Hourly Breakdown' : 'Daily Breakdown'}
              </h3>
            </div>
            <div className="flex gap-2">
              {trendMetrics.map(m => (
                <button key={m.id} onClick={() => setTrendMetric(m.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    trendMetric === m.id ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >{m.label}</button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="h-56 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            </div>
          ) : trendPoints.length === 0 || trendPoints.every(p => p[trendMetric] === 0) ? (
            <div className="h-56 flex flex-col items-center justify-center text-gray-400">
              <BarChart2 className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm">No data for this period</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendPoints} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barSize={selectedReport === 'daily' ? 10 : 20}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                  interval={selectedReport === 'daily' ? 2 : selectedReport === 'monthly' ? 4 : 0} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                  tickFormatter={v => trendMetric === 'revenue' ? `₱${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}` : v.toString()} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }}
                  formatter={(v: any) => [activeTrendMeta.fmt(v), activeTrendMeta.label]}
                  labelStyle={{ fontWeight: 600, color: '#374151' }}
                />
                <Bar dataKey={trendMetric} fill={activeTrendMeta.color} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* ── Bottom Grid ─────────────────────────────────────────────── */}
        <div className="grid lg:grid-cols-2 gap-6">

          {/* Bus Performance Table */}
          <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center gap-2">
              <Bus className="w-5 h-5 text-purple-500" />
              <h3 className="font-semibold text-gray-800">Bus Performance</h3>
              <span className="ml-auto text-xs text-gray-400">Completed trips only</span>
            </div>
            <div className="p-5">
              {loading ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => <SkeletonLine key={i} />)}
                </div>
              ) : busPerformance.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <Bus className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No bus data for this period</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase">Bus</th>
                        <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Trips</th>
                        <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">PAX</th>
                        <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Revenue</th>
                        <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {busPerformance.map((bus, i) => (
                        <motion.tr key={bus.plate}
                          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.05 * i }}
                          className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold ${
                                i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-indigo-400'
                              }`}>{i + 1}</div>
                              <span className="font-medium text-gray-800">{bus.plate}</span>
                            </div>
                          </td>
                          <td className="py-3 text-right text-gray-700">{bus.trips}</td>
                          <td className="py-3 text-right text-gray-700">{bus.passengers}</td>
                          <td className="py-3 text-right font-medium text-gray-800">₱{bus.revenue.toLocaleString()}</td>
                          <td className="py-3 text-right text-gray-500 text-xs">{bus.avgDuration}m</td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>

          {/* Operational Metrics */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-5">
              <Clock className="w-5 h-5 text-blue-500" />
              <h3 className="font-semibold text-gray-800">Operational Metrics</h3>
            </div>

            {loading ? (
              <div className="space-y-5">
                {[1,2,3,4].map(i => (
                  <div key={i} className="space-y-2">
                    <SkeletonLine w="w-1/2" />
                    <SkeletonLine />
                  </div>
                ))}
              </div>
            ) : !currentStats ? (
              <div className="text-center text-gray-400 py-8">No data available</div>
            ) : (
              <div className="space-y-5">

                {/* Avg Trip Duration */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-sm text-gray-600">Avg Trip Duration</span>
                    <span className="text-sm font-semibold text-gray-800">
                      {currentStats.avgTripDuration > 0 ? `${currentStats.avgTripDuration} min` : '—'}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-gradient-to-r from-blue-400 to-cyan-400 h-2 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, (currentStats.avgTripDuration / 90) * 100)}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {currentStats.avgTripDuration === 0 ? 'No completed trips with timing data' : 'Based on completed trips'}
                  </p>
                </div>

                {/* Fleet Utilization */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-sm text-gray-600">Fleet Utilization</span>
                    <span className="text-sm font-semibold text-gray-800">{currentStats.busUtilization}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all duration-700 ${
                      currentStats.busUtilization >= 75 ? 'bg-gradient-to-r from-green-400 to-emerald-400'
                      : currentStats.busUtilization >= 40 ? 'bg-gradient-to-r from-yellow-400 to-amber-400'
                      : 'bg-gradient-to-r from-red-400 to-rose-400'
                    }`} style={{ width: `${currentStats.busUtilization}%` }} />
                  </div>
                  <p className={`text-xs mt-1 ${
                    currentStats.busUtilization >= 75 ? 'text-green-600'
                    : currentStats.busUtilization >= 40 ? 'text-amber-600'
                    : 'text-red-500'
                  }`}>
                    {currentStats.busUtilization >= 75 ? 'Excellent utilization'
                      : currentStats.busUtilization >= 40 ? 'Moderate utilization'
                      : currentStats.busUtilization === 0 ? 'No active buses this period'
                      : 'Low utilization'}
                  </p>
                </div>

                {/* Avg Passengers per Trip */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-sm text-gray-600">Avg Passengers / Trip</span>
                    <span className="text-sm font-semibold text-gray-800">{currentStats.avgPassengersPerTrip}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-gradient-to-r from-purple-400 to-pink-400 h-2 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, (currentStats.avgPassengersPerTrip / 50) * 100)}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Out of ~50 max capacity</p>
                </div>

                {/* Avg Revenue per Trip */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-sm text-gray-600">Avg Revenue / Trip</span>
                    <span className="text-sm font-semibold text-gray-800">
                      {currentStats.totalTrips > 0
                        ? `₱${(currentStats.totalRevenue / currentStats.totalTrips).toFixed(0)}`
                        : '—'}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-gradient-to-r from-amber-400 to-orange-400 h-2 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, currentStats.totalTrips > 0 ? ((currentStats.totalRevenue / currentStats.totalTrips) / 500) * 100 : 0)}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Based on ₱500 benchmark per trip</p>
                </div>

                {/* Peak Hours */}
                {currentStats.peakHours.length > 0 && (
                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Peak Operating Hours</p>
                    <div className="space-y-2">
                      {currentStats.peakHours.map((h, i) => (
                        <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                          i === 0
                            ? 'bg-orange-50 border-orange-200 text-orange-800'
                            : 'bg-gray-50 border-gray-200 text-gray-600'
                        }`}>
                          <TrendingUp className={`w-4 h-4 ${i === 0 ? 'text-orange-500' : 'text-gray-400'}`} />
                          {h}
                          {i === 0 && <span className="ml-auto text-xs font-medium text-orange-500">Peak</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </div>

        {/* ── Trip Detail Table ─────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-500" />
            <h3 className="font-semibold text-gray-800">Trip Details</h3>
            {!loading && (
              <span className="ml-auto text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                {currentTrips.length} trip{currentTrips.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-5 space-y-3">
                {[1,2,3,4,5].map(i => <SkeletonLine key={i} />)}
              </div>
            ) : currentTrips.length === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No trips found for this period</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Bus</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Route</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Driver</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Start</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">PAX</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Revenue</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {currentTrips
                    .slice()
                    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                    .map((trip, i) => (
                      <motion.tr key={trip.id}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        transition={{ delay: 0.02 * i }}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-800">{trip.busPlateNumber || trip.busId}</td>
                        <td className="px-4 py-3 text-gray-600 max-w-[140px] truncate">{trip.route || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{trip.driver || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {new Date(trip.startTime).toLocaleString('en-PH', {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{trip.passengersBoarded || 0}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-800">
                          ₱{(trip.totalFare || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            trip.status === 'completed'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              trip.status === 'completed' ? 'bg-green-500' : 'bg-amber-500 animate-pulse'
                            }`} />
                            {trip.status === 'completed' ? 'Completed' : 'Ongoing'}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </motion.div>

        {/* ── Insights ─────────────────────────────────────────────────── */}
        {!loading && currentStats && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
            className="bg-gradient-to-br from-slate-50 to-indigo-50 rounded-2xl border border-indigo-100 p-6">
            <h3 className="font-semibold text-gray-800 mb-4">Period Insights</h3>
            <div className="grid md:grid-cols-3 gap-4">

              {/* Revenue insight */}
              <div className="flex items-start gap-3 bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  prevStats && currentStats.totalRevenue >= prevStats.totalRevenue ? 'bg-green-100' : 'bg-red-100'
                }`}>
                  <DollarSign className={`w-5 h-5 ${
                    prevStats && currentStats.totalRevenue >= prevStats.totalRevenue ? 'text-green-600' : 'text-red-500'
                  }`} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-0.5">Revenue</h4>
                  {prevStats ? (
                    <p className="text-xs text-gray-500">
                      {currentStats.totalRevenue === 0 && prevStats.totalRevenue === 0
                        ? 'No revenue recorded yet'
                        : (() => {
                            const { delta, dir } = pct(currentStats.totalRevenue, prevStats.totalRevenue);
                            return dir === 'up'
                              ? `Up ${delta}% from previous period`
                              : dir === 'down'
                              ? `Down ${delta}% from previous period`
                              : 'Same as previous period';
                          })()
                      }
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500">₱{currentStats.totalRevenue.toLocaleString()} total</p>
                  )}
                </div>
              </div>

              {/* Passenger insight */}
              <div className="flex items-start gap-3 bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  prevStats && currentStats.totalPassengers >= prevStats.totalPassengers ? 'bg-blue-100' : 'bg-orange-100'
                }`}>
                  <Users className={`w-5 h-5 ${
                    prevStats && currentStats.totalPassengers >= prevStats.totalPassengers ? 'text-blue-600' : 'text-orange-500'
                  }`} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-0.5">Ridership</h4>
                  {prevStats ? (
                    <p className="text-xs text-gray-500">
                      {currentStats.totalPassengers === 0 && prevStats.totalPassengers === 0
                        ? 'No passengers recorded yet'
                        : (() => {
                            const { delta, dir } = pct(currentStats.totalPassengers, prevStats.totalPassengers);
                            return dir === 'up'
                              ? `Up ${delta}% from previous period`
                              : dir === 'down'
                              ? `Down ${delta}% from previous period`
                              : 'Same as previous period';
                          })()
                      }
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500">{currentStats.totalPassengers} passengers served</p>
                  )}
                </div>
              </div>

              {/* Fleet insight */}
              <div className="flex items-start gap-3 bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  currentStats.busUtilization >= 60 ? 'bg-purple-100' : 'bg-gray-100'
                }`}>
                  <Bus className={`w-5 h-5 ${
                    currentStats.busUtilization >= 60 ? 'text-purple-600' : 'text-gray-500'
                  }`} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-0.5">Fleet Performance</h4>
                  <p className="text-xs text-gray-500">
                    {currentStats.totalTrips === 0
                      ? 'No trips completed this period'
                      : `${busPerformance.length} bus${busPerformance.length !== 1 ? 'es' : ''} active, ${currentStats.busUtilization}% utilization`
                    }
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}