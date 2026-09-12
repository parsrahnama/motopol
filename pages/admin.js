// pages/admin.js

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { playDingSound } from '../lib/sound';

const STATUS_MAP = {
  new: {
    label: 'سفارش جدید',
    bg: '#3b2f0b',
    fg: '#fbbf24',
    border: '#a16207'
  },
  preparing: {
    label: 'در حال آماده‌سازی',
    bg: '#172554',
    fg: '#60a5fa',
    border: '#2563eb'
  },
  sent: {
    label: 'در حال ارسال (پیک)',
    bg: '#2e1065',
    fg: '#c084fc',
    border: '#7c3aed'
  },
  delivered: {
    label: 'تحویل داده شد',
    bg: '#06281e',
    fg: '#34d399',
    border: '#059669'
  },
  cancelled: {
    label: 'لغو شده',
    bg: '#3f0d16',
    fg: '#fb7185',
    border: '#e11d48'
  }
};

const STATUS_ORDER = [
  'new',
  'preparing',
  'sent',
  'delivered',
  'cancelled'
];

export default function AdminPanel() {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [messageCustomer, setMessageCustomer] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);


  const isAdminSession = currentSession => {
    return (
      currentSession?.user?.app_metadata?.role === 'admin'
    );
  };

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      try {
        const {
          data: { session: currentSession }
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (currentSession && isAdminSession(currentSession)) {
          setSession(currentSession);
        } else {
          if (currentSession) {
            await supabase.auth.signOut();
          }
          setSession(null);
        }
      } catch (error) {
        console.error('Auth session error:', error);
        setSession(null);
      } finally {
        if (mounted) setAuthLoading(false);
      }
    };

    loadSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
      if (!mounted) return;

      if (currentSession && isAdminSession(currentSession)) {
        setSession(currentSession);
        setAuthError('');
      } else {
        if (currentSession) {
          await supabase.auth.signOut();
          setAuthError('این حساب دسترسی مدیر ندارد.');
        }
        setSession(null);
      }
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleAdminLogin = async event => {
    event.preventDefault();

    const email = loginEmail.trim();

    if (!email || !loginPassword) {
      setAuthError('ایمیل و رمز عبور را وارد کنید.');
      return;
    }

    setLoginLoading(true);
    setAuthError('');

    try {
      const { data, error } =
        await supabase.auth.signInWithPassword({
          email,
          password: loginPassword
        });

      if (error) throw error;

      if (!isAdminSession(data.session)) {
        await supabase.auth.signOut();
        throw new Error('این حساب دسترسی مدیر ندارد.');
      }

      setSession(data.session);
      setLoginPassword('');
    } catch (error) {
      console.error('Admin login error:', error);
      setSession(null);
      setAuthError(
        error?.message === 'Invalid login credentials'
          ? 'ایمیل یا رمز عبور اشتباه است.'
          : (error?.message || 'ورود ناموفق بود.')
      );
    } finally {
      setLoginLoading(false);
    }
  };

  const handleAdminLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setOrders([]);
  };

  /*
   * دریافت سفارش‌ها
   */
  const fetchOrders = useCallback(async (showRefreshState = false) => {
    if (!session) return;

    if (showRefreshState) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      // سفارش‌ها
      const { data: orderRows, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;

      const rows = orderRows || [];

      // اطلاعات مشتری‌ها را جداگانه می‌گیریم تا نام، موبایل و آدرس
      // همیشه از جدول واقعی customers خوانده شوند.
      const customerIds = [
        ...new Set(
          rows
            .map(order => order.customer_id)
            .filter(Boolean)
        )
      ];

      let customers = [];

      if (customerIds.length > 0) {
        const { data, error } = await supabase
          .from('customers')
          .select('*')
          .in('id', customerIds);

        if (error) throw error;
        customers = data || [];
      }

      const customerMap = new Map(
        customers.map(customer => [customer.id, customer])
      );

      // اقلام سفارش‌ها
      const orderIds = rows.map(order => order.id).filter(Boolean);
      let items = [];

      if (orderIds.length > 0) {
        const { data, error } = await supabase
          .from('order_items')
          .select('*')
          .in('order_id', orderIds)
          .order('created_at', { ascending: true });

        if (error) throw error;
        items = data || [];
      }

      const itemsMap = new Map();

      items.forEach(item => {
        if (!itemsMap.has(item.order_id)) {
          itemsMap.set(item.order_id, []);
        }
        itemsMap.get(item.order_id).push(item);
      });

      // ساخت یک آبجکت کامل برای نمایش در پنل
      const hydratedOrders = rows.map(order => {
        const customer = customerMap.get(order.customer_id) || null;

        return {
          ...order,
          customer,
          customer_name: customer?.full_name || '',
          full_name: customer?.full_name || '',
          phone: customer?.phone || '',
          shop_name: customer?.shop_name || '',
          shop_address: customer?.shop_address || '',
          address_notes: customer?.address_notes || '',
          items: itemsMap.get(order.id) || []
        };
      });

      setOrders(hydratedOrders);
    } catch (error) {
      console.error('خطا در دریافت سفارش‌ها:', error);
      alert(
        'خطا در دریافت سفارش‌ها: ' +
        (error?.message || 'خطای نامشخص')
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  /*
   * تنظیم صدای اعلان
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const saved = localStorage.getItem(
      'motopol_sound_enabled'
    );

    if (saved !== null) {
      setSoundEnabled(saved === 'true');
    }
  }, []);

  /*
   * دریافت اولیه + Realtime
   *
   * چون orders به customers و order_items وابسته است،
   * payload خام Realtime را مستقیم در state نمی‌گذاریم.
   * بعد از INSERT/UPDATE سفارش را دوباره کامل می‌خوانیم.
   */
  useEffect(() => {
    if (!session) {
      setOrders([]);
      setLoading(false);
      return undefined;
    }

    let mounted = true;

    fetchOrders();

    const hydrateSingleOrder = async orderId => {
      if (!orderId || !mounted) return null;

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (orderError) throw orderError;

      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('id', order.customer_id)
        .single();

      if (customerError) throw customerError;

      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.id)
        .order('created_at', { ascending: true });

      if (itemsError) throw itemsError;

      return {
        ...order,
        customer,
        customer_name: customer?.full_name || '',
        full_name: customer?.full_name || '',
        phone: customer?.phone || '',
        shop_name: customer?.shop_name || '',
        shop_address: customer?.shop_address || '',
        address_notes: customer?.address_notes || '',
        items: items || []
      };
    };

    const channel = supabase
      .channel('admin_orders_channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders'
        },
        async payload => {
          if (!mounted) return;

          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            try {
              const hydrated = await hydrateSingleOrder(payload.new.id);
              if (!hydrated || !mounted) return;

              setOrders(prev => {
                const exists = prev.some(order => order.id === hydrated.id);

                if (payload.eventType === 'INSERT' && !exists) {
                  return [hydrated, ...prev];
                }

                if (exists) {
                  return prev.map(order =>
                    order.id === hydrated.id ? hydrated : order
                  );
                }

                return [hydrated, ...prev];
              });

              setSoundEnabled(currentSound => {
                if (currentSound) {
                  playDingSound();
                }
                return currentSound;
              });
            } catch (error) {
              console.error('خطا در بروزرسانی سفارش Realtime:', error);
              // اگر لحظه‌ای داده وابسته در دسترس نبود، یک بار لیست کامل را تازه می‌کنیم.
              fetchOrders(true);
            }
          } else if (payload.eventType === 'DELETE') {
            setOrders(prev =>
              prev.filter(order => order.id !== payload.old.id)
            );
          }
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') {
          console.error('Realtime channel error');
        }
      });

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, session]);

  /*
   * تغییر وضعیت صدا
   */
  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;

      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'motopol_sound_enabled',
          String(next)
        );
      }

      if (next) {
        playDingSound();
      }

      return next;
    });
  };


  const openMessageModal = order => {
    if (!order?.customer_id) {
      alert('مشتری این سفارش پیدا نشد.');
      return;
    }

    setMessageCustomer({
      id: order.customer_id,
      full_name: order.customer_name || order.full_name || 'مشتری',
      phone: order.phone || '',
      shop_name: order.shop_name || ''
    });
    setMessageText('');
    setMessageModalOpen(true);
  };

  const closeMessageModal = () => {
    if (sendingMessage) return;
    setMessageModalOpen(false);
    setMessageCustomer(null);
    setMessageText('');
  };

  const sendMessageToCustomer = async () => {
    const text = messageText.trim();

    if (!messageCustomer?.id) {
      alert('مشتری انتخاب نشده است.');
      return;
    }

    if (!text) {
      alert('متن پیام را وارد کنید.');
      return;
    }

    setSendingMessage(true);

    try {
      const { error } = await supabase
        .from('messages')
        .insert([{
          customer_id: messageCustomer.id,
          message: text,
          sender_type: 'admin',
          is_read: false
        }]);

      if (error) throw error;

      setMessageText('');
      setMessageModalOpen(false);
      setMessageCustomer(null);
      alert('پیام با موفقیت برای مشتری ارسال شد.');
    } catch (error) {
      console.error('خطا در ارسال پیام:', error);
      alert(
        'خطا در ارسال پیام: ' +
        (error?.message || 'خطای نامشخص')
      );
    } finally {
      setSendingMessage(false);
    }
  };

  /*
   * تغییر وضعیت سفارش
   */
  const updateStatus = async (
    orderId,
    newStatus
  ) => {
    if (!orderId || !newStatus) return;

    setUpdatingOrderId(orderId);

    try {
      const { data, error } = await supabase
        .from('orders')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId)
        .select()
        .single();

      if (error) throw error;

      // اطلاعات مشتری و اقلام را نگه می‌داریم و فقط بخش سفارش را بروزرسانی می‌کنیم.
      if (data) {
        setOrders(prev =>
          prev.map(order =>
            order.id === orderId
              ? {
                  ...order,
                  ...data,
                  customer: order.customer,
                  customer_name: order.customer_name,
                  full_name: order.full_name,
                  phone: order.phone,
                  shop_name: order.shop_name,
                  shop_address: order.shop_address,
                  address_notes: order.address_notes,
                  items: order.items
                }
              : order
          )
        );
      }
    } catch (error) {
      console.error(
        'خطا در تغییر وضعیت سفارش:',
        error
      );

      alert(
        'خطا در تغییر وضعیت: ' +
        (error?.message || 'خطای نامشخص')
      );
    } finally {
      setUpdatingOrderId(null);
    }
  };

  /*
   * شمارش سفارش‌ها بر اساس وضعیت
   */
  const statusCounts = useMemo(() => {
    const counts = {
      all: orders.length
    };

    STATUS_ORDER.forEach(status => {
      counts[status] = 0;
    });

    orders.forEach(order => {
      const status =
        order.status || 'new';

      if (
        Object.prototype.hasOwnProperty.call(
          counts,
          status
        )
      ) {
        counts[status]++;
      }
    });

    return counts;
  }, [orders]);

  /*
   * فیلتر سفارش‌ها
   */
  const filteredOrders = useMemo(() => {
    if (filterStatus === 'all') {
      return orders;
    }

    return orders.filter(
      order =>
        (order.status || 'new') ===
        filterStatus
    );
  }, [orders, filterStatus]);

  /*
   * استایل دکمه‌ها
   */
  const buttonStyle = (
    bg,
    fg,
    border,
    disabled = false
  ) => ({
    padding: '7px 12px',
    fontSize: 12,
    borderRadius: 8,
    cursor: disabled
      ? 'not-allowed'
      : 'pointer',
    background: bg,
    color: fg,
    border: `1px solid ${border}`,
    transition:
      'opacity 0.2s, transform 0.1s',
    opacity: disabled ? 0.4 : 1,
    fontFamily:
      'Tahoma, Vazirmatn, sans-serif'
  });

  /*
   * فرمت قیمت
   */
  const formatPrice = value => {
    const number = Number(value || 0);

    return number.toLocaleString('fa-IR');
  };

  /*
   * فرمت تاریخ
   */
  const formatDate = value => {
    if (!value) return '-';

    try {
      return new Date(value).toLocaleString(
        'fa-IR',
        {
          dateStyle: 'short',
          timeStyle: 'short'
        }
      );
    } catch {
      return '-';
    }
  };

  /*
   * نمایش وضعیت
   */
  const getStatus = order => {
    const status =
      order.status || 'new';

    return {
      key: status,
      ...(
        STATUS_MAP[status] ||
        STATUS_MAP.new
      )
    };
  };

  if (authLoading) {
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100vh',
          background: '#0d1117',
          color: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          fontFamily: 'Tahoma, Vazirmatn, sans-serif'
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 18,
            padding: 28,
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>☕</div>
          <h1 style={{ margin: 0, fontSize: 20, color: '#f59e0b' }}>
            پنل مدیریت موتوپل
          </h1>
          <p style={{ color: '#8b949e', fontSize: 13, marginTop: 10 }}>
            در حال بررسی دسترسی...
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100vh',
          background: '#0d1117',
          color: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          fontFamily: 'Tahoma, Vazirmatn, sans-serif'
        }}
      >
        <form
          onSubmit={handleAdminLogin}
          style={{
            width: '100%',
            maxWidth: 420,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 18,
            padding: 28,
            boxShadow: '0 20px 60px rgba(0,0,0,.35)'
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>☕</div>
            <h1 style={{ margin: 0, fontSize: 22, color: '#f59e0b' }}>
              ورود به پنل مدیریت
            </h1>
            <p style={{ color: '#8b949e', fontSize: 12, lineHeight: 1.8 }}>
              برای دسترسی به سفارش‌ها وارد حساب مدیر شوید.
            </p>
          </div>

          {authError && (
            <div
              style={{
                background: '#3f0d16',
                border: '1px solid #e11d48',
                color: '#fb7185',
                borderRadius: 10,
                padding: 10,
                marginBottom: 14,
                fontSize: 12,
                lineHeight: 1.8
              }}
            >
              {authError}
            </div>
          )}

          <label
            style={{
              display: 'block',
              marginBottom: 7,
              fontSize: 12,
              color: '#c9d1d9'
            }}
          >
            ایمیل مدیر
          </label>
          <input
            type="email"
            value={loginEmail}
            onChange={e => setLoginEmail(e.target.value)}
            autoComplete="username"
            placeholder="admin@example.com"
            style={{
              width: '100%',
              padding: '12px 13px',
              marginBottom: 15,
              borderRadius: 10,
              border: '1px solid #30363d',
              background: '#0d1117',
              color: '#f8fafc',
              outline: 'none',
              fontSize: 13,
              direction: 'ltr',
              textAlign: 'left'
            }}
          />

          <label
            style={{
              display: 'block',
              marginBottom: 7,
              fontSize: 12,
              color: '#c9d1d9'
            }}
          >
            رمز عبور
          </label>
          <input
            type="password"
            value={loginPassword}
            onChange={e => setLoginPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            style={{
              width: '100%',
              padding: '12px 13px',
              marginBottom: 18,
              borderRadius: 10,
              border: '1px solid #30363d',
              background: '#0d1117',
              color: '#f8fafc',
              outline: 'none',
              fontSize: 13,
              direction: 'ltr',
              textAlign: 'left'
            }}
          />

          <button
            type="submit"
            disabled={loginLoading}
            style={{
              width: '100%',
              padding: '12px 15px',
              borderRadius: 10,
              border: '1px solid #f59e0b',
              background: '#f59e0b',
              color: '#000',
              cursor: loginLoading ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 700,
              opacity: loginLoading ? .65 : 1
            }}
          >
            {loginLoading ? 'در حال ورود...' : '🔐 ورود به پنل'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0d1117',
        color: '#e2e8f0',
        padding: 24,
        direction: 'rtl',
        fontFamily:
          'Tahoma, Vazirmatn, sans-serif'
      }}
    >
      {/* =========================
          HEADER
      ========================== */}
      <div
        style={{
          maxWidth: 900,
          margin: '0 auto',
          paddingBottom: 16,
          borderBottom:
            '1px solid #21262d',
          display: 'flex',
          justifyContent:
            'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              margin: 0,
              color: '#f59e0b'
            }}
          >
            پنل مدیریت و توزیع موتوپل
          </h1>

          <p
            style={{
              fontSize: 12,
              color: '#8b949e',
              margin: '4px 0 0'
            }}
          >
            مدیریت سفارش‌ها و مانیتورینگ
            لحظه‌ای کافه‌ها
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap'
          }}
        >
          <button
            type="button"
            onClick={toggleSound}
            style={buttonStyle(
              soundEnabled
                ? '#06281e'
                : '#21262d',
              soundEnabled
                ? '#34d399'
                : '#8b949e',
              soundEnabled
                ? '#059669'
                : '#30363d'
            )}
          >
            {soundEnabled
              ? '🔔 اعلان صوتی: فعال'
              : '🔕 اعلان صوتی: خاموش'}
          </button>

          <button
            type="button"
            onClick={() =>
              fetchOrders(true)
            }
            disabled={refreshing}
            style={buttonStyle(
              '#21262d',
              '#c9d1d9',
              '#30363d',
              refreshing
            )}
          >
            {refreshing
              ? '⏳ در حال بروزرسانی...'
              : '🔄 تازه‌سازی'}
          </button>

          <button
            type="button"
            onClick={handleAdminLogout}
            style={buttonStyle(
              '#3f0d16',
              '#fb7185',
              '#e11d48'
            )}
          >
            🚪 خروج
          </button>
        </div>
      </div>

      {/* =========================
          STATUS FILTERS
      ========================== */}
      <div
        style={{
          maxWidth: 900,
          margin: '16px auto',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap'
        }}
      >
        <button
          type="button"
          onClick={() =>
            setFilterStatus('all')
          }
          style={buttonStyle(
            filterStatus === 'all'
              ? '#f59e0b'
              : '#21262d',
            filterStatus === 'all'
              ? '#000'
              : '#c9d1d9',
            filterStatus === 'all'
              ? '#f59e0b'
              : '#30363d'
          )}
        >
          همه ({statusCounts.all})
        </button>

        {STATUS_ORDER.map(status => {
          const config =
            STATUS_MAP[status];

          return (
            <button
              type="button"
              key={status}
              onClick={() =>
                setFilterStatus(status)
              }
              style={buttonStyle(
                filterStatus === status
                  ? '#f59e0b'
                  : '#21262d',
                filterStatus === status
                  ? '#000'
                  : '#c9d1d9',
                filterStatus === status
                  ? '#f59e0b'
                  : '#30363d'
              )}
            >
              {config.label} (
              {statusCounts[status] || 0}
              )
            </button>
          );
        })}
      </div>

      {/* =========================
          ORDERS
      ========================== */}
      <div
        style={{
          maxWidth: 900,
          margin: '0 auto'
        }}
      >
        {loading ? (
          <div
            style={{
              textAlign: 'center',
              color: '#8b949e',
              padding: 50
            }}
          >
            در حال بارگذاری سفارش‌ها...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: '#8b949e',
              padding: 40,
              background: '#161b22',
              borderRadius: 12,
              border:
                '1px solid #21262d'
            }}
          >
            هیچ سفارشی در این وضعیت
            وجود ندارد.
          </div>
        ) : (
          filteredOrders.map(order => {
            const current =
              order.status || 'new';

            const status =
              getStatus(order);

            const isUpdating =
              updatingOrderId ===
              order.id;

            return (
              <div
                key={order.id}
                style={{
                  background: '#161b22',
                  border:
                    '1px solid #21262d',
                  borderRadius: 14,
                  padding: 20,
                  marginBottom: 16
                }}
              >
                {/* ORDER HEADER */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap'
                  }}
                >
                  <span
                    style={{
                      fontWeight: 'bold',
                      fontSize: 15
                    }}
                  >
                    {order.customer_name ||
                      'مشتری بدون نام'}
                  </span>

                  {order.shop_name && (
                    <span
                      style={{
                        fontSize: 12,
                        color: '#c9d1d9'
                      }}
                    >
                      🏪 {order.shop_name}
                    </span>
                  )}

                  <span
                    style={{
                      fontSize: 11,
                      padding:
                        '3px 10px',
                      borderRadius: 99,
                      background:
                        status.bg,
                      color:
                        status.fg,
                      border:
                        `1px solid ${status.border}`
                    }}
                  >
                    {status.label}
                  </span>

                  <span
                    style={{
                      fontSize: 11,
                      color: '#8b949e'
                    }}
                  >
                    {formatDate(
                      order.created_at
                    )}
                  </span>
                </div>

                {/* CUSTOMER INFO */}
                <div
                  style={{
                    fontSize: 12,
                    color: '#c9d1d9',
                    marginTop: 8,
                    lineHeight: 1.9
                  }}
                >
                  <div>
                    📞 تلفن:{' '}
                    <span
                      dir="ltr"
                      style={{
                        display:
                          'inline-block'
                      }}
                    >
                      {order.phone || '-'}
                    </span>
                  </div>

                  <div>
                    📍 آدرس:{' '}
                    {order.delivery_address ||
                      order.shop_address ||
                      'ثبت نشده'}
                  </div>

                  {(order.address_note || order.address_notes) && (
                    <div>
                      📝 توضیحات تحویل:{' '}
                      {order.address_note || order.address_notes}
                    </div>
                  )}

                  {order.customer_note && (
                    <div>
                      💬 یادداشت مشتری:{' '}
                      {order.customer_note}
                    </div>
                  )}
                </div>

                {/* ITEMS */}
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop:
                      '1px solid #21262d',
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap'
                  }}
                >
                  {Array.isArray(
                    order.items
                  ) &&
                  order.items.length > 0 ? (
                    order.items.map(
                      (item, index) => (
                        <span
                          key={
                            item.id
                              ? `${item.id}-${index}`
                              : index
                          }
                          style={{
                            background:
                              '#0d1117',
                            border:
                              '1px solid #30363d',
                            borderRadius: 6,
                            padding:
                              '4px 9px',
                            fontSize: 11
                          }}
                        >
                          {item.product_name ||
                            item.name ||
                            item.title ||
                            'محصول'}

                          {' × '}

                          {item.quantity ||
                            item.count ||
                            1}
                        </span>
                      )
                    )
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        color: '#8b949e'
                      }}
                    >
                      اقلام سفارش ثبت نشده
                    </span>
                  )}
                </div>

                {/* TOTAL */}
                <div
                  style={{
                    marginTop: 12,
                    padding: 10,
                    borderRadius: 8,
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    fontSize: 12,
                    lineHeight: 1.9
                  }}
                >
                  <div>
                    جمع سفارش:{' '}
                    <strong style={{ color: '#e2e8f0' }}>
                      {formatPrice(order.subtotal)} تومان
                    </strong>
                  </div>

                  {Number(order.discount_amount || 0) > 0 && (
                    <div>
                      تخفیف:{' '}
                      <strong style={{ color: '#34d399' }}>
                        {formatPrice(order.discount_amount)} تومان
                      </strong>
                    </div>
                  )}

                  <div>
                    مبلغ قابل پرداخت:{' '}
                    <strong style={{ color: '#f59e0b', fontSize: 14 }}>
                      {formatPrice(order.final_amount)} تومان
                    </strong>
                  </div>
                </div>

                {/* DELIVERY FEE */}
                {order.delivery_fee != null && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: '#8b949e'
                    }}
                  >
                    هزینه ارسال:{' '}
                    {Number(
                      order.delivery_fee
                    ) === 0
                      ? 'رایگان 🎉'
                      : `${formatPrice(
                          order.delivery_fee
                        )} تومان`}
                  </div>
                )}

                {/* MESSAGE BUTTON */}
                <div
                  style={{
                    marginTop: 12,
                    display: 'flex',
                    justifyContent: 'flex-start'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => openMessageModal(order)}
                    style={buttonStyle(
                      '#111827',
                      '#fbbf24',
                      '#a16207'
                    )}
                  >
                    💬 پیام به مشتری
                  </button>
                </div>

                {/* STATUS BUTTONS */}
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop:
                      '1px solid #21262d',
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    alignItems: 'center'
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: '#8b949e'
                    }}
                  >
                    تغییر وضعیت:
                  </span>

                  {/* NEW */}
                  <button
                    type="button"
                    disabled={
                      current === 'new' ||
                      isUpdating
                    }
                    onClick={() =>
                      updateStatus(
                        order.id,
                        'new'
                      )
                    }
                    style={buttonStyle(
                      '#3b2f0b',
                      '#fbbf24',
                      '#a16207',
                      current === 'new' ||
                        isUpdating
                    )}
                  >
                    {isUpdating && current !== 'new'
                      ? '⏳'
                      : '📝'}{' '}
                    سفارش جدید
                  </button>

                  {/* PREPARING */}
                  <button
                    type="button"
                    disabled={
                      current ===
                        'preparing' ||
                      isUpdating
                    }
                    onClick={() =>
                      updateStatus(
                        order.id,
                        'preparing'
                      )
                    }
                    style={buttonStyle(
                      '#172554',
                      '#60a5fa',
                      '#2563eb',
                      current ===
                        'preparing' ||
                        isUpdating
                    )}
                  >
                    {isUpdating &&
                    current !==
                      'preparing'
                      ? '⏳'
                      : '☕'}{' '}
                    آماده‌سازی
                  </button>

                  {/* SENT */}
                  <button
                    type="button"
                    disabled={
                      current ===
                        'sent' ||
                      isUpdating
                    }
                    onClick={() =>
                      updateStatus(
                        order.id,
                        'sent'
                      )
                    }
                    style={buttonStyle(
                      '#2e1065',
                      '#c084fc',
                      '#7c3aed',
                      current ===
                        'sent' ||
                        isUpdating
                    )}
                  >
                    {isUpdating &&
                    current !==
                      'sent'
                      ? '⏳'
                      : '🛵'}{' '}
                    ارسال پیک
                  </button>

                  {/* DELIVERED */}
                  <button
                    type="button"
                    disabled={
                      current ===
                        'delivered' ||
                      isUpdating
                    }
                    onClick={() =>
                      updateStatus(
                        order.id,
                        'delivered'
                      )
                    }
                    style={buttonStyle(
                      '#06281e',
                      '#34d399',
                      '#059669',
                      current ===
                        'delivered' ||
                        isUpdating
                    )}
                  >
                    {isUpdating &&
                    current !==
                      'delivered'
                      ? '⏳'
                      : '✅'}{' '}
                    تحویل شد
                  </button>

                  {/* CANCEL */}
                  <button
                    type="button"
                    disabled={
                      current ===
                        'cancelled' ||
                      isUpdating
                    }
                    onClick={() =>
                      updateStatus(
                        order.id,
                        'cancelled'
                      )
                    }
                    style={buttonStyle(
                      '#3f0d16',
                      '#fb7185',
                      '#e11d48',
                      current ===
                        'cancelled' ||
                        isUpdating
                    )}
                  >
                    {isUpdating &&
                    current !==
                      'cancelled'
                      ? '⏳'
                      : '❌'}{' '}
                    لغو
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* =========================
          MESSAGE MODAL
      ========================== */}
      {messageModalOpen && messageCustomer && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
          onMouseDown={e => {
            if (e.target === e.currentTarget) {
              closeMessageModal();
            }
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 16,
              padding: 20,
              boxShadow: '0 20px 60px rgba(0,0,0,.45)'
            }}
            dir="rtl"
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'flex-start',
                marginBottom: 16
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 17,
                    color: '#f8fafc'
                  }}
                >
                  💬 ارسال پیام به مشتری
                </h3>

                <div
                  style={{
                    marginTop: 7,
                    fontSize: 12,
                    lineHeight: 1.8,
                    color: '#94a3b8'
                  }}
                >
                  {messageCustomer.full_name}
                  {messageCustomer.shop_name
                    ? ` — ${messageCustomer.shop_name}`
                    : ''}
                  {messageCustomer.phone
                    ? ` — ${messageCustomer.phone}`
                    : ''}
                </div>
              </div>

              <button
                type="button"
                onClick={closeMessageModal}
                disabled={sendingMessage}
                style={{
                  border: '1px solid #30363d',
                  background: '#0d1117',
                  color: '#c9d1d9',
                  borderRadius: 8,
                  width: 34,
                  height: 34,
                  cursor: 'pointer',
                  fontSize: 18
                }}
              >
                ×
              </button>
            </div>

            <textarea
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder="متن پیام را برای مشتری بنویسید..."
              rows={6}
              disabled={sendingMessage}
              style={{
                width: '100%',
                resize: 'vertical',
                minHeight: 130,
                padding: 12,
                borderRadius: 10,
                border: '1px solid #30363d',
                background: '#0d1117',
                color: '#f8fafc',
                outline: 'none',
                fontFamily: 'Tahoma, Vazirmatn, sans-serif',
                fontSize: 13,
                lineHeight: 1.9
              }}
            />

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 12
              }}
            >
              <button
                type="button"
                onClick={closeMessageModal}
                disabled={sendingMessage}
                style={buttonStyle(
                  '#21262d',
                  '#c9d1d9',
                  '#30363d',
                  sendingMessage
                )}
              >
                انصراف
              </button>

              <button
                type="button"
                onClick={sendMessageToCustomer}
                disabled={sendingMessage || !messageText.trim()}
                style={buttonStyle(
                  '#f59e0b',
                  '#000',
                  '#f59e0b',
                  sendingMessage || !messageText.trim()
                )}
              >
                {sendingMessage
                  ? 'در حال ارسال...'
                  : '📨 ارسال پیام'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================
          MOBILE RESPONSIVE
      ========================== */}
      <style jsx>{`
        @media (max-width: 600px) {
          div {
            box-sizing: border-box;
          }
        }

        button:hover:not(:disabled) {
          opacity: 0.85;
        }

        button:active:not(:disabled) {
          transform: scale(0.98);
        }
      `}</style>
    </div>
  );
}
