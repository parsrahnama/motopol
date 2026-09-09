// pages/admin.js

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { playDingSound } from '../lib/sound';

const STATUS_MAP = {
  new: { label: 'در انتظار تایید', bg: '#3b2f0b', fg: '#fbbf24', border: '#a16207' },
  preparing: { label: 'در حال آماده‌سازی', bg: '#172554', fg: '#60a5fa', border: '#2563eb' },
  sent: { label: 'در حال ارسال (پیک)', bg: '#2e1065', fg: '#c084fc', border: '#7c3aed' },
  delivered: { label: 'تحویل داده شد', bg: '#06281e', fg: '#34d399', border: '#059669' },
  cancelled: { label: 'لغو شده', bg: '#3f0d16', fg: '#fb7185', border: '#e11d48' }
};

const STATUS_ORDER = ['new', 'preparing', 'sent', 'delivered', 'cancelled'];

export default function AdminPanel() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const soundEnabledRef = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('motopol_sound_enabled');
    if (saved !== null) {
      const enabled = saved === 'true';
      setSoundEnabled(enabled);
      soundEnabledRef.current = enabled;
    }
  }, []);

  const fetchOrders = useCallback(async (showRefreshState = false) => {
    if (showRefreshState) setRefreshing(true);
    else setLoading(true);

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('خطا در دریافت سفارش‌ها:', error);
      alert('خطا در دریافت سفارش‌ها: ' + (error?.message || 'خطای نامشخص'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchSingleOrder = useCallback(async orderId => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchOrders();

    const channel = supabase
      .channel('admin_orders_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async payload => {
        if (!mounted) return;

        if (payload.eventType === 'INSERT') {
          try {
            const fullOrder = await fetchSingleOrder(payload.new.id);
            setOrders(prev => {
              if (prev.some(order => order.id === payload.new.id)) return prev;
              return [fullOrder || payload.new, ...prev];
            });
          } catch (e) {
            console.error('Realtime insert refresh error:', e);
            setOrders(prev => [payload.new, ...prev.filter(order => order.id !== payload.new.id)]);
          }

          if (soundEnabledRef.current) playDingSound();
        } else if (payload.eventType === 'UPDATE') {
          try {
            const fullOrder = await fetchSingleOrder(payload.new.id);
            setOrders(prev => prev.map(order => order.id === payload.new.id ? (fullOrder || payload.new) : order));
          } catch (e) {
            console.error('Realtime update refresh error:', e);
            setOrders(prev => prev.map(order => order.id === payload.new.id ? payload.new : order));
          }

          if (soundEnabledRef.current) playDingSound();
        } else if (payload.eventType === 'DELETE') {
          setOrders(prev => prev.filter(order => order.id !== payload.old.id));
        }
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') console.error('Realtime channel error');
      });

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, fetchSingleOrder]);

  useEffect(() => {
    const channel = supabase
      .channel('admin_order_items_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, async payload => {
        const orderId = payload.new?.order_id || payload.old?.order_id;
        if (!orderId) return;
        try {
          const fullOrder = await fetchSingleOrder(orderId);
          if (fullOrder) {
            setOrders(prev => prev.map(order => order.id === orderId ? fullOrder : order));
          }
        } catch (e) {
          console.error('Realtime order_items refresh error:', e);
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [fetchSingleOrder]);

  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      soundEnabledRef.current = next;
      if (typeof window !== 'undefined') localStorage.setItem('motopol_sound_enabled', String(next));
      if (next) playDingSound();
      return next;
    });
  };

  const updateStatus = async (orderId, newStatus) => {
    if (!orderId || !newStatus) return;
    setUpdatingOrderId(orderId);

    try {
      const { data, error } = await supabase
        .from('orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', orderId)
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setOrders(prev => prev.map(order => order.id === orderId ? { ...order, ...data } : order));
      }
    } catch (error) {
      console.error('خطا در تغییر وضعیت سفارش:', error);
      alert('خطا در تغییر وضعیت: ' + (error?.message || 'خطای نامشخص'));
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const statusCounts = useMemo(() => {
    const counts = { all: orders.length };
    STATUS_ORDER.forEach(status => { counts[status] = 0; });
    orders.forEach(order => {
      const status = order.status || 'new';
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status]++;
    });
    return counts;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (filterStatus === 'all') return orders;
    return orders.filter(order => (order.status || 'new') === filterStatus);
  }, [orders, filterStatus]);

  const buttonStyle = (bg, fg, border, disabled = false) => ({
    padding: '7px 12px', fontSize: 12, borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer', background: bg,
    color: fg, border: `1px solid ${border}`, transition: 'opacity .2s, transform .1s',
    opacity: disabled ? 0.4 : 1, fontFamily: 'Tahoma, Vazirmatn, sans-serif'
  });

  const formatPrice = value => Number(value || 0).toLocaleString('fa-IR');
  const formatDate = value => {
    if (!value) return '-';
    try { return new Date(value).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return '-'; }
  };

  const getStatus = order => {
    const key = order.status || 'new';
    return { key, ...(STATUS_MAP[key] || STATUS_MAP.new) };
  };

  const isEditable = order =>
    order.status === 'new' && order.editable_until && new Date(order.editable_until).getTime() > Date.now();

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e2e8f0', padding: 24, direction: 'rtl', fontFamily: 'Tahoma, Vazirmatn, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 16, borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0, color: '#f59e0b' }}>پنل مدیریت و توزیع موتوپل</h1>
          <p style={{ fontSize: 12, color: '#8b949e', margin: '4px 0 0' }}>مدیریت سفارش‌ها و مانیتورینگ لحظه‌ای کافه‌ها</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={toggleSound} style={buttonStyle(soundEnabled ? '#06281e' : '#21262d', soundEnabled ? '#34d399' : '#8b949e', soundEnabled ? '#059669' : '#30363d')}>
            {soundEnabled ? '🔔 اعلان صوتی: فعال' : '🔕 اعلان صوتی: خاموش'}
          </button>
          <button type="button" onClick={() => fetchOrders(true)} disabled={refreshing} style={buttonStyle('#21262d', '#c9d1d9', '#30363d', refreshing)}>
            {refreshing ? '⏳ در حال بروزرسانی...' : '🔄 تازه‌سازی'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '16px auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setFilterStatus('all')} style={buttonStyle(filterStatus === 'all' ? '#f59e0b' : '#21262d', filterStatus === 'all' ? '#000' : '#c9d1d9', filterStatus === 'all' ? '#f59e0b' : '#30363d')}>همه ({statusCounts.all})</button>
        {STATUS_ORDER.map(status => {
          const config = STATUS_MAP[status];
          return <button key={status} type="button" onClick={() => setFilterStatus(status)} style={buttonStyle(filterStatus === status ? '#f59e0b' : '#21262d', filterStatus === status ? '#000' : '#c9d1d9', filterStatus === status ? '#f59e0b' : '#30363d')}>
            {config.label} ({statusCounts[status] || 0})
          </button>;
        })}
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {loading ? <div style={{ textAlign: 'center', color: '#8b949e', padding: 50 }}>در حال بارگذاری سفارش‌ها...</div> : filteredOrders.length === 0 ? <div style={{ textAlign: 'center', color: '#8b949e', padding: 40, background: '#161b22', borderRadius: 12, border: '1px solid #21262d' }}>هیچ سفارشی در این وضعیت وجود ندارد.</div> : filteredOrders.map(order => {
          const current = order.status || 'new';
          const status = getStatus(order);
          const isUpdating = updatingOrderId === order.id;
          const editable = isEditable(order);
          const items = Array.isArray(order.order_items) ? order.order_items : [];

          return <div key={order.id} style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 14, padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 'bold', fontSize: 15 }}>سفارش #{String(order.id).slice(0, 8)}</span>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: status.bg, color: status.fg, border: `1px solid ${status.border}` }}>{status.label}</span>
              {editable && <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: '#422006', color: '#fbbf24', border: '1px solid #92400e' }}>✏️ قابل ویرایش مشتری</span>}
              <span style={{ fontSize: 11, color: '#8b949e' }}>{formatDate(order.created_at)}</span>
            </div>

            <div style={{ fontSize: 12, color: '#c9d1d9', marginTop: 8, lineHeight: 1.9 }}>
              <div>👤 مشتری: {order.customer_id ? String(order.customer_id).slice(0, 8) : '-'}</div>
              <div>📍 آدرس: {order.delivery_address || 'ثبت نشده'}</div>
              {order.address_note && <div>📝 توضیحات: {order.address_note}</div>}
            </div>

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #21262d' }}>
              {items.length > 0 ? items.map(item => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '5px 0' }}>
                <span>{item.product_name} × {item.quantity}</span>
                <span>{formatPrice(item.total_price)} تومان</span>
              </div>) : <span style={{ fontSize: 11, color: '#8b949e' }}>اقلام سفارش ثبت نشده</span>}
            </div>

            <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#0d1117', border: '1px solid #30363d', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>جمع محصولات:</span><strong>{formatPrice(order.subtotal)} تومان</strong></div>
              {Number(order.discount_amount || 0) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>تخفیف:</span><strong>{formatPrice(order.discount_amount)} تومان</strong></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>هزینه ارسال:</span><strong>{Number(order.delivery_fee || 0) === 0 ? 'رایگان 🎉' : `${formatPrice(order.delivery_fee)} تومان`}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', fontWeight: 800 }}><span>مبلغ قابل پرداخت:</span><span>{formatPrice(order.final_amount)} تومان</span></div>
            </div>

            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #21262d', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#8b949e' }}>تغییر وضعیت:</span>
              <button type="button" disabled={current === 'preparing' || isUpdating} onClick={() => updateStatus(order.id, 'preparing')} style={buttonStyle('#172554', '#60a5fa', '#2563eb', current === 'preparing' || isUpdating)}>☕ آماده‌سازی</button>
              <button type="button" disabled={current === 'sent' || isUpdating} onClick={() => updateStatus(order.id, 'sent')} style={buttonStyle('#2e1065', '#c084fc', '#7c3aed', current === 'sent' || isUpdating)}>🛵 ارسال پیک</button>
              <button type="button" disabled={current === 'delivered' || isUpdating} onClick={() => updateStatus(order.id, 'delivered')} style={buttonStyle('#06281e', '#34d399', '#059669', current === 'delivered' || isUpdating)}>✅ تحویل شد</button>
              <button type="button" disabled={current === 'cancelled' || isUpdating} onClick={() => updateStatus(order.id, 'cancelled')} style={buttonStyle('#3f0d16', '#fb7185', '#e11d48', current === 'cancelled' || isUpdating)}>❌ لغو</button>
            </div>
          </div>;
        })}
      </div>

      <style jsx>{`button:hover:not(:disabled){opacity:.85}button:active:not(:disabled){transform:scale(.98)}@media(max-width:600px){div{box-sizing:border-box}}`}</style>
    </div>
  );
}
