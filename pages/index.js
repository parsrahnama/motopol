import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { supabase } from '../lib/supabase';

const STEPS = [
  { key: 'pending', label: 'ثبت سفارش', icon: '📝' },
  { key: 'processing', label: 'آماده‌سازی', icon: '☕' },
  { key: 'out_for_delivery', label: 'پیک در مسیر', icon: '🛵' },
  { key: 'delivered', label: 'تحویل شد', icon: '✅' }
];

export default function MotopolApp() {
  const [customer, setCustomer] = useState(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [authStep, setAuthStep] = useState('checking');
  const [regData, setRegData] = useState({
    fullName: '', phone: '', shopName: '', shopAddress: '', addressNotes: ''
  });
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('همه');
  const [cart, setCart] = useState([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [lastOrder, setLastOrder] = useState(null);
  const [activeTab, setActiveTab] = useState('menu');
  const [submitting, setSubmitting] = useState(false);
  const orderChannel = useRef(null);

  useEffect(() => {
    initializeApp();
  }, []);

  async function initializeApp() {
    const storedPhone = localStorage.getItem('motopol_phone');
    if (storedPhone) {
      setPhoneInput(storedPhone);
      await checkCustomer(storedPhone);
    } else {
      setAuthStep('login');
    }
  }

  async function checkCustomer(phone) {
    setAuthStep('checking');
    try {
      const { data, error } = await supabase.from('customers').select('*').eq('phone', phone).single();
      if (data) {
        setCustomer(data);
        setAuthStep('app');
        await fetchLastOrder(phone);
        localStorage.setItem('motopol_phone', phone);
      } else {
        setAuthStep('register');
      }
      if (error) throw error;
    } catch (e) {
      console.error("Error checking customer:", e);
      setAuthStep('login');
    }
  }

  async function refreshCustomerData(phone) {
    try {
      const { data, error } = await supabase.from('customers').select('*').eq('phone', phone).single();
      if (error) throw error;
      setCustomer(data);
      setAuthStep('app');
      await fetchLastOrder(phone);
    } catch (e) {
      console.error("Error refreshing customer data:", e);
      setAuthStep('login');
    }
  }

  async function fetchLastOrder(phone) {
    try {
      const { data, error } = await supabase.from('orders').select('*')
        .eq('phone', phone)
        .in('status', ['pending', 'processing', 'out_for_delivery'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setLastOrder(data);
      if (data) {
        setActiveTab('track');
        subscribeToOrderUpdates(data.id);
      } else {
        setLastOrder(null);
      }
    } catch (err) {
      console.error("Error fetching last order:", err);
    }
  }

  async function fetchProducts() {
    setLoadingMenu(true);
    try {
      const { data, error } = await supabase.from('products').select('*').eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setProducts(data);
      setCategories(['همه', ...new Set(data.map(p => p.category).filter(Boolean))]);
    } catch (err) {
      console.error("Error fetching products:", err);
    } finally {
      setLoadingMenu(false);
    }
  }

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!phoneInput.trim()) {
      alert('لطفاً شماره موبایل معتبر وارد کنید.');
      return;
    }
    setSubmitting(true);
    try {
      await checkCustomer(phoneInput.trim());
    } catch (e) {
      alert('خطا در ورود: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!regData.fullName || !regData.phone || !regData.shopName || !regData.shopAddress) {
      alert('لطفاً تمام اطلاعات خواسته شده را تکمیل کنید.');
      return;
    }
    setSubmitting(true);
    try {
      const { data: existingCustomer, error: checkError } = await supabase.from('customers').select('*').eq('phone', regData.phone).single();
      if (checkError) throw checkError;

      if (existingCustomer) {
        setCustomer(existingCustomer);
        setAuthStep('app');
        await fetchLastOrder(regData.phone);
        localStorage.setItem('motopol_phone', regData.phone);
      } else {
        const { data, error } = await supabase.from('customers').insert([{
          phone: regData.phone,
          full_name: regData.fullName,
          shop_name: regData.shopName,
          shop_address: regData.shopAddress,
          address_notes: regData.addressNotes,
          is_vip: false,
          order_count: 0,
          total_spent: 0
        }]).select().single();
        if (error) throw error;
        setCustomer(data);
        setAuthStep('app');
        await fetchLastOrder(data.phone);
        localStorage.setItem('motopol_phone', data.phone);
      }
    } catch (e) {
      alert('خطا در ثبت‌نام: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const addToCart = (product) => {
    setCart(prevCart => {
      const existingItemIndex = prevCart.findIndex(item => item.id === product.id);
      if (existingItemIndex > -1) {
        const newCart = [...prevCart];
        newCart[existingItemIndex].quantity += 1;
        return newCart;
      } else {
        return [...prevCart, { ...product, quantity: 1, final_price: product.price }];
      }
    });
  };

  const updateCartQuantity = (productId, quantity) => {
    setCart(prevCart => {
      if (quantity <= 0) {
        return prevCart.filter(item => item.id !== productId);
      }
      return prevCart.map(item =>
        item.id === productId ? { ...item, quantity: quantity, final_price: item.price * quantity } : item
      );
    });
  };

  const grandTotal = cart.reduce((total, item) => total + item.final_price, 0);
  const isFreeDelivery = cart.length >= 2;
  const deliveryFee = isFreeDelivery ? 0 : 15000;

  const handlePlaceOrder = async () => {
    if (!customer) return;
    if (cart.length === 0) {
      alert('سبد خرید شما خالی است.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.from('orders').insert([{
        customer_id: customer.id,
        customer_name: customer.full_name,
        shop_name: customer.shop_name,
        phone: customer.phone,
        shop_address: customer.shop_address + (customer.address_notes ? ` (${customer.address_notes})` : ''),
        items: cart.map(({ final_price, ...rest }) => rest), // Save base product info without final_price
        total_price: grandTotal,
        delivery_fee: deliveryFee,
        status: 'pending'
      }]).select().single();

      if (error) throw error;

      await supabase.from('customers').update({
        order_count: (customer.order_count | 0) + 1,
        total_spent: Number(customer.total_spent | 0) + grandTotal
      }).eq('id', customer.id);

      setLastOrder(data);
      setCart([]);
      setActiveTab('track');
      subscribeToOrderUpdates(data.id);

    } catch (e) {
      alert('خطا در ثبت سفارش: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const subscribeToOrderUpdates = (orderId) => {
    if (orderChannel.current) {
      supabase.removeChannel(orderChannel.current);
    }
    orderChannel.current = supabase.channel(`order_track_${orderId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          setLastOrder(payload.new);
          if (payload.new.status === 'delivered') {
            // Optionally unsubscribe after delivery
            // supabase.removeChannel(orderChannel.current);
          }
        }
      )
      .subscribe();
  };

  useEffect(() => {
    if (lastOrder) {
      fetchProducts(); // Fetch products once when app loads if lastOrder exists (user is logged in)
    }
  }, [lastOrder]); // Depend on lastOrder to ensure products load after auth

  // Log out function
  const handleLogout = () => {
    localStorage.removeItem('motopol_phone');
    setCustomer(null);
    setLastOrder(null);
    setCart([]);
    setActiveTab('menu');
    setAuthStep('login');
    if (orderChannel.current) {
      supabase.removeChannel(orderChannel.current);
      orderChannel.current = null;
    }
  };

  const inputStyle = {
    width: '100%', padding: '14px', borderRadius: '10px',
    backgroundColor: '#1e293b', border: '1px solid #334155', color: '#fff', marginBottom: '10px'
  };

  const filteredProducts = activeCategory === 'همه'
    ? products
    : products.filter(p => p.category === activeCategory);

  return (
    <div className="motopol-container">
      <Head>
        <title>موتوپل | سفارش سریع قهوه</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" />
      </Head>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background-color: #0b0f19;
          color: #f8fafc;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Vazirmatn, sans-serif;
          direction: rtl;
        }
        .motopol-container {
          min-height: 100vh;
          max-width: 500px;
          margin: 0 auto;
          background-color: #0f172a;
          position: relative;
          padding-bottom: 80px;
        }
        .btn-gold {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: #0f172a;
          font-weight: 700;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          padding: 12px 24px;
          font-size: 16px;
          transition: transform 0.2s;
        }
        .btn-gold:hover {
          transform: translateY(-2px);
        }
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 16px;
          padding: 20px;
          margin-bottom: 15px;
        }
        .hide-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        input[type="text"], input[type="tel"] {
            ${inputStyle}
        }
        button {
            ${inputStyle}
            padding: 14px 24px;
            font-size: 16px;
            text-align: center;
            margin-top: 10px;
        }
        .tab-button {
            padding: 10px 15px;
            border: none;
            background-color: transparent;
            color: #94a3b8;
            font-size: 16px;
            cursor: pointer;
            transition: color 0.3s, border-bottom 0.3s;
            border-bottom: 2px solid transparent;
        }
        .tab-button.active {
            color: #fff;
            border-bottom: 2px solid #f59e0b;
            font-weight: bold;
        }
        .product-card .buy-button {
            background-color: #22c55e; /* Green */
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
            transition: background-color 0.2s;
        }
        .product-card .buy-button:hover {
            background-color: #16a34a;
        }
        .vip-price {
            color: #eab308; /* Amber */
            font-size: 14px;
            text-decoration: line-through;
            margin-left: 8px;
        }
        .cart-item-remove {
             background-color: #ef4444; /* Red */
             color: white;
             border: none;
             padding: 4px 8px;
             border-radius: 6px;
             cursor: pointer;
             font-size: 12px;
        }
      `}</style>

      {(authStep === 'login' || authStep === 'checking') && (
        <div className="flex flex-col items-center justify-center h-screen p-4">
          <img src="/motopol-logo.png" alt="Motopol Logo" className="w-32 mb-6" />
          <h1 className="text-2xl font-bold mb-2">موتوپل</h1>
          <p className="text-gray-400 text-center mb-6">سفارش سریع قهوه</p>
          <form onSubmit={handleLoginSubmit} className="w-full">
            <input
              type="tel"
              placeholder="شماره موبایل (مثال: 09121234567)"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              required
              style={inputStyle}
            />
            <button type="submit" className="btn-gold w-full" disabled={submitting}>
              {submitting ? 'در حال بررسی...' : 'ورود و مشاهده منو 🚀'}
            </button>
          </form>
          <p className="text-gray-400 mt-4">
            حساب کاربری ندارید؟{' '}
            <button onClick={() => setAuthStep('register')} className="text-amber-500 font-semibold">
              ثبت‌نام کنید
            </button>
          </p>
        </div>
      )}

      {authStep === 'register' && (
        <div className="p-4 pt-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">ثبت عضویت در موتوپل ✨</h2>
            <button onClick={handleLogout} className="text-red-500 font-semibold">لغو</button>
          </div>
          <p className="text-gray-400 mb-6">فقط همین یک‌بار اطلاعات مغازه را وارد کنید.</p>
          <form onSubmit={handleRegisterSubmit}>
            <input type="text" placeholder="نام و نام خانوادگی" value={regData.fullName} onChange={(e) => setRegData({ ...regData, fullName: e.target.value })} required style={inputStyle} />
            <input type="tel" placeholder="شماره موبایل" value={regData.phone} onChange={(e) => setRegData({ ...regData, phone: e.target.value })} required style={inputStyle} />
            <input type="text" placeholder="نام مغازه / فروشگاه" value={regData.shopName} onChange={(e) => setRegData({ ...regData, shopName: e.target.value })} required style={inputStyle} />
            <input type="text" placeholder="آدرس دقیق" value={regData.shopAddress} onChange={(e) => setRegData({ ...regData, shopAddress: e.target.value })} required style={inputStyle} />
            <input type="text" placeholder="توضیحات تحویل (اختیاری)" value={regData.addressNotes} onChange={(e) => setRegData({ ...regData, addressNotes: e.target.value })} style={inputStyle} />
            <button type="submit" className="btn-gold w-full" disabled={submitting}>
              {submitting ? 'در حال ثبت...' : 'ثبت و شروع'}
            </button>
          </form>
        </div>
      )}

      {authStep === 'app' && customer && (
        <div>
          <div className="sticky top-0 bg-[#0f172a] z-10 p-4 flex items-center justify-between border-b border-gray-700">
             <button onClick={handleLogout} className="text-red-500 font-semibold">خروج</button>
            <div className="flex items-center space-x-4">
              <button onClick={() => setActiveTab('menu')} className={`tab-button ${activeTab === 'menu' ? 'active' : ''}`}>منو</button>
              <button onClick={() => setActiveTab('cart')} className={`tab-button ${activeTab === 'cart' ? 'active' : ''}`}>سبد خرید ({cart.length})</button>
              <button onClick={() => setActiveTab('track')} className={`tab-button ${activeTab === 'track' ? 'active' : ''}`}>پیگیری</button>
              <button onClick={() => setActiveTab('profile')} className={`tab-button ${activeTab === 'profile' ? 'active' : ''}`}>پروفایل</button>
            </div>
          </div>

          <div className="p-4">
            {activeTab === 'menu' && (
              <div>
                <div className="flex space-x-2 mb-4 overflow-x-auto hide-scrollbar">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`tab-button ${activeCategory === cat ? 'active' : ''} flex-shrink-0`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {loadingMenu ? (
                  <div className="flex justify-center items-center h-64">
                    <p>در حال آماده‌سازی منو...</p>
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">
                    محصولی در این دسته یافت نشد.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {filteredProducts.map((p) => {
                      const countInCart = cart.find(item => item.id === p.id)?.quantity || 0;
                      const isVipPrice = customer?.is_vip && p.vip_price;
                      return (
                        <div key={p.id} className="card product-card">
                          <h3 className="text-lg font-semibold mb-1">{p.name}</h3>
                          {p.description && <p className="text-gray-400 text-sm mb-2">{p.description}</p>}
                          <div className="flex items-center justify-between mt-3">
                            <div>
                              {isVipPrice && (
                                <span className="vip-price">
                                  {Number(p.price).toLocaleString('fa-IR')} ت
                                </span>
                              )}
                              <span className="text-lg font-bold">
                                {(isVipPrice ? p.vip_price : p.price).toLocaleString('fa-IR')} ت
                              </span>
                            </div>
                            <button onClick={() => addToCart(p)} className="buy-button">
                              {countInCart === 0 ? 'افزودن' : `${countInCart} عدد`}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'cart' && (
              <div>
                <h2 className="text-2xl font-bold mb-4">سبد خرید</h2>
                {cart.length === 0 ? (
                  <p className="text-center py-10 text-gray-500">سبد شما خالی است ☕</p>
                ) : (
                  <div>
                    {cart.map((item) => (
                      <div key={item.id} className="card flex items-center justify-between mb-3">
                        <div>
                          <h3 className="font-semibold">{item.name}</h3>
                          <p className="text-sm text-gray-400">
                            {item.quantity} × {item.price.toLocaleString('fa-IR')} ت
                          </p>
                        </div>
                        <div className="flex items-center">
                          <button
                            onClick={() => updateCartQuantity(item.id, item.quantity - 1)}
                            className="bg-red-600 text-white px-2 py-1 rounded mr-2"
                          >
                            -
                          </button>
                          <span className="font-bold mx-2">{item.quantity}</span>
                          <button
                            onClick={() => updateCartQuantity(item.id, item.quantity + 1)}
                            className="bg-green-600 text-white px-2 py-1 rounded mr-2"
                          >
                            +
                          </button>
                           <button
                            onClick={() => updateCartQuantity(item.id, 0)} // Remove item
                            className="cart-item-remove"
                           >
                            حذف
                           </button>
                        </div>
                      </div>
                    ))}
                    <div className="mt-6 p-4 card">
                      <p className="flex justify-between mb-2">
                        <span>هزینه ارسال:</span>
                        <span>{isFreeDelivery ? 'رایگان (۲+ آیتم) 🎉' : deliveryFee.toLocaleString('fa-IR') + ' تومان'}</span>
                      </p>
                      <p className="flex justify-between font-bold text-lg mt-3 pt-3 border-t border-gray-700">
                        <span>مبلغ قابل پرداخت:</span>
                        <span>{grandTotal.toLocaleString('fa-IR')} تومان</span>
                      </p>
                      <button onClick={handlePlaceOrder} className="btn-gold w-full mt-4" disabled={submitting}>
                        {submitting ? 'در حال ثبت سفارش...' : 'ثبت سفارش نهایی'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'track' && (
              <div>
                <h2 className="text-2xl font-bold mb-4">پیگیری سفارش</h2>
                {!lastOrder ? (
                  <p className="text-center py-10 text-gray-500">فعلاً سفارش فعالی ندارید ☕</p>
                ) : (
                  <div className="card">
                    <div className="flex justify-between items-center mb-4">
                      <p className="text-lg font-semibold">سفارش #{String(lastOrder.id).slice(0, 8)}</p>
                      <p className={`font-bold ${lastOrder.status === 'delivered' ? 'text-green-500' : lastOrder.status === 'cancelled' ? 'text-red-500' : 'text-amber-500'}`}>
                        {STEPS.find(s => s.key === lastOrder.status)?.label || 'وضعیت نامشخص'}
                      </p>
                    </div>
                    <div className="flex justify-between items-center mb-4">
                      <p>تاریخ: {new Date(lastOrder.created_at).toLocaleString('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false })}</p>
                      <p>هزینه ارسال: {lastOrder.delivery_fee ? lastOrder.delivery_fee.toLocaleString('fa-IR') + ' تومان' : 'رایگان'}</p>
                    </div>

                    <div className="relative">
                      <div className="flex justify-between items-center mb-1">
                        {STEPS.map((step, idx) => {
                          const isCompleted = ['delivered', 'cancelled'].includes(lastOrder.status) ? step.key === lastOrder.status || STEPS.findIndex(s => s.key === lastOrder.status) > idx : step.key === lastOrder.status;
                          const isCurrent = step.key === lastOrder.status;
                          const isFuture = STEPS.findIndex(s => s.key === lastOrder.status) < idx;
                          const isDeliveredOrCancelled = ['delivered', 'cancelled'].includes(lastOrder.status);

                          return (
                            <div key={step.key} className={`flex flex-col items-center relative ${isFuture ? 'opacity-50' : ''}`}>
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl mb-1 transition-all duration-500 ${isDeliveredOrCancelled ? (step.key === lastOrder.status ? 'bg-green-500' : (lastOrder.status === 'delivered' && STEPS.findIndex(s => s.key === lastOrder.status) > idx ? 'bg-green-500' : 'bg-red-500')) : (isCurrent ? 'bg-amber-500 animate-pulse' : (isCompleted ? 'bg-green-500' : 'bg-gray-700'))}`}>
                                {step.icon}
                              </div>
                              <p className={`text-xs w-20 text-center ${isDeliveredOrCancelled ? (step.key === lastOrder.status ? 'text-green-500' : (lastOrder.status === 'delivered' && STEPS.findIndex(s => s.key === lastOrder.status) > idx ? 'text-green-500' : 'text-red-500')) : (isCurrent ? 'text-amber-500' : (isCompleted ? 'text-green-500' : 'text-gray-500'))}`}>
                                {step.label}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      {/* Progress Line */}
                      <div className="absolute top-1/2 left-0 right-0 h-1 -translate-y-1/2 bg-gray-700 -z-10" style={{ marginTop: '6px' }}>
                        <div
                          className="h-full bg-green-500 transition-all duration-500"
                          style={{
                            width: `${Math.max(0, STEPS.findIndex(s => s.key === lastOrder.status) + (lastOrder.status === 'delivered' ? 1 : 0)) / (STEPS.length -1) * 100}%`,
                            backgroundColor: lastOrder.status === 'cancelled' ? '#ef4444' : '#16a34a' // Red if cancelled, Green otherwise
                          }}
                        />
                      </div>
                    </div>

                    <p className="text-sm text-gray-400 mt-6">اقلام سفارش:</p>
                    {lastOrder.items.map((it, i) => (
                      <div key={i} className="flex justify-between items-center text-sm py-1">
                        <span>{it.name}</span>
                        <span>{it.quantity} × {it.price.toLocaleString('fa-IR')} ت</span>
                      </div>
                    ))}
                    <p className="flex justify-between font-bold mt-3 pt-3 border-t border-gray-700">
                      <span>مبلغ کل:</span>
                      <span>{Number(lastOrder.total_price).toLocaleString('fa-IR')} تومان</span>
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="card">
                <h2 className="text-2xl font-bold mb-4">پروفایل</h2>
                <p className="text-lg font-semibold">{customer.full_name}</p>
                <p className="text-gray-400 mb-2">{customer.shop_name}</p>
                <p className="text-gray-400 mb-4">{customer.phone}</p>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-sm text-gray-400">تعداد سفارش‌ها</p>
                    <p className="font-bold text-xl">{customer.order_count | 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">مجموع خرید</p>
                    <p className="font-bold text-xl">{Number(customer.total_spent | 0).toLocaleString('fa-IR')} ت</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 bg-[#0f172a] z-10 p-4 border-t border-gray-700 flex justify-center">
            <button onClick={handlePlaceOrder} className="btn-gold" disabled={submitting || cart.length === 0}>
              {submitting ? 'در حال پردازش...' : `ثبت سفارش (${grandTotal.toLocaleString('fa-IR')} تومان)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
