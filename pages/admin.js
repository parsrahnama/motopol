// pages/admin.js

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { playDingSound } from '../lib/sound';

const STATUS_MAP = {
  pending: {
    label: 'در انتظار تایید',
    bg: '#3b2f0b',
    fg: '#fbbf24',
    border: '#a16207'
  },
  processing: {
    label: 'در حال آماده‌سازی',
    bg: '#172554',
    fg: '#60a5fa',
    border: '#2563eb'
  },
  out_for_delivery: {
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
  'pending',
  'processing',
  'out_for_delivery',
  'delivered',
  'cancelled'
];

export default function AdminPanel() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [updatingOrderId, setUpdatingOrderId] = useState(null);

  /*
   * دریافت سفارش‌ها
   */
  const fetchOrders = useCallback(async (showRefreshState = false) => {
    if (showRefreshState) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      setOrders(data || []);
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
  }, []);

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
   */
  useEffect(() => {
    let mounted = true;

    fetchOrders();

    const channel = supabase
      .channel('admin_orders_channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders'
        },
        payload => {
          if (!mounted) return;

          /*
           * سفارش جدید
           */
          if (payload.eventType === 'INSERT') {
            setOrders(prev => {
              const exists = prev.some(
                order => order.id === payload.new.id
              );

              if (exists) {
                return prev;
              }

              return [payload.new, ...prev];
            });

            /*
             * فقط اگر صدا فعال باشد
             */
            setSoundEnabled(currentSound => {
              if (currentSound) {
                playDingSound();
              }

              return currentSound;
            });
          }

          /*
           * تغییر سفارش
           */
          else if (payload.eventType === 'UPDATE') {
            setOrders(prev =>
              prev.map(order =>
                order.id === payload.new.id
                  ? payload.new
                  : order
              )
            );

            /*
             * فقط اگر صدا فعال باشد
             */
            setSoundEnabled(currentSound => {
              if (currentSound) {
                playDingSound();
              }

              return currentSound;
            });
          }

          /*
           * حذف سفارش
           */
          else if (payload.eventType === 'DELETE') {
            setOrders(prev =>
              prev.filter(
                order => order.id !== payload.old.id
              )
            );
          }
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') {
          console.error(
            'Realtime channel error'
          );
        }
      });

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

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

      if (error) {
        throw error;
      }

      /*
       * به‌روزرسانی فوری UI
       * حتی قبل از رسیدن Realtime
       */
      if (data) {
        setOrders(prev =>
          prev.map(order =>
            order.id === orderId
              ? data
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
        order.status || 'pending';

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
        (order.status || 'pending') ===
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
      order.status || 'pending';

    return {
      key: status,
      ...(
        STATUS_MAP[status] ||
        STATUS_MAP.pending
      )
    };
  };

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
              order.status || 'pending';

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
                    {order.shop_name ||
                      order.customer_name ||
                      'کافه بدون نام'}
                  </span>

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
                    {order.shop_address ||
                      order.address_note ||
                      'ثبت نشده'}
                  </div>
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
                          {item.name ||
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
                {order.total_price != null && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 10,
                      borderRadius: 8,
                      background:
                        '#0d1117',
                      border:
                        '1px solid #30363d',
                      fontSize: 13,
                      fontWeight: 'bold',
                      color: '#f59e0b'
                    }}
                  >
                    مبلغ کل:{' '}
                    {formatPrice(
                      order.total_price
                    )}{' '}
                    تومان
                  </div>
                )}

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

                  {/* PROCESSING */}
                  <button
                    type="button"
                    disabled={
                      current ===
                        'processing' ||
                      isUpdating
                    }
                    onClick={() =>
                      updateStatus(
                        order.id,
                        'processing'
                      )
                    }
                    style={buttonStyle(
                      '#172554',
                      '#60a5fa',
                      '#2563eb',
                      current ===
                        'processing' ||
                        isUpdating
                    )}
                  >
                    {isUpdating &&
                    current !==
                      'processing'
                      ? '⏳'
                      : '☕'}{' '}
                    آماده‌سازی
                  </button>

                  {/* OUT FOR DELIVERY */}
                  <button
                    type="button"
                    disabled={
                      current ===
                        'out_for_delivery' ||
                      isUpdating
                    }
                    onClick={() =>
                      updateStatus(
                        order.id,
                        'out_for_delivery'
                      )
                    }
                    style={buttonStyle(
                      '#2e1065',
                      '#c084fc',
                      '#7c3aed',
                      current ===
                        'out_for_delivery' ||
                        isUpdating
                    )}
                  >
                    {isUpdating &&
                    current !==
                      'out_for_delivery'
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
