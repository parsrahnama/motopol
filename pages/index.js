import { useState, useEffect } from 'react';
import Head from 'next/head';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('همه');
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [orderStatus, setOrderStatus] = useState(null);

  useEffect(() => {
    fetchProducts();
  }, []);

  async function fetchProducts() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;

      if (data) {
        setProducts(data);
        const uniqueCategories = ['همه', ...new Set(data.map((item) => item.category).filter(Boolean))];
        setCategories(uniqueCategories);
      }
    } catch (err) {
      console.error('Error fetching products:', err.message);
    } finally {
      setLoading(false);
    }
  }

  const addToCart = (product) => {
    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.id === product.id);
      if (existing) {
        return prevCart.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prevCart, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId) => {
    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.id === productId);
      if (existing && existing.quantity > 1) {
        return prevCart.map((item) =>
          item.id === productId ? { ...item, quantity: item.quantity - 1 } : item
        );
      }
      return prevCart.filter((item) => item.id !== productId);
    });
  };

  const totalPrice = cart.reduce((sum, item) => sum + (Number(item.base_price) || 0) * item.quantity, 0);

  const filteredProducts = activeCategory === 'همه'
    ? products
    : products.filter((p) => p.category === activeCategory);

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    if (!customerName || !tableNumber || cart.length === 0) {
      alert('لطفاً نام، شماره میز و حداقل یک محصول را انتخاب کنید.');
      return;
    }

    try {
      const { error } = await supabase.from('orders').insert([
        {
          customer_name: customerName,
          table_number: tableNumber,
          total_price: totalPrice,
          status: 'pending',
          items: cart
        }
      ]);

      if (error) throw error;

      setOrderStatus('ثبت موفق');
      setCart([]);
      setCustomerName('');
      setTableNumber('');
      setTimeout(() => setOrderStatus(null), 4000);
    } catch (err) {
      console.error('Error creating order:', err.message);
      alert('ثبت سفارش با خطا مواجه شد. لطفاً به باریستا اطلاع دهید.');
    }
  };

  return (
    <div style={{ direction: 'rtl', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#0f172a', minHeight: '100vh', color: '#f8fafc' }}>
      <Head>
        <title>کافه موتوپل | سفارش آنلاین منو</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      {/* Header */}
      <header style={{ padding: '20px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e293b' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#38bdf8' }}>کافه موتوپل ☕</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>سفارش مستقیم و هوشمند از سر میز</p>
        </div>
        <div style={{ backgroundColor: '#0f172a', padding: '6px 14px', borderRadius: '20px', fontSize: '0.9rem', border: '1px solid #334155' }}>
          سبد: <strong style={{ color: '#38bdf8' }}>{cart.reduce((a, b) => a + b.quantity, 0)}</strong>
        </div>
      </header>

      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
        {/* Categories Bar */}
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '20px' }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '8px 16px',
                borderRadius: '25px',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: 'bold',
                backgroundColor: activeCategory === cat ? '#38bdf8' : '#1e293b',
                color: activeCategory === cat ? '#0f172a' : '#cbd5e1'
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '50px', color: '#94a3b8' }}>در حال بارگذاری منو...</div>
        ) : filteredProducts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '50px', color: '#94a3b8' }}>محصولی در این دسته‌بندی یافت نشد.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
            {filteredProducts.map((item) => (
              <div
                key={item.id}
                style={{
                  backgroundColor: '#1e293b',
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  border: '1px solid #334155'
                }}
              >
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', color: '#f1f5f9' }}>{item.name}</h3>
                  {item.description && (
                    <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: '#94a3b8', lineHeight: '1.4' }}>
                      {item.description}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                  <div>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#38bdf8' }}>
                      {Number(item.base_price).toLocaleString('fa-IR')}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginRight: '4px' }}>تومان</span>
                  </div>
                  <button
                    onClick={() => addToCart(item)}
                    style={{
                      backgroundColor: '#38bdf8',
                      color: '#0f172a',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 14px',
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}
                  >
                    + افزودن
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Order / Cart Section */}
        {cart.length > 0 && (
          <div style={{ marginTop: '40px', backgroundColor: '#1e293b', padding: '20px', borderRadius: '16px', border: '1px solid #38bdf8' }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: '1.2rem', color: '#38bdf8' }}>🛒 سبد سفارش شما</h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {cart.map((cartItem) => (
                <div key={cartItem.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '8px' }}>
                  <span>{cartItem.name} ({cartItem.quantity} عدد)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>{(Number(cartItem.base_price) * cartItem.quantity).toLocaleString('fa-IR')} ت</span>
                    <button
                      onClick={() => removeFromCart(cartItem.id)}
                      style={{ backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', width: '26px', height: '26px', cursor: 'pointer' }}
                    >
                      -
                    </button>
                    <button
                      onClick={() => addToCart(cartItem)}
                      style={{ backgroundColor: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', width: '26px', height: '26px', cursor: 'pointer' }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '20px', textAlign: 'left' }}>
              جمع کل: {totalPrice.toLocaleString('fa-IR')} تومان
            </div>

            <form onSubmit={handleSubmitOrder} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="text"
                placeholder="نام شما"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                style={{ padding: '12px', borderRadius: '8px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
              />
              <input
                type="text"
                placeholder="شماره میز (مثال: ۵)"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                required
                style={{ padding: '12px', borderRadius: '8px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
              />
              <button
                type="submit"
                style={{
                  backgroundColor: '#22c55e',
                  color: '#fff',
                  padding: '14px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                ثبت و ارسال سفارش به صندوق 🚀
              </button>
            </form>
          </div>
        )}

        {orderStatus && (
          <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#15803d', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold' }}>
            🎉 سفارش شما با موفقیت ثبت شد و در حال آماده‌سازی است!
          </div>
        )}
      </main>
    </div>
  );
}
