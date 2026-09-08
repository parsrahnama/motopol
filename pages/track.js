// pages/track.js
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { playDingSound } from '../lib/sound';

const STEPS = [
  { key: 'pending',          label: 'ثبت سفارش',    icon: '📝' },
  { key: 'processing',       label: 'آماده‌سازی',   icon: '☕' },
  { key: 'out_for_delivery', label: 'پیک در مسیر',  icon: '🛵' },
  { key: 'delivered',        label: 'تحویل شد',     icon: '✅' }
];

export default function TrackOrder() {
  const [phone, setPhone] = useState('');
  const [orders, setOrders] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!phone.trim()) return;
    setLoading(true);
    setSearched(true);
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('phone', phone.trim())
      .order('created_at', { ascending: false });
    if (!error) setOrders(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!phone.trim()) return;
    const channel = supabase
      .channel('customer_track_channel')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `phone=eq.${phone.trim()}` },
        (payload) => {
          setOrders((prev) => prev.map((o) => (o.id === payload.new.id ? payload.new : o)));
          playDingSound();
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [phone]);

  const stepIndex = (status) => {
    if (status === 'cancelled') return -1;
    const i = STEPS.findIndex((s) => s.key === status);
    return i === -1 ? 0 : i;
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117', color: '#e2e8f0',
      padding: 24, direction: 'rtl', fontFamily: 'Tahoma, Vazirmatn, sans-serif'
    }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 22, color: '#f59e0b', margin: 0 }}>پیگیری لحظه‌ای سفارش موتوپل</h1>
          <p style={{ fontSize: 13, color: '#8b949e', marginTop: 6 }}>
            شماره همراه ثبت‌شده هنگام سفارش را وارد نمایید
          </p>
        </div>

        {/* فرم جستجو */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
          <input
            type="tel"
            placeholder="مثال: 09123456789"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{
              flex: 1, background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
              padding: '12px 16px', color: '#e2e8f0', fontSize: 14,
              textAlign: 'center', direction: 'ltr', outline: 'none'
            }}
          />
          <button type="submit" style={{
            background: '#f59e0b', color: '#000', fontWeight: 'bold', border: 'none',
            borderRadius: 10, padding: '0 24px', fontSize: 14, cursor: 'pointer'
          }}>
            {loading ? '...' : 'پیگیری'}
          </button>
        </form>

        {searched && orders.length === 0 && (
          <p style={{
            textAlign: 'center', color: '#8b949e', padding: 32,
            background: '#161b22', borderRadius: 12, border: '1px solid #21262d'
          }}>سفارشی با این شماره همراه یافت نشد.</p>
        )}

        {orders.map((order) => {
          const idx = stepIndex(order.status);
          const cancelled = order.status === 'cancelled';
          return (
            <div key={order.id} style={{
              background: '#161b22', border: '1px solid #21262d',
              borderRadius: 16, padding: 24, marginBottom: 20
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontSize: 12,
                color: '#8b949e', paddingBottom: 12, borderBottom: '1px solid #21262d'
              }}>
                <span>سفارش: {order.shop_name || 'کافه'}</span>
                <span>{new Date(order.created_at).toLocaleDateString('fa-IR')}</span>
              </div>

              {cancelled ? (
                <div style={{
                  margin: '20px 0', padding: 16, textAlign: 'center',
                  background: '#3f0d16', border: '1px solid #e11d48',
                  borderRadius: 12, color: '#fb7185', fontSize: 13
                }}>این سفارش لغو شده است.</div>
              ) : (
                /* تایم‌لاین */
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'flex-start', margin: '28px 8px', position: 'relative'
                }}>
                  <div style={{
                    position: 'absolute', top: 19, right: '12%', left: '12%',
                    height: 3, background: '#30363d', zIndex: 0
                  }} />
                  <div style={{
                    position: 'absolute', top: 19, right: '12%',
                    width: `${(idx / (STEPS.length - 1)) * 76}%`, height: 3,
                    background: '#f59e0b', zIndex: 1, transition: 'width .4s'
                  }} />
                  {STEPS.map((step, i) => {
                    const done = idx >= i;
                    const now = idx === i;
                    return (
                      <div key={step.key} style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', zIndex: 2, width: 70
                      }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 18, border: `2px solid ${now ? '#fbbf24' : done ? '#059669' : '#30363d'}`,
                          background: now ? '#f59e0b' : done ? '#064e3b' : '#0d1117',
                          boxShadow: now ? '0 0 14px rgba(245,158,11,.5)' : 'none'
                        }}>{step.icon}</div>
                        <span style={{
                          fontSize: 11, marginTop: 8,
                          color: now ? '#f59e0b' : done ? '#c9d1d9' : '#8b949e',
                          fontWeight: now ? 'bold' : 'normal', textAlign: 'center'
                        }}>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* اقلام */}
              <div style={{ background: '#0d1117', borderRadius: 10, padding: 12, fontSize: 13 }}>
                <div style={{ color: '#8b949e', fontSize: 11, marginBottom: 6, fontWeight: 'bold' }}>
                  اقلام سفارش:
                </div>
                {Array.isArray(order.items) && order.items.map((it, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between',
                    color: '#c9d1d9', padding: '3px 0'
                  }}>
                    <span>{it.name || it.title}</span>
                    <span>×{it.quantity || it.count || 1}</span>
                  </div>
                ))}
                {order.total_price != null && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    color: '#f59e0b', fontWeight: 'bold',
                    marginTop: 8, paddingTop: 8, borderTop: '1px solid #21262d'
                  }}>
                    <span>مبلغ کل</span>
                    <span>{Number(order.total_price).toLocaleString('fa-IR')} تومان</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
