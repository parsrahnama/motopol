import { isSupabaseConfigured } from '../lib/supabase';

// داخل کامپوننت، قبل از fetch کردن منو:
if (!isSupabaseConfigured) {
  return <div style={{padding: 40}}>⚠️ اتصال به دیتابیس تنظیم نشده است — متغیرهای محیطی را چک کنید.</div>;
}

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function MotopolApp() {
  const [activeTab, setActiveTab] = useState('menu');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');
  const [isVip, setIsVip] = useState(false);
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    const { data, error } = await supabase.from('products').select('*').eq('is_active', true);
    if (!error && data) setProducts(data);
  };

  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false });
    if (!error && data) setOrders(data);
  };

  useEffect(() => {
    if (activeTab === 'admin') fetchOrders();
  }, [activeTab]);

  const addToCart = (product) => {
    const existing = cart.find((item) => item.id === product.id);
    if (existing) {
      setCart(cart.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
  };

  const removeFromCart = (productId) => {
    const existing = cart.find((item) => item.id === productId);
    if (existing.quantity === 1) {
      setCart(cart.filter((item) => item.id !== productId));
    } else {
      setCart(cart.map((item) => item.id === productId ? { ...item, quantity: item.quantity - 1 } : item));
    }
  };

  const calculateTotal = () => {
    return cart.reduce((total, item) => {
      const price = isVip && item.vip_price ? item.vip_price : item.base_price;
      return total + price * item.quantity;
    }, 0);
  };

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (!customerPhone || cart.length === 0) return alert('لطفاً شماره تماس و حداقل یک محصول را انتخاب کنید.');

    setLoading(true);

    try {
      let { data: customer } = await supabase.from('customers').select('*').eq('phone', customerPhone).single();
      
      if (!customer) {
        const { data: newCustomer } = await supabase
          .from('customers')
          .insert([{ phone: customerPhone, name: customerName, default_address: address }])
          .select()
          .single();
        customer = newCustomer;
      }

      const totalAmount = calculateTotal();
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert([{
          customer_id: customer.id,
          subtotal: totalAmount,
          final_amount: totalAmount,
          delivery_address: address,
          status: 'new'
        }])
        .select()
        .single();

      if (orderErr) throw orderErr;

      const orderItems = cart.map((item) => ({
        order_id: order.id,
        product_id: item.id,
        product_name: item.name,
        quantity: item.quantity,
        unit_price: isVip && item.vip_price ? item.vip_price : item.base_price,
        total_price: (isVip && item.vip_price ? item.vip_price : item.base_price) * item.quantity
      }));

      await supabase.from('order_items').insert(orderItems);

      alert('سفارش شما با موفقیت ثبت شد! ☕');
      setCart([]);
    } catch (err) {
      alert('خطا در ثبت سفارش: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
    fetchOrders();
  };

  return (
    <div style={{ fontFamily: 'Tahoma, sans-serif', maxWidth: '480px', margin: '0 auto', background: '#f9f9f9', minHeight: '100vh', paddingBottom: '80px' }}>
      <header style={{ background: '#111', color: '#fff', padding: '16px', textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '22px', letterSpacing: '2px' }}>MOTOPOL</h1>
        <p style={{ margin: '4px 0 0', fontSize: '12px', opacity: 0.8 }}>سیستم سفارش‌گیری سریع کافه موتوپل</p>
      </header>

      <div style={{ display: 'flex', borderBottom: '1px solid #ddd', background: '#fff' }}>
        <button 
          onClick={() => setActiveTab('menu')}
          style={{ flex: 1, padding: '12px', border: 'none', background: activeTab === 'menu' ? '#eee' : '#fff', fontWeight: 'bold' }}
        >
          منوی سفارش
        </button>
        <button 
          onClick={() => setActiveTab('admin')}
          style={{ flex: 1, padding: '12px', border: 'none', background: activeTab === 'admin' ? '#eee' : '#fff', fontWeight: 'bold' }}
        >
          پنل مدیریت کافه
        </button>
      </div>

      {activeTab === 'menu' && (
        <main style={{ padding: '16px' }}>
          <h3>منوی محصولات</h3>
          {products.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '12px', marginBottom: '8px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <div>
                <strong style={{ display: 'block' }}>{p.name}</strong>
                <span style={{ fontSize: '12px', color: '#666' }}>{p.category}</span>
                <div style={{ marginTop: '4px', fontSize: '14px' }}>
                  {isVip && p.vip_price ? (
                    <span><s style={{ color: '#888', marginLeft: '6px' }}>{p.base_price.toLocaleString()}</s> <strong style={{ color: 'green' }}>{p.vip_price.toLocaleString()} تومان</strong></span>
                  ) : (
                    <span>{p.base_price.toLocaleString()} تومان</span>
                  )}
                </div>
              </div>
              <button onClick={() => addToCart(p)} style={{ background: '#111', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>
                + افزودن
              </button>
            </div>
          ))}

          {cart.length > 0 && (
            <section style={{ marginTop: '24px', background: '#fff', padding: '16px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <h4>سبد خرید شما</h4>
              {cart.map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span>{item.name} (x{item.quantity})</span>
                  <div>
                    <button onClick={() => removeFromCart(item.id)} style={{ margin: '0 4px' }}>-</button>
                    <button onClick={() => addToCart(item)} style={{ margin: '0 4px' }}>+</button>
                  </div>
                </div>
              ))}
              <hr />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', margin: '12px 0' }}>
                <span>مبلغ قابل پرداخت:</span>
                <span>{calculateTotal().toLocaleString()} تومان</span>
              </div>

              <form onSubmit={handlePlaceOrder}>
                <input 
                  type="text" 
                  placeholder="شماره موبایل (مخصوص ثبت سفارش)" 
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  required
                  style={{ width: '100%', padding: '10px', marginBottom: '8px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                />
                <input 
                  type="text" 
                  placeholder="نام شما (اختیاری)" 
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  style={{ width: '100%', padding: '10px', marginBottom: '8px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                />
                <input 
                  type="text" 
                  placeholder="آدرس تحویل / شماره میز" 
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  style={{ width: '100%', padding: '10px', marginBottom: '12px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                />
                <button type="submit" disabled={loading} style={{ width: '100%', background: 'green', color: '#fff', border: 'none', padding: '12px', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold' }}>
                  {loading ? 'در حال ثبت...' : 'تأیید و ثبت نهایی سفارش'}
                </button>
              </form>
            </section>
          )}
        </main>
      )}

      {activeTab === 'admin' && (
        <main style={{ padding: '16px' }}>
          <h3>لیست سفارش‌های جدید موتوپل</h3>
          {orders.length === 0 ? <p>هیچ سفارشی ثبت نشده است.</p> : orders.map((order) => (
            <div key={order.id} style={{ background: '#fff', padding: '12px', marginBottom: '12px', borderRadius: '8px', borderLeft: '4px solid #111' }}>
              <div><strong>شناسه سفارش:</strong> {order.id.slice(0, 8)}...</div>
              <div><strong>مبلغ:</strong> {order.final_amount.toLocaleString()} تومان</div>
              <div><strong>وضعیت:</strong> <span style={{ fontWeight: 'bold', color: 'blue' }}>{order.status}</span></div>
              <div style={{ marginTop: '8px' }}>
                <button onClick={() => updateOrderStatus(order.id, 'preparing')} style={{ marginLeft: '4px' }}>در حال آماده‌سازی</button>
                <button onClick={() => updateOrderStatus(order.id, 'delivered')} style={{ marginLeft: '4px' }}>تحویل داده شد</button>
              </div>
            </div>
          ))}
        </main>
      )}
    </div>
  );
}
