import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import { useRouter } from 'next/router'; // import router

// Constants for tracking steps
const STEPS = [
  { key: 'pending', label: 'ثبت سفارش', icon: '📝' },
  { key: 'processing', label: 'آماده‌سازی', icon: '☕' },
  { key: 'out_for_delivery', label: 'پیک در مسیر', icon: '🛵' },
  { key: 'delivered', label: 'تحویل شد', icon: '✅' }
];

export default function MotopolApp() {
  const router = useRouter(); // Initialize router
  const [customer, setCustomer] = useState(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [authStep, setAuthStep] = useState('checking'); // 'checking', 'login', 'register', 'app'

  // Registration State
  const [regData, setRegData] = useState({
    fullName: '',
    phone: '',
    shopName: '',
    shopAddress: '',
    addressNotes: ''
  });

  // App & Menu State
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('همه');
  const [cart, setCart] = useState([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [orderSuccess, setOrderSuccess] = useState(null); // For showing success message in menu tab
  const [lastOrder, setLastOrder] = useState(null); // To store the last active order for tracking
  const [activeTab, setActiveTab] = useState('menu'); // 'menu', 'cart', 'profile', 'track'
  const [submitting, setSubmitting] = useState(false);
  const orderChannel = useRef(null); // Ref to hold the Supabase channel

  useEffect(() => {
    const initializeApp = async () => {
      // 1. Check local storage for customer session
      const savedCustomer = localStorage.getItem('motopol_customer');
      if (savedCustomer) {
        try {
          const parsed = JSON.parse(savedCustomer);
          await refreshCustomerData(parsed.phone);
        } catch (e) {
          setAuthStep('login');
        }
      } else {
        setAuthStep('login');
      }
      await fetchProducts();
    };
    initializeApp();
  }, []);

  // Function to fetch customer data and set state
  async function refreshCustomerData(phone) {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('phone', phone)
        .single();

      if (data && !error) {
        setCustomer(data);
        localStorage.setItem('motopol_customer', JSON.stringify(data));
        setAuthStep('app');

        // Fetch last active order for the tracking tab
        await fetchLastOrder(phone);
      } else {
        setAuthStep('login');
      }
    } catch (e) {
      console.error("Error fetching customer data:", e);
      setAuthStep('login');
    }
  }

  // Function to fetch the last active order
  async function fetchLastOrder(phone) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('phone', phone)
        .in('status', ['pending', 'processing', 'out_for_delivery'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setLastOrder(data);
        setActiveTab('track'); // Automatically go to track tab if there's an active order
      } else {
        setLastOrder(null);
      }
    } catch (err) {
      console.error("Error fetching last order:", err);
    }
  }

  // Fetch products and categories
  async function fetchProducts() {
    setLoadingMenu(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (!error && data) {
        setProducts(data);
        const cats = ['همه', ...new Set(data.map(p => p.category).filter(Boolean))];
        setCategories(cats);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMenu(false);
    }
  }

  // Handle login with phone number
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!phoneInput || phoneInput.length < 10) {
      alert('لطفاً شماره موبایل معتبر وارد کنید.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('phone', phoneInput.trim())
        .single();

      if (data && !error) {
        setCustomer(data);
        localStorage.setItem('motopol_customer', JSON.stringify(data));
        setAuthStep('app');
        await fetchLastOrder(phoneInput.trim()); // Fetch last order after login
      } else {
        setRegData(prev => ({ ...prev, phone: phoneInput.trim() }));
        setAuthStep('register');
      }
    } catch (err) {
      console.error("Login error:", err);
      alert('خطا در ورود: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle new customer registration
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.from('customers').insert([
        {
          phone: regData.phone,
          full_name: regData.fullName,
          shop_name: regData.shopName,
          shop_address: regData.shopAddress,
          address_notes: regData.addressNotes,
          is_vip: false,
          order_count: 0,
          total_spent: 0
        }
      ]).select().single();

      if (error) throw error;

      setCustomer(data);
      localStorage.setItem('motopol_customer', JSON.stringify(data));
      setAuthStep('app');
      // No need to fetchLastOrder here as it's a new customer
    } catch (err) {
      console.error("Registration error:", err);
      alert('خطا در ثبت‌نام: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Get product price based on customer VIP status
  const getProductPrice = (item) => {
    if (customer?.is_vip && item.vip_price) {
      return Number(item.vip_price);
    }
    return Number(item.base_price) || 0;
  };

  // Add item to cart
  const addToCart = (product) => {
    setCart((prev) => {
      const exist = prev.find((i) => i.id === product.id);
      const price = getProductPrice(product);
      if (exist) {
        return prev.map((i) => (i.id === product.id ? { ...i, quantity: i.quantity + 1, final_price: price } : i));
      }
      return [...prev, { ...product, final_price: price, quantity: 1 }];
    });
  };

  // Remove item from cart
  const removeFromCart = (productId) => {
    setCart((prev) => {
      const exist = prev.find((i) => i.id === productId);
      if (exist && exist.quantity > 1) {
        const price = getProductPrice(exist);
        return prev.map((i) => (i.id === productId ? { ...i, quantity: i.quantity - 1, final_price: price } : i));
      }
      return prev.filter((i) => i.id !== productId);
    });
  };

  const totalItemsCount = cart.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.final_price || getProductPrice(item)) * item.quantity, 0);
  const isFreeDelivery = totalItemsCount >= 2; // Free delivery for 2 or more items

  // Handle final order submission and redirect to track tab
  const handleFinalOrder = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.from('orders').insert([
        {
          customer_id: customer.id,
          customer_name: customer.full_name,
          shop_name: customer.shop_name,
          phone: customer.phone,
          shop_address: customer.shop_address + (customer.address_notes ? ` (${customer.address_notes})` : ''),
          items: cart,
          total_price: totalPrice,
          delivery_fee: isFreeDelivery ? 0 : 15000,
          status: 'pending'
        }
      ]).select().single(); // Select to get the inserted order data, including ID

      if (error) throw error;

      // Update customer's order count and total spent
      await supabase.from('customers').update({
        order_count: (customer.order_count || 0) + 1,
        total_spent: Number(customer.total_spent || 0) + totalPrice
      }).eq('id', customer.id);

      setLastOrder(data);        // Set the newly created order
      setOrderSuccess(false);    // Reset order success message
      setActiveTab('track');     // Switch to the track tab
      setCart([]);               // Clear the cart
    } catch (err) {
      console.error("Order submission error:", err);
      alert('خطا در ثبت سفارش: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Effect to subscribe to real-time updates for the last order
  useEffect(() => {
    // Unsubscribe from previous channel if it exists
    if (orderChannel.current) {
      supabase.removeChannel(orderChannel.current);
    }

    if (lastOrder?.id) {
      // Subscribe to changes for the specific last order
      orderChannel.current = supabase
        .channel(`order_track_${lastOrder.id}`)
        .on('postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders',
            filter: `id=eq.${lastOrder.id}`
          },
          (payload) => {
            setLastOrder(payload.new); // Update lastOrder state with new data
            // Optionally play ding sound for status updates
            // if (payload.new.status !== payload.old.status) {
            //   playDingSound();
            // }
          }
        )
        .subscribe();
    }

    // Cleanup function to unsubscribe when component unmounts or lastOrder changes
    return () => {
      if (orderChannel.current) {
        supabase.removeChannel(orderChannel.current);
      }
    };
  }, [lastOrder?.id]); // Re-run effect when lastOrder ID changes

  // Filter products based on active category
  const filteredProducts = activeCategory === 'همه'
    ? products
    : products.filter((p) => p.category === activeCategory);

  // Logout function
  const handleLogout = () => {
    localStorage.removeItem('motopol_customer');
    setCustomer(null);
    setAuthStep('login');
    setLastOrder(null); // Clear last order on logout
    setCart([]);
    setActiveTab('menu');
  };

  return (
    <div className="motopol-container">
      <Head>
        <title>موتوپل | سفارش سریع قهوه</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </Head>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background-color: #0b0f19;
          color: #f8fafc;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Vazirmatn", sans-serif;
          direction: rtl;
        }
        .motopol-container {
          min-height: 100vh;
          max-width: 500px;
          margin: 0 auto;
          background-color: #0f172a;
          position: relative;
          padding-bottom: 80px; /* Space for the nav bar */
          box-shadow: 0 0 40px rgba(0,0,0,0.6);
        }
        .btn-gold {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: #0f172a;
          font-weight: 700;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: transform 0.1s ease;
        }
        .btn-gold:active { transform: scale(0.98); }
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 16px;
        }
        /* Hide scrollbar for mobile */
        .hide-scrollbar {
          scrollbar-width: none; /* Firefox */
          -ms-overflow-style: none;  /* Internet Explorer 10+ */
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none; /* Safari and Chrome */
        }
      `}</style>

      {/* STEP 1: Quick Login Form (Phone Only) */}
      {authStep === 'login' && (
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '10px' }}>☕</div>
          <h1 style={{ color: '#f59e0b', fontSize: '1.8rem', fontWeight: 800 }}>کافه موتوپل</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '6px' }}>سفارش مستقیم و بی‌معطلی قهوه به محل کار شما</p>

          <form onSubmit={handleLoginSubmit} style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ textAlign: 'right' }}>
              <label style={{ fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '6px', display: 'block' }}>شماره موبایل خود را وارد کنید:</label>
              <input
                type="tel"
                placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                required
                style={{
                  width: '100%', padding: '16px', borderRadius: '12px',
                  backgroundColor: '#1e293b', border: '1px solid #475569', color: '#fff',
                  fontSize: '1.2rem', textAlign: 'center', letterSpacing: '2px'
                }}
              />
            </div>
            <button type="submit" disabled={submitting} className="btn-gold" style={{ padding: '16px', fontSize: '1rem', marginTop: '10px' }}>
              {submitting ? 'در حال بررسی...' : 'ورود و مشاهده منو 🚀'}
            </button>
          </form>
        </div>
      )}

      {/* STEP 2: One-time Registration */}
      {authStep === 'register' && (
        <div style={{ padding: '28px 20px' }}>
          <h2 style={{ color: '#f59e0b', fontSize: '1.4rem', marginBottom: '6px' }}>ثبت عضویت در موتوپل ✨</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '24px' }}>فقط همین یک‌بار اطلاعات مغازه را وارد کنید تا سفارش‌های بعدی ۳ کلیکه ثبت شوند.</p>

          <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <input type="text" placeholder="نام و نام خانوادگی" value={regData.fullName} onChange={(e) => setRegData({ ...regData, fullName: e.target.value })} required style={{ padding: '14px', borderRadius: '10px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#fff' }} />
            <input type="text" placeholder="نام مغازه / فروشگاه / واحد" value={regData.shopName} onChange={(e) => setRegData({ ...regData, shopName: e.target.value })} required style={{ padding: '14px', borderRadius: '10px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#fff' }} />
            <input type="text" placeholder="آدرس دقیق (مثلاً پاساژ ملت، طبقه ۱، پلاک ۲۳)" value={regData.shopAddress} onChange={(e) => setRegData({ ...regData, shopAddress: e.target.value })} required style={{ padding: '14px', borderRadius: '10px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#fff' }} />
            <input type="text" placeholder="توضیحات تکمیلی تحویل (اختیاری)" value={regData.addressNotes} onChange={(e) => setRegData({ ...regData, addressNotes: e.target.value })} style={{ padding: '14px', borderRadius: '10px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#fff' }} />
            <button type="submit" disabled={submitting} className="btn-gold" style={{ padding: '16px', fontSize: '1rem', marginTop: '10px' }}>
              {submitting ? 'در حال ثبت اطلاعات...' : 'ثبت و شروع سفارش ☕'}
            </button>
          </form>
        </div>
      )}

      {/* STEP 3: Main App Interface (Customer Authenticated) */}
      {authStep === 'app' && customer && (
        <>
          {/* Header */}
          <header style={{ padding: '16px 20px', backgroundColor: '#161f30', borderBottom: '1px solid #22314d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>سلام {customer.full_name.split(' ')[0]} 👋</span>
                {customer.is_vip && <span style={{ backgroundColor: '#f59e0b', color: '#000', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', fontWeight: 800 }}>VIP</span>}
              </div>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>تحویل به: <strong style={{ color: '#cbd5e1' }}>{customer.shop_name}</strong></p>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '0.85rem', color: '#f59e0b', fontWeight: 700 }}>کافه موتوپل</div>
              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>motopol.ir</span>
            </div>
          </header>

          {orderSuccess && ( // This message appears briefly after order placement in the menu tab
            <div style={{ margin: '16px', padding: '14px', backgroundColor: '#065f46', border: '1px solid #10b981', borderRadius: '12px', textAlign: 'center' }}>
              🎉 سفارش شما ثبت و تحویل باریستای موتوپل شد! به زودی ارسال می‌شود.
            </div>
          )}

          {/* TAB 1: Menu & Quick Order */}
          {activeTab === 'menu' && (
            <div style={{ padding: '16px' }}>
              {/* Category Tabs */}
              <div className="hide-scrollbar" style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '10px', marginBottom: '14px' }}>
                {categories.map((cat) => (
                  <button
                    key={cat} onClick={() => setActiveCategory(cat)}
                    style={{
                      padding: '8px 16px', borderRadius: '20px', border: 'none', whiteSpace: 'nowrap',
                      fontSize: '0.85rem', fontWeight: 700,
                      backgroundColor: activeCategory === cat ? '#f59e0b' : '#1e293b',
                      color: activeCategory === cat ? '#0f172a' : '#94a3b8', cursor: 'pointer'
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Product List */}
              {loadingMenu ? (
                <p style={{ textAlign: 'center', color: '#64748b', padding: '40px 0' }}>در حال آماده‌سازی منوی تازه...</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {filteredProducts.map((p) => {
                    const price = getProductPrice(p);
                    const isVipPrice = customer.is_vip && p.vip_price;
                    const countInCart = cart.find(i => i.id === p.id)?.quantity || 0;

                    return (
                      <div key={p.id} className="card" style={{ padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h3 style={{ fontSize: '1rem', color: '#f8fafc', marginBottom: '4px' }}>{p.name}</h3>
                          {p.description && <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '8px' }}>{p.description}</p>}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: isVipPrice ? '#f59e0b' : '#f8fafc' }}>
                              {price.toLocaleString('fa-IR')}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>تومان</span>
                            {isVipPrice && (
                              <span style={{ textDecoration: 'line-through', color: '#64748b', fontSize: '0.8rem', marginRight: '4px' }}>
                                {Number(p.base_price).toLocaleString('fa-IR')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div>
                          {countInCart === 0 ? (
                            <button onClick={() => addToCart(p)} style={{ backgroundColor: '#1e293b', border: '1px solid #f59e0b', color: '#f59e0b', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>
                              + افزودن
                            </button>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#0f172a', padding: '4px 8px', borderRadius: '8px', border: '1px solid #334155' }}>
                              <button onClick={() => removeFromCart(p.id)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 900 }}>-</button>
                              <span style={{ fontWeight: 800, color: '#f8fafc', minWidth: '18px', textAlign: 'center' }}>{countInCart}</span>
                              <button onClick={() => addToCart(p)} style={{ background: 'none', border: 'none', color: '#10b981', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 900 }}>+</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Cart & 3-Click Checkout */}
          {activeTab === 'cart' && (
            <div style={{ padding: '16px' }}>
              <h2 style={{ fontSize: '1.2rem', color: '#f59e0b', marginBottom: '16px' }}>خلاصه سفارش</h2>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '50px 0', color: '#64748b' }}>سبد شما خالی است ☕</div>
              ) : (
                <>
                  <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
                    {cart.map((item) => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #334155' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#f8fafc' }}>{item.name}</div>
                          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{item.quantity} × {item.final_price.toLocaleString('fa-IR')} ت</div>
                        </div>
                        <div style={{ fontWeight: 800, color: '#f59e0b' }}>
                          {(item.quantity * item.final_price).toLocaleString('fa-IR')} تومان
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8' }}>
                      <span>هزینه ارسال به {customer.shop_name}:</span>
                      <span style={{ color: isFreeDelivery ? '#10b981' : '#f8fafc' }}>
                        {isFreeDelivery ? 'رایگان (۲+ آیتم) 🎉' : '۱۵,۰۰۰ تومان'}
                      </span>
                    </div>
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #475569', display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800 }}>
                      <span>مبلغ قابل پرداخت:</span>
                      <span style={{ color: '#f59e0b' }}>
                        {(totalPrice + (isFreeDelivery ? 0 : 15000)).toLocaleString('fa-IR')} تومان
                      </span>
                    </div>
                  </div>
                  <button onClick={handleFinalOrder} disabled={submitting} className="btn-gold" style={{ width: '100%', padding: '16px', fontSize: '1.1rem', marginTop: '10px' }}>
                    {submitting ? 'در حال ارسال به باریستا...' : `ثبت نهایی و ارسال به ${customer.shop: 'none', color: '#ef4444', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 900 }}>-</button>
                              <span style={{ fontWeight: 800, color: '#f8fafc', minWidth: '18px', textAlign: 'center' }}>{countInCart}</span>
                              <button onClick={() => addToCart(p)} style={{ background: 'none', border: 'none', color: '#10b981', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 900 }}>+</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Cart & 3-Click Checkout */}
          {activeTab === 'cart' && (
            <div style={{ padding: '16px' }}>
              <h2 style={{ fontSize: '1.2rem', color: '#f59e0b', marginBottom: '16px' }}>خلاصه سفارش</h2>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '50px 0', color: '#64748b' }}>سبد شما خالی است ☕</div>
              ) : (
                <>
                  <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
                    {cart.map((item) => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #334155' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#f8fafc' }}>{item.name}</div>
                          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{item.quantity} × {item.final_price.toLocaleString('fa-IR')} ت</div>
                        </div>
                        <div style={{ fontWeight: 800, color: '#f59e0b' }}>
                          {(item.quantity * item.final_price).toLocaleString('fa-IR')} تومان
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8' }}>
                      <span>هزینه ارسال به {customer.shop_name}:</span>
                      <span style={{ color: isFreeDelivery ? '#10b981' : '#f8fafc' }}>
                        {isFreeDelivery ? 'رایگان (۲+ آیتم) 🎉' : '۱۵,۰۰۰ تومان'}
                      </span>
                    </div>
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #475569', display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800 }}>
                      <span>مبلغ قابل پرداخت:</span>
                      <span style={{ color: '#f59e0b' }}>
                        {(totalPrice + (isFreeDelivery ? 0 : 15000)).toLocaleString('fa-IR')} تومان
                      </span>
                    </div>
                  </div>
                  <button onClick={handleFinalOrder} disabled={submitting} className="btn-gold" style={{ width: '100%', padding: '16px', fontSize: '1.1rem', marginTop: '10px' }}>
                    {submitting ? 'در حال ارسال به باریستا...' : `ثبت نهایی و ارسال به ${customer.shop_name} 🚀`}
                  </button>
                </>
              )}
            </div>
          )}

          {/* TAB 4: Order Tracking */}
          {activeTab === 'track' && (
            <div style={{ padding: '16px' }}>
              {!lastOrder ? (
                <div style={{ textAlign: 'center', padding: '50px 0', color: '#64748b' }}>
                  فع: 10, padding: 12, fontSize: 13 }}>
                    <div style={{ color: '#8b949e', fontSize: 11, marginBottom: 6, fontWeight: 'bold' }}>
                      اقلام سفارش:
                    </div>
                    {Array.isArray(lastOrder.items) && lastOrder.items.map((it, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#c9d1d9', padding: '3px 0' }}>
                        <span>{it.name || it.title}</span>
                        <span>×{it.quantity || it.count || 1}</span>
                      </div>
                    ))}
                    {lastOrder.total_price != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', fontWeight: 800, marginTop: 8, paddingTop: 8, borderTop: '1px solid #21262d' }}>
                        <span>مبلغ کل</span>
                        <span>{Number(lastOrder.total_price).toLocaleString('fa-IR')} تومان</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Profile & CRM */}
          {activeTab === 'profile' && (
            <div style={{ padding: '16px' }}>
              <div className="card" style={{ padding: '20px', textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '2.5rem' }}>👑</div>
                <h2 style={{ fontSize: '1.2rem', marginTop: '8px' }}>{customer.full_name}</h2>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{customer.shop_name} - {customer.phone}</p>
                <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'space-around', backgroundColor: '#0f172a', padding: '12px', borderRadius: '12px' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>سفارش‌ها</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f59e0b' }}>{customer.order_count || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>مجموع خرید</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#10b981' }}>{Number(customer.total_spent || 0).toLocaleString('fa-IR')} ت</div>
                  </div>
                </div>
              </div>
              <button onClick={handleLogout} style={{ width: '100%', padding: '12px', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '10px', cursor: 'pointer' }}>
                خروج از حساب
              </button>
            </div>
          )}

          {/* Bottom Navigation Bar */}
          <nav style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: '500px', margin: '0 auto',
            backgroundColor: '#161f30', borderTop: '1px solid #22314d', display: 'flex',
            justifyContent: 'space-around', padding: '10px 0', zIndex: 100
          }}>
            {/* Menu Tab */}
            <button onClick={() => setActiveTab('menu')} style={{ background: 'none', border: 'none', color: activeTab === 'menu' ? '#f59e0b' : '#64748b', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '0.8rem', gap: '4px' }}>
              <span style={{ fontSize: '1.3rem' }}>☕</span> منو
            </button>
            {/* Cart Tab */}
            <button onClick={() => setActiveTab('cart')} style={{ position: 'relative', background: 'none', border: 'none', color: activeTab === 'cart' ? '#f59e0b' : '#64748b', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '0.8rem', gap: '4px' }}>
              <span style={{ fontSize: '1.3rem' }}>🛒</span> سبد
              {totalItemsCount > 0 && (
                <span style={{ position: 'absolute', top: '-4px', right: '10px', backgroundColor: '#f59e0b', color: '#000', borderRadius: '10px', padding: '1px 6px', fontSize: '0.7rem', fontWeight: 800 }}>{totalItemsCount}</span>
              )}
            </button>
            {/* Track Tab */}
            <button onClick={() => setActiveTab('track')} style={{ position: 'relative', background: 'none', border: 'none', color: activeTab === 'track' ? '#f59e0b' : '#64748b', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '0.8rem', gap: '4px' }}>
              <span style={{ fontSize: '1.3rem' }}>🛵</span> پیگیری
              {lastOrder && !['delivered', 'cancelled', 'completed'].includes(lastOrder.status) && (
                <span style={{ position: 'absolute', top: '-2px', left: '14px', width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
              )}
            </button>
            {/* Profile Tab */}
            <button onClick={() => setActiveTab('profile')} style={{ background: 'none', border: 'none', color: activeTab === 'profile' ? '#f59e0b' : '#64748b', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '0.8rem', gap: '4px' }}>
              <span style={{ fontSize: '1.3rem' }}>👤</span> پروفایل
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
