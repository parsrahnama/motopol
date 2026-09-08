// pages/admin.js
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { playDingSound } from '../lib/sound';

const STATUS_MAP = {
  pending:          { label: 'در انتظار تایید',     bg: '#3b2f0b', fg: '#fbbf24', border: '#a16207' },
  processing:       { label: 'در حال آماده‌سازی',   bg: '#172554', fg: '#60a5fa', border: '#2563eb' },
  out_for_delivery: { label: 'در حال ارسال (پیک)',  bg: '#2e1065', fg: '#c084fc', border: '#7c3aed' },
  delivered:        { label: 'تحویل داده شد',       bg: '#06281e', fg: '#34d399', border: '#059669' },
  cancelled:        { label: 'لغو شده',             bg: '#3f0d16', fg: '#fb7185', border: '#e11d48' }
};

export default function AdminPanel() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    const saved = localStorage.getItem('motopol_sound_enabled');
    if (saved !== null) setSoundEnabled(saved === 'true');
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('motopol_sound_enabled', String(next));
    if (next) playDingSound();
  };

  const fetchOrders = async () => {
    setLoading(true);
    const { data, error } = await await supabase
      .from('orders')
      .select('*')
      .ordercreated_at', { ascending: false });
    if (error) console.error('خطا در دریافت سفارش‌ها:', error);
    else setOrders(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
    const channel = supabase
      .channel('admin_orders_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setOrders((prev) => [payload.new, ...prev]);
          playDingSound();
        } else if (payload.eventType === 'UPDATE') {
          setOrders((prev) => prev.map((o) => (o.id === payload.new.id ? payload.new : o)));
          playDingSound();
        } else if (payload.eventType === 'DELETE') {
          setOrders((prev) => prev.filter((o) => o.id === payload.old.id));
       .id));
        }
      })
      .subscribe();
    return () => supChannel(channel);
  }, []);

  const updateStatus = async (orderId, newStatus) => {
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) alert('خطا در تغییر وضعیت: ' + error.message);
  };

  const filtered = filterStatus === 'all'
    ? orders
    : orders.filter((o) => (o.status || 'pending') === filterStatus);

  const btn = (bg, fg, border) => ({
    padding: '6px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
    background: bg, color: fg, border: `1px solid ${border}`
  });

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117', color: '#e2e8f0',
      padding: 24, direction: 'rtl', fontFamily: 'Tahoma, Vazirmatn, sans-serif'
    }}>
      {/* هدر */}
      <div style={{
        maxWidth: 900, margin: '0 auto', paddingBottom: 16,
        borderBottom: '1px solid #21262d', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12
      }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0, color: '#f59e0b' }}>پنل مدیریت و توزیع موتوپل</h1>
          <p style={{ fontSize: 12, color: '#8b949e', margin: '4px 0 0' }}>
            مدیریت سفارش‌ها و مانیتورینگ لحظه‌ای کافه‌ها
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={toggleSound}
            style={btn(
              soundEnabled ? '#06281e' : '#21262d',
              soundEnabled ? '#34d399' : '#8b949e',
              soundEnabled ? '#059669' : '#30363d'
            )}
          >
            {soundEnabled ? '🔔 اعلان صوتی: فعال' : '🔕 اعلان صوتی: خاموش'}
          </button>
          <button onClick={fetchOrders} style={btn('#21262d', '#c9d1d9', '#30363d')}>
            🔄 تازه‌سازی
          </button>
        </div>
      </div>

      {/* فیلترها */}
      <div style={{ maxWidth: 900, margin: '16px auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['all', `همه (${orders.length})`],
          ...Object.entries(STATUS_MAP).map(([k, v]) =>
            [k, `${v.label} (${orders.filter((o) => (o.status || 'pending') === k).length})`])
        ].map(([key, label]) => (
          <button key={key} onClick={() => setFilterStatus(key)}
            style={btn(
              filterStatus === key ? '#f59e0b' : '#21262d',
              filterStatus === key ? '#000' : '#c9d1d9',
              filterStatus === key ? '#f59e0b' : '#30363d',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* لیست سفارش‌ها */}
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>در حال بارگذاری...</p>
        ) : filtered.length === 0 ? (
          <p style={{
            textAlign: 'center', color: '#8b949e', padding: 40,
            background: '#161b22', borderRadius: 12, border: '1px solid #21262d'
          }}>هیچ سفارشی در این وضعیت وجود ندارد.</p>
        ) : (
          filtered.map((order) => {
            const current = order.status || 'pending';
            const s = STATUS_MAP[current] || STATUS_MAP.pending;
            return (
              <div key={order.id} style={{
                background: '#161b22', border: '1px solid #21262d', borderRadius: 14,
                padding: 20, marginBottom: 16
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 'bold', fontSize: 15 }}>
                    {order.shop_name || order.customer_name || 'کافه بدون نام'}
                  </span>
                  <span style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 99,
                    background: s.bg, color: s.fg, border: `1px solid ${s.border}`
                  }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: '#8b949e' }}>
                    {order.created_at
                      ? new Date(order.created_at).toLocaleString('fa-IR',
                          { dateStyle: 'short', timeStyle: 'short' })
                      : ''}
                  </span>
                </div>

                <div style={{ fontSize: 12, color: '#c9d1d9', marginTop: 8, lineHeight: 1.9 }}>
                  📞 تلفن: <span dir="ltr" style={{ display: 'inline-block' }}>{order.phone || '-'}</span><br />
                  📍 آدرس: {order.shop_address || order.address_note || 'ثبت نشده'}
                </div>

                {/* اقلام */}
                <div style={{
                  marginTop: 10, paddingTop: 10, borderTop: '1px solid #21262d',
                  display: 'flex', gap: 6, flexWrap: 'wrap'
                }}>
                  {Array.isArray(order.items) ? order.items.map((it, i) => (
                    <span key={i} style={{
                      background: '#0d1117', border: '1px solid #30363d',
                      borderRadius: 6, padding: '3px 8px', fontSize: 11
                    }}>
                      {it.name || it.title} × {it.quantity || it.count || 1}
                    </span>
                  )) : (
                    <span style={{ fontSize: 11, color: '#8b949e' }}>
                      {JSON.stringify(order.items || '-')}
                    </span>
                  )}
                </div>

                {order.total_price != null && (
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: '#f59e0b', marginTop: 10 }}>
                    مبلغ کل: {Number(order.total_price).toLocaleString('fa-IR')} تومان
                  </div>
                )}

                {/* دکمه‌های وضعیت */}
                <div style={{
                  marginTop: 14, paddingTop: 12, borderTop: '1px solid #21262d',
                  display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center'
                }}>
                  <span style={{ fontSize: 11, color: '#8b949e' }}>تغییر وضعیت:</span>
                  <button disabled={current === 'processing'} onClick={() => updateStatus(order.id, 'processing')}
                    style={{ ...btn('#172554', '#60a5fa', '#2563eb'), opacity: current === 'processing' ? 0.4 : 1 }}>
                    ☕ آماده‌سازی
                  </button>
                  <button disabled={current === 'out_for_delivery'} onClick={() => updateStatus(order.id, 'out_for_delivery')}
                    style={{ ...btn('#2e1065', '#c084fc', '#7c3aed'), opacity: current === 'out_for_delivery' ? 0.4 : 1 }}>
                    🛵 ارسال پیک
                  </button>
                  <button disabled={current === 'delivered'} onClick={() => updateStatus(order.id, 'delivered')}
                    style={{ ...btn('#06281e', '#34d399', '#059669'), opacity: current === 'delivered' ? 0.4 : 1 }}>
                    ✅ تحویل شد
                  </button>
                  <button disabled={current === 'cancelled'} onClick={() => updateStatus(order.id, 'cancelled')}
                    style={{ ...btn('#3f0d16', '#fb7185', '#e11d48'), opacity: current === 'cancelled' ? 0.4 : 1 }}>
                    ❌ لغو
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
