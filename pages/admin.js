// pages/admin.js
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { playDingSound } from '../lib/sound';

const STATUS_MAP = {
  pending: { label: 'در انتظار تایید', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  processing: { label: 'در حال آماده‌سازی', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  out_for_delivery: { label: 'در حال ارسال (پیک)', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  delivered: { label: 'تحویل داده شد', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  cancelled: { label: 'لغو شده', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' }
};

export default function AdminPanel() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');

  // بارگذاری تنظیمات صدا از LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('motopol_sound_enabled');
    if (saved !== null) {
      setSoundEnabled(saved === 'true');
    }
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('motopol_sound_enabled', String(next));
    if (next) playDingSound();
  };

  // دریافت لیست اولیه سفارش‌ها
  const fetchOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('خطا در دریافت سفارش‌ها:', error);
    } else {
      setOrders(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();

    // اتصال زنده Realtime برای دریافت خودکار سفارش‌های جدید یا آپدیت‌ها
    const channel = supabase
      .channel('admin_orders_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setOrders((prev) => [payload.new, ...prev]);
            playDingSound(); // صدای اعلان سفارش جدید
          } else if (payload.eventType === 'UPDATE') {
            setOrders((prev) =>
              prev.map((o) => (o.id === payload.new.id ? payload.new : o))
            );
            playDingSound(); // صدای اعلان تغییر وضعیت
          } else if (payload.eventType === 'DELETE') {
            setOrders((prev) => prev.filter((o) => o.id === payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // تابع به‌روزرسانی وضعیت سفارش
  const updateStatus = async (orderId, newStatus) => {
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    if (error) {
      alert('خطا در تغییر وضعیت: ' + error.message);
    }
  };

  const filteredOrders = filterStatus === 'all'
    ? orders
    : orders.filter((o) => (o.status || 'pending') === filterStatus);

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-100 p-4 md:p-8 font-sans" dir="rtl">
      {/* Header */}
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            پنل مدیریت و توزیع موتوپل
          </h1>
          <p className="text-xs text-slate-400 mt-1">مدیریت سفارش‌ها و مانیتورینگ لحظه‌ای کافه‌ها</p>
        </div>

        {/* دکمه سوئیچ صدا و دکمه رفرش */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSound}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
              soundEnabled
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            <span>{soundEnabled ? '🔔 اعلان صوتی: فعال' : '🔕 اعلان صوتی: خاموش'}</span>
          </button>
          <button
            onClick={fetchOrders}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs"
          >
            🔄 تازه‌سازی
          </button>
        </div>
      </div>

      {/* فیلترها */}
      <div className="max-w-6xl mx-auto my-6 flex flex-wrap gap-2">
        <button
          onClick={() => setFilterStatus('all')}
          className={`px-3 py-1 rounded-lg text-xs transition-colors ${
            filterStatus === 'all' ? 'bg-amber-500 text-black font-bold' : 'bg-slate-800 text-slate-300'
          }`}
        >
          همه ({orders.length})
        </button>
        {Object.entries(STATUS_MAP).map(([key, value]) => {
          const count = orders.filter((o) => (o.status || 'pending') === key).length;
          return (
            <button
              key={key}
              onClick={() => setFilterStatus(key)}
              className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                filterStatus === key ? 'bg-amber-500 text-black font-bold' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {value.label} ({count})
            </button>
          );
        })}
      </div>

      {/* لیست سفارش‌ها */}
      <div className="max-w-6xl mx-auto space-y-4">
        {loading ? (
          <div className="text-center py-12 text-slate-400">در حال بارگذاری سفارش‌ها...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-slate-900/40 rounded-xl border border-slate-800">
            هیچ سفارشی در این وضعیت وجود ندارد.
          </div>
        ) : (
          filteredOrders.map((order) => {
            const currentStatus = order.status || 'pending';
            const statusConfig = STATUS_MAP[currentStatus] || STATUS_MAP.pending;

            return (
              <div
                key={order.id}
                className="bg-[#161b22] border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row justify-between gap-6"
              >
                {/* مشخصات کافه و سفارش */}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-base text-white">
                      {order.shop_name || order.customer_name || 'کافه بدون نام'}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs border font-medium ${statusConfig.color}`}>
                      {statusConfig.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      {order.created_at ? new Date(order.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 flex flex-wrap gap-x-4 gap-y-1">
                    <span>📞 تلفن: {order.phone || '-'}</span>
                    <span>📍 آدرس: {order.shop_address || order.address_note || 'ثبت نشده'}</span>
                  </div>

                  {/* اقلام سفارش */}
                  <div className="mt-3 pt-3 border-t border-slate-800/80">
                    <div className="text-xs font-semibold text-slate-400 mb-1">اقلام درخواستی:</div>
                    <div className="flex flex-wrap gap-2">
                      {Array.isArray(order.items) ? (
                        order.items.map((item, idx) => (
                          <span key={idx} className="bg-slate-800/80 px-2 py-1 rounded text-xs text-slate-200 border border-slate-700/50">
                            {item.name || item.title} × {item.quantity || item.count || 1}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400">{JSON.stringify(order.items || '-')}</span>
                      )}
                    </div>
                  </div>

                  {order.total_price && (
                    <div className="text-xs font-bold text-amber-400 pt-1">
                      مبلغ کل: {Number(order.total_price).toLocaleString('fa-IR')} تومان
                    </div>
                  )}
                </div>

                {/* دکمه‌های اقدام و تغییر وضعیت */}
                <div className="flex flex-col justify-center gap-2 min-w-[200px] border-t md:border-t-0 md:border-r border-slate-800 md:pr-6 pt-4 md:pt-0">
                  <span className="text-xs text-slate-400 mb-1 font-medium">تغییر وضعیت:</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => updateStatus(order.id, 'processing')}
                      disabled={currentStatus === 'processing'}
                      className="px-2.5 py-1.5 text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30 rounded disabled:opacity-30"
                    >
                      آماده‌سازی
                    </button>
                    <button
                      onClick={() => updateStatus(order.id, 'out_for_delivery')}
                      disabled={currentStatus === 'out_for_delivery'}
                      className="px-2.5 py-1.5 text-xs bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/30 rounded disabled:opacity-30"
                    >
                      ارسال پیک
                    </button>
                    <button
                      onClick={() => updateStatus(order.id, 'delivered')}
                      disabled={currentStatus === 'delivered'}
                      className="px-2.5 py-1.5 text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded disabled:opacity-30"
                    >
                      تحویل داده شد
                    </button>
                    <button
                      onClick={() => updateStatus(order.id, 'cancelled')}
                      disabled={currentStatus === 'cancelled'}
                      className="px-2.5 py-1.5 text-xs bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded disabled:opacity-30"
                    >
                      لغو سفارش
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
