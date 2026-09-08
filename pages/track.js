// pages/track.js
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { playDingSound } from '../lib/sound';

const STEPS = [
  { key: 'pending', label: 'ثبت سفارش', icon: '📝' },
  { key: 'processing', label: 'آماده‌سازی', icon: '☕' },
  { key: 'out_for_delivery', label: 'پیک در مسیر', icon: '🛵' },
  { key: 'delivered', label: 'تحویل داده شد', icon: '✅' }
];

export default function TrackOrder() {
  const [phone, setPhone] = useState('');
  const [orders, setOrders] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!phone) return;

    setLoading(true);
    setSearched(true);

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('phone', phone.trim())
      .order('created_at', { ascending: false });

    if (!error) {
      setOrders(data || []);
    }
    setLoading(false);
  };

  // مانیتورینگ زنده برای کاربر
  useEffect(() => {
    if (!phone) return;

    const channel = supabase
      .channel('customer_track_channel')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `phone=eq.${phone.trim()}` },
        (payload) => {
          setOrders((prev) =>
            prev.map((o) => (o.id === payload.new.id ? payload.new : o))
          );
          playDingSound(); // اعلان تغییر وضعیت به مشتری
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [phone]);

  const getStepIndex = (status) => {
    if (status === 'cancelled') return -1;
    const index = STEPS.findIndex((s) => s.key === status);
    return index === -1 ? 0 : index;
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-100 p-4 md:p-8 font-sans" dir="rtl">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-amber-400">پیگیری لحظه‌ای سفارش موتوپل</h1>
          <p className="text-xs text-slate-400 mt-1">شماره همراه ثبت‌شده هنگام سفارش را وارد نمایید</p>
        </div>

        {/* فرم جستجو */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-8">
          <input
            type="tel"
            placeholder="مثال: 09123456789"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 text-center tracking-wider"
          />
          <button
            type="submit"
            className="bg-amber-500 hover:bg-amber-600 text-black font-bold px-6 py-3 rounded-xl text-sm transition-all"
          >
            {loading ? '...' : 'پیگیری'}
          </button>
        </form>

        {/* نتایج */}
        {searched && (
          <div className="space-y-6">
            {orders.length === 0 ? (
              <div className="text-center p-8 bg-slate-900/50 rounded-xl border border-slate-800 text-slate-400 text-sm">
                سفارشی با این شماره همراه یافت نشد.
              </div>
            ) : (
              orders.map((order) => {
                const currentIdx = getStepIndex(order.status);
                const isCancelled = order.status === 'cancelled';

                return (
                  <div key={order.id} className="bg-[#161b22] border border-slate-800 rounded-2xl p-6 shadow-xl">
                    <div className="flex justify-between items-center pb-4 border-b border-slate-800 text-xs text-slate-400">
                      <span>سفارش: {order.shop_name || 'کافه'}</span>
                      <span>{new Date(order.created_at).toLocaleDateString('fa-IR')}</span>
                    </div>

                    {isCancelled ? (
                      <div className="my-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-center text-rose-400 text-sm font-medium">
                        این سفارش لغو شده است.
                      </div>
                    ) : (
                      /* تایم‌لاین بصری مراحل */
                      <div className="my-8">
                        <div className="grid grid-cols-4 relative">
                          <div className="absolute top-1/2 left-0 right-0 h-1 bg-slate-800 -translate-y-1/2 z-0" />
                          {STEPS.map((step, idx) => {
                            const isDone = currentIdx >= idx;
                            const isCurrent = currentIdx === idx;

                            return (
                              <div key={step.key} className="flex flex-col items-center relative z-10">
                                <div
                                  className={`w-10 h-10 rounded-full flex items-center justify-center text-base border-2 transition-all ${
                                    isCurrent
                                      ? 'bg-amber-500 border-amber-300 text-black shadow-lg shadow-amber-500/30 scale-110'
                                      : isDone
                                      ? 'bg-emerald-600 border-emerald-400 text-white'
                                      : 'bg-slate-900 border-slate-700 text-slate-500'
                                  }`}
                                >
                                  {step.icon}
                                </div>
                                <span className={`text-[11px] mt-2 font-medium ${isCurrent ? 'text-amber-400 font-bold' : isDone ? 'text-slate-200' : 'text-slate-500'}`}>
                                  {step.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* اقلام */}
                    <div className="bg-slate-900/60 rounded-xl p-3 text-xs space-y-1">
                      <div className="text-slate-400 font-semibold mb-1">اقلام سفارش داده شده:</div>
                      {Array.isArray(order.items) &&
                        order.items.map((it, i) => (
                          <div key={i} className="flex justify-between text-slate-300">
                            <span>{it.name || it.title}</span>
                            <span>{it.quantity || it.count || 1} عدد</span>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
